import type { RunResult } from "@dungeon-master/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { listDashboardEventsSince } from "../src/dashboard-event.js";
import { listKnowledgeCandidates } from "../src/knowledge-candidate.js";
import { createProject, getProject, setProjectArchived } from "../src/project.js";
import {
  approveProposedTask,
  getProposedTask,
  listProposedTasks,
  rejectProposedTask,
} from "../src/proposed-task.js";
import {
  claimNextQueuedRun,
  createRun,
  transitionRun,
  writeRunTerminalStatus,
} from "../src/run.js";
import { persistRunResultOutputs } from "../src/run-result-outputs.js";
import {
  addTaskDependency,
  countOpenProposalsForTask,
  createTask,
  getTaskDetail,
  replaceTaskDependencies,
} from "../src/task.js";
import { getTaskGraph } from "../src/task-graph.js";
import {
  criarEquipamento,
  criarProjectComWorkspace,
  criarTask,
  type Equipamento,
  exigirOk,
  limparExecucao,
  USER,
} from "./support.js";

/**
 * ProposedTask e KnowledgeCandidate (Fase 5): a gravação na transação do
 * desfecho do Run, a decisão por CAS, o grafo e a troca de dependências.
 *
 * O Run chega a `RUNNING` pelas mesmas funções que o Worker usa — claim e
 * transição —, e o desfecho é escrito por `writeRunTerminalStatus`, que é a
 * única porta pela qual propostas e candidatos entram no banco.
 */

let handle: DatabaseHandle;
let equipamento: Equipamento;
let projectId: string;

const REPO = "C:\\repos\\propostas";
const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-propostas",
  });
});

beforeEach(async () => {
  await limparExecucao(handle);
  const project = await criarProjectComWorkspace(handle.db, {
    title: "Forja de Propostas",
    workspacePath: REPO,
  });
  projectId = project.id;
  equipamento = await criarEquipamento(handle.db, { nome: "das propostas" });
});

afterAll(async () => {
  await limparExecucao(handle);
  await handle.close();
});

/** Um Run em `RUNNING`, pronto para receber o desfecho. */
async function runEmVoo(titulo: string): Promise<{ runId: string; taskId: string }> {
  const task = await criarTask(handle.db, { projectId, title: titulo });
  const run = exigirOk(
    await createRun(handle.db, {
      userId: USER,
      taskId: task.id,
      loadoutId: equipamento.loadoutId,
    }),
    `a criação do Run de "${titulo}"`,
  );
  await claimNextQueuedRun(handle.db, { userId: USER });
  exigirOk(
    await transitionRun(handle.db, { userId: USER, runId: run.id, to: "RUNNING" }),
    "a ida para RUNNING",
  );
  return { runId: run.id, taskId: task.id };
}

const RESULTADO: RunResult = {
  status: "completed",
  summary: "Fiz a parte principal.",
  discoveredTasks: [
    { title: "Cobrir o parser com testes", rationale: "Nenhum teste toca o caminho de erro." },
    { title: "Documentar o formato", description: "Um README na pasta do parser." },
  ],
  knowledgeCandidates: [
    { title: "Rodar o lint antes", content: "O lint pega o import quebrado.", kind: "howto" },
  ],
};

/** Termina o Run em `SUCCEEDED` com o resultado dado. */
async function terminar(runId: string, result: RunResult = RESULTADO): Promise<void> {
  exigirOk(
    await writeRunTerminalStatus(handle.db, { userId: USER, runId, status: "SUCCEEDED", result }),
    "o desfecho do Run",
  );
}

async function tiposDeEvento(): Promise<string[]> {
  const eventos = await listDashboardEventsSince(handle.db, { userId: USER, afterSequence: 0 });
  return eventos.map((evento) => evento.type);
}

async function tiposDeActivity(): Promise<string[]> {
  const result = await handle.pool.query<{ type: string }>(
    "select type from activity where user_id = $1 order by created_at, id",
    [USER],
  );
  return result.rows.map((row) => row.type);
}

describe("gravação no desfecho do Run", () => {
  it("as propostas e os candidatos entram na transação do resultado, com o evento", async () => {
    const { runId, taskId } = await runEmVoo("Parser");

    await terminar(runId);

    const propostas = await listProposedTasks(handle.db, { userId: USER, page: 1, pageSize: 10 });
    expect(propostas.total).toBe(2);
    // Da mais recente para a mais antiga; os ids são UUIDv7 na ordem da lista.
    expect(propostas.items.map((item) => item.title)).toEqual([
      "Documentar o formato",
      "Cobrir o parser com testes",
    ]);
    expect(propostas.items[1]).toMatchObject({
      projectId,
      originTaskId: taskId,
      originRunId: runId,
      rationale: "Nenhum teste toca o caminho de erro.",
      description: null,
      status: "PROPOSED",
      decidedAt: null,
      note: null,
      createdTaskId: null,
      originTaskTitle: "Parser",
      projectTitle: "Forja de Propostas",
    });

    const candidatos = await listKnowledgeCandidates(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId },
    });
    expect(candidatos.items).toHaveLength(1);
    expect(candidatos.items[0]).toMatchObject({
      taskId,
      runId,
      title: "Rodar o lint antes",
      content: "O lint pega o import quebrado.",
      kind: "howto",
      status: "PENDING",
    });

    const eventos = await tiposDeEvento();
    expect(eventos.filter((tipo) => tipo === "task.proposed")).toHaveLength(1);
    // O evento vem junto do desfecho, e não antes dele.
    expect(eventos.indexOf("task.proposed")).toBeGreaterThan(eventos.indexOf("run.created"));

    expect(await countOpenProposalsForTask(handle.db, { userId: USER, taskId })).toBe(2);
    expect((await getProject(handle.db, { userId: USER, projectId }))?.openProposalCount).toBe(2);
  });

  it("reprocessar o mesmo resultado não duplica: a chave é (Run, posição)", async () => {
    const { runId, taskId } = await runEmVoo("Idempotente");
    await terminar(runId);

    const denovo = await persistRunResultOutputs(handle.db, {
      userId: USER,
      runId,
      taskId,
      projectId,
      result: RESULTADO,
    });
    expect(denovo).toEqual({ proposedTasks: 0, knowledgeCandidates: 0 });

    const propostas = await listProposedTasks(handle.db, { userId: USER, page: 1, pageSize: 10 });
    expect(propostas.total).toBe(2);
    const candidatos = await listKnowledgeCandidates(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
    });
    expect(candidatos.total).toBe(1);
    // Sem linha nova não há evento novo.
    expect((await tiposDeEvento()).filter((tipo) => tipo === "task.proposed")).toHaveLength(1);
  });

  it("um resultado agregado de Run com Workflow que falhou ainda grava as propostas", async () => {
    const { runId } = await runEmVoo("Guiada que falhou");

    // A forma que `aggregateRunResult` produz num Run FAILED: o veredito é
    // `failed`, mas os agentes que assentaram já disseram o que faltava.
    exigirOk(
      await writeRunTerminalStatus(handle.db, {
        userId: USER,
        runId,
        status: "FAILED",
        result: {
          status: "failed",
          summary: "Workflow falhou no passo «Validar» (validate).",
          discoveredTasks: [{ title: "Consertar a validação" }],
          knowledgeCandidates: [{ title: "Validação", content: "Roda `git status`." }],
        },
        error: { code: "STEP_FAILED", message: "O passo «Validar» terminou em FAILED." },
      }),
      "o desfecho FAILED",
    );

    const propostas = await listProposedTasks(handle.db, { userId: USER, page: 1, pageSize: 10 });
    expect(propostas.items.map((item) => item.title)).toEqual(["Consertar a validação"]);
  });

  it("um desfecho sem resultado não grava nada", async () => {
    const { runId, taskId } = await runEmVoo("Timeout");

    exigirOk(
      await writeRunTerminalStatus(handle.db, {
        userId: USER,
        runId,
        status: "TIMED_OUT",
        error: { code: "TIMEOUT_IDLE", message: "silêncio" },
      }),
      "o desfecho TIMED_OUT",
    );

    expect(await countOpenProposalsForTask(handle.db, { userId: USER, taskId })).toBe(0);
    expect((await tiposDeEvento()).includes("task.proposed")).toBe(false);
  });

  it("um item fora do contrato é pulado e o resto entra; texto vazio não vira linha", async () => {
    const { runId } = await runEmVoo("Torto");

    await terminar(runId, {
      status: "completed",
      discoveredTasks: [{ title: "   " }, { semTitulo: true }, { title: "Válida" }],
      knowledgeCandidates: [{ title: "Sem conteúdo", content: "   " }],
    });

    const propostas = await listProposedTasks(handle.db, { userId: USER, page: 1, pageSize: 10 });
    expect(propostas.items.map((item) => item.title)).toEqual(["Válida", "(proposta sem título)"]);
    const candidatos = await listKnowledgeCandidates(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
    });
    expect(candidatos.total).toBe(0);
  });
});

describe("approveProposedTask", () => {
  async function proposta(titulo = "Origem"): Promise<{
    proposedTaskId: string;
    originTaskId: string;
    runId: string;
  }> {
    const { runId, taskId } = await runEmVoo(titulo);
    await terminar(runId);
    const lista = await listProposedTasks(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { taskId },
    });
    const primeira = lista.items.find((item) => item.title === "Cobrir o parser com testes");
    if (primeira === undefined) throw new Error("A proposta não foi gravada.");
    return { proposedTaskId: primeira.id, originTaskId: taskId, runId };
  }

  it("cria a Task filha da origem, com as dependências pedidas, e decide por CAS", async () => {
    const { proposedTaskId, originTaskId } = await proposta();
    const outra = await criarTask(handle.db, { projectId, title: "Outra" });

    const aprovada = exigirOk(
      await approveProposedTask(handle.db, {
        userId: USER,
        proposedTaskId,
        dependsOn: [originTaskId, outra.id, outra.id],
        priority: "HIGH",
        kind: "CHORE",
        note: "Vale a pena.",
      }),
      "a aprovação",
    );

    expect(aprovada.status).toBe("APPROVED");
    expect(aprovada.decidedAt).not.toBeNull();
    expect(aprovada.note).toBe("Vale a pena.");
    expect(aprovada.createdTaskId).not.toBeNull();

    const criada = await getTaskDetail(handle.db, {
      userId: USER,
      taskId: aprovada.createdTaskId ?? "",
    });
    expect(criada).toMatchObject({
      projectId,
      parentTaskId: originTaskId,
      title: "Cobrir o parser com testes",
      status: "READY",
      priority: "HIGH",
      kind: "CHORE",
    });
    expect(criada?.dependencies.map((dependency) => dependency.id).sort()).toEqual(
      [originTaskId, outra.id].sort(),
    );

    // A origem passou a ter uma filha e uma proposta aberta a menos.
    const origem = await getTaskDetail(handle.db, { userId: USER, taskId: originTaskId });
    expect(origem?.children.map((child) => child.id)).toEqual([aprovada.createdTaskId]);
    expect(origem?.openProposalCount).toBe(1);

    const activity = await tiposDeActivity();
    expect(activity.filter((tipo) => tipo === "task.created")).toHaveLength(3);
    expect(activity.filter((tipo) => tipo === "task.dependency_created")).toHaveLength(2);
    expect((await tiposDeEvento()).filter((tipo) => tipo === "task.proposal.resolved")).toEqual([
      "task.proposal.resolved",
    ]);

    // A segunda decisão perde o CAS e recebe a proposta como ficou.
    const denovo = await rejectProposedTask(handle.db, { userId: USER, proposedTaskId });
    expect(denovo).not.toBeNull();
    expect(denovo?.ok).toBe(false);
    if (denovo === null || denovo.ok) return;
    expect(denovo.failure.code).toBe("PROPOSAL_ALREADY_DECIDED");
    if (denovo.failure.code !== "PROPOSAL_ALREADY_DECIDED") return;
    expect(denovo.failure.proposedTask).toMatchObject({
      id: proposedTaskId,
      status: "APPROVED",
      createdTaskId: aprovada.createdTaskId,
    });
    // Nenhuma segunda Task, nenhum segundo evento.
    expect((await tiposDeActivity()).filter((tipo) => tipo === "task.created")).toHaveLength(3);
    expect(
      (await tiposDeEvento()).filter((tipo) => tipo === "task.proposal.resolved"),
    ).toHaveLength(1);
  });

  it("parentTaskId nulo cria uma Task sem mãe; um Workflow inexistente é recusado", async () => {
    const { proposedTaskId } = await proposta();

    const semWorkflow = await approveProposedTask(handle.db, {
      userId: USER,
      proposedTaskId,
      workflowId: ID_INEXISTENTE,
    });
    expect(semWorkflow?.ok).toBe(false);
    if (semWorkflow === null || semWorkflow.ok) return;
    expect(semWorkflow.failure.code).toBe("WORKFLOW_NOT_FOUND");

    const aprovada = exigirOk(
      await approveProposedTask(handle.db, { userId: USER, proposedTaskId, parentTaskId: null }),
      "a aprovação sem mãe",
    );
    const criada = await getTaskDetail(handle.db, {
      userId: USER,
      taskId: aprovada.createdTaskId ?? "",
    });
    expect(criada?.parentTaskId).toBeNull();
    expect(criada?.dependencies).toEqual([]);
    expect(criada?.priority).toBe("MEDIUM");
    expect(criada?.kind).toBe("FEATURE");
  });

  it("recusa mãe e dependência de outro Project, dependência inexistente e Project arquivado", async () => {
    const { proposedTaskId } = await proposta();
    const outroProject = await createProject(handle.db, { userId: USER, title: "Outro" });
    const deFora = await criarTask(handle.db, { projectId: outroProject.id, title: "De fora" });

    const maeDeFora = await approveProposedTask(handle.db, {
      userId: USER,
      proposedTaskId,
      parentTaskId: deFora.id,
    });
    expect(maeDeFora?.ok === false && maeDeFora.failure.code).toBe("PARENT_IN_OTHER_PROJECT");

    const maeInexistente = await approveProposedTask(handle.db, {
      userId: USER,
      proposedTaskId,
      parentTaskId: ID_INEXISTENTE,
    });
    expect(maeInexistente?.ok === false && maeInexistente.failure.code).toBe("PARENT_NOT_FOUND");

    const depDeFora = await approveProposedTask(handle.db, {
      userId: USER,
      proposedTaskId,
      dependsOn: [deFora.id],
    });
    expect(depDeFora?.ok === false && depDeFora.failure.code).toBe("DEPENDENCY_IN_OTHER_PROJECT");

    const depInexistente = await approveProposedTask(handle.db, {
      userId: USER,
      proposedTaskId,
      dependsOn: [ID_INEXISTENTE],
    });
    expect(depInexistente?.ok === false && depInexistente.failure.code).toBe(
      "DEPENDENCY_NOT_FOUND",
    );

    // Nenhuma recusa gravou nada: a proposta continua aberta e sem Task.
    const atual = await getProposedTask(handle.db, { userId: USER, proposedTaskId });
    expect(atual?.status).toBe("PROPOSED");
    expect(atual?.createdTaskId).toBeNull();

    await setProjectArchived(handle.db, { userId: USER, projectId, archived: true });
    const arquivado = await approveProposedTask(handle.db, { userId: USER, proposedTaskId });
    expect(arquivado?.ok === false && arquivado.failure.code).toBe("PROJECT_ARCHIVED");
  });

  it("devolve null para uma proposta que não existe", async () => {
    expect(
      await approveProposedTask(handle.db, { userId: USER, proposedTaskId: ID_INEXISTENTE }),
    ).toBeNull();
    expect(
      await rejectProposedTask(handle.db, { userId: USER, proposedTaskId: ID_INEXISTENTE }),
    ).toBeNull();
  });
});

describe("rejectProposedTask", () => {
  it("recusa com nota, sem criar Task, e a segunda decisão perde o CAS", async () => {
    const { runId } = await runEmVoo("Origem");
    await terminar(runId);
    const [primeira] = (await listProposedTasks(handle.db, { userId: USER, page: 1, pageSize: 1 }))
      .items;
    if (primeira === undefined) throw new Error("sem proposta");

    const recusada = exigirOk(
      await rejectProposedTask(handle.db, {
        userId: USER,
        proposedTaskId: primeira.id,
        note: "Fora do escopo.",
      }),
      "a recusa",
    );
    expect(recusada).toMatchObject({
      status: "REJECTED",
      note: "Fora do escopo.",
      createdTaskId: null,
    });
    expect(recusada.decidedAt).not.toBeNull();

    const aprovar = await approveProposedTask(handle.db, {
      userId: USER,
      proposedTaskId: primeira.id,
    });
    expect(aprovar?.ok).toBe(false);
    if (aprovar === null || aprovar.ok || aprovar.failure.code !== "PROPOSAL_ALREADY_DECIDED") {
      throw new Error("esperava PROPOSAL_ALREADY_DECIDED");
    }
    expect(aprovar.failure.proposedTask.status).toBe("REJECTED");

    // A lista filtra por estado.
    const abertas = await listProposedTasks(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { status: "PROPOSED" },
    });
    expect(abertas.total).toBe(1);
  });
});

describe("replaceTaskDependencies", () => {
  it("troca o conjunto inteiro: entra o que faltava, sai o que sobrou, fica o que já estava", async () => {
    const alvo = await criarTask(handle.db, { projectId, title: "Alvo" });
    const a = await criarTask(handle.db, { projectId, title: "A" });
    const b = await criarTask(handle.db, { projectId, title: "B" });
    const c = await criarTask(handle.db, { projectId, title: "C" });

    const primeiro = exigirOk(
      await replaceTaskDependencies(handle.db, {
        userId: USER,
        taskId: alvo.id,
        dependsOn: [a.id, b.id, a.id],
      }),
      "a primeira troca",
    );
    expect(primeiro.dependencies.map((d) => d.title).sort()).toEqual(["A", "B"]);

    const antes = (await tiposDeActivity()).length;
    const segundo = exigirOk(
      await replaceTaskDependencies(handle.db, {
        userId: USER,
        taskId: alvo.id,
        dependsOn: [b.id, c.id],
      }),
      "a segunda troca",
    );
    expect(segundo.dependencies.map((d) => d.title).sort()).toEqual(["B", "C"]);
    const activity = await tiposDeActivity();
    // Uma saída (A) e uma entrada (C); B não gerou fato.
    expect(activity.slice(antes)).toEqual(["task.dependency_removed", "task.dependency_created"]);

    // Idempotente: repetir não grava nada.
    exigirOk(
      await replaceTaskDependencies(handle.db, {
        userId: USER,
        taskId: alvo.id,
        dependsOn: [c.id, b.id],
      }),
      "a repetição",
    );
    expect((await tiposDeActivity()).length).toBe(activity.length);

    const limpo = exigirOk(
      await replaceTaskDependencies(handle.db, { userId: USER, taskId: alvo.id, dependsOn: [] }),
      "a limpeza",
    );
    expect(limpo.dependencies).toEqual([]);
  });

  it("recusa ciclo com o caminho, auto-dependência, outro Project e Task inexistente", async () => {
    const a = await criarTask(handle.db, { projectId, title: "A" });
    const b = await criarTask(handle.db, { projectId, title: "B" });
    const outro = await createProject(handle.db, { userId: USER, title: "Outro" });
    const deFora = await criarTask(handle.db, { projectId: outro.id, title: "De fora" });

    exigirOk(
      await addTaskDependency(handle.db, { userId: USER, taskId: b.id, dependsOnTaskId: a.id }),
      "B espera A",
    );

    const ciclo = await replaceTaskDependencies(handle.db, {
      userId: USER,
      taskId: a.id,
      dependsOn: [b.id],
    });
    expect(ciclo?.ok).toBe(false);
    if (ciclo === null || ciclo.ok || ciclo.failure.code !== "DEPENDENCY_CYCLE") {
      throw new Error("esperava DEPENDENCY_CYCLE");
    }
    expect(ciclo.failure.path).toEqual([b.id, a.id, b.id]);

    const self = await replaceTaskDependencies(handle.db, {
      userId: USER,
      taskId: a.id,
      dependsOn: [a.id],
    });
    expect(self?.ok === false && self.failure.code).toBe("SELF_DEPENDENCY");

    const fora = await replaceTaskDependencies(handle.db, {
      userId: USER,
      taskId: a.id,
      dependsOn: [deFora.id],
    });
    expect(fora?.ok === false && fora.failure.code).toBe("DEPENDENCY_IN_OTHER_PROJECT");

    const inexistente = await replaceTaskDependencies(handle.db, {
      userId: USER,
      taskId: a.id,
      dependsOn: [ID_INEXISTENTE],
    });
    expect(inexistente?.ok === false && inexistente.failure.code).toBe("DEPENDENCY_NOT_FOUND");

    expect(
      await replaceTaskDependencies(handle.db, {
        userId: USER,
        taskId: ID_INEXISTENTE,
        dependsOn: [],
      }),
    ).toBeNull();
  });

  it("a troca remove a aresta antiga antes de checar o ciclo", async () => {
    const a = await criarTask(handle.db, { projectId, title: "A" });
    const b = await criarTask(handle.db, { projectId, title: "B" });
    exigirOk(
      await addTaskDependency(handle.db, { userId: USER, taskId: a.id, dependsOnTaskId: b.id }),
      "A espera B",
    );

    // Inverter o sentido numa transação só: A deixa de esperar B, B passa a
    // esperar A. Checado aresta a aresta seria um ciclo; como conjunto, não é.
    exigirOk(
      await replaceTaskDependencies(handle.db, { userId: USER, taskId: a.id, dependsOn: [] }),
      "A solta B",
    );
    const invertido = exigirOk(
      await replaceTaskDependencies(handle.db, { userId: USER, taskId: b.id, dependsOn: [a.id] }),
      "B espera A",
    );
    expect(invertido.dependencies.map((d) => d.id)).toEqual([a.id]);
  });
});

describe("getTaskGraph", () => {
  it("devolve os nós do Project, as arestas no sentido da execução e as propostas abertas", async () => {
    const { runId, taskId: origem } = await runEmVoo("Origem");
    await terminar(runId);
    const filha = exigirOk(
      await createTask(handle.db, {
        userId: USER,
        projectId,
        parentTaskId: origem,
        title: "Filha",
      }),
      "a filha",
    );
    exigirOk(
      await addTaskDependency(handle.db, {
        userId: USER,
        taskId: filha.id,
        dependsOnTaskId: origem,
      }),
      "a filha espera a origem",
    );

    // Uma aresta para fora do Project, pela rota por aresta, fica fora do desenho.
    const outro = await createProject(handle.db, { userId: USER, title: "Outro" });
    const deFora = await criarTask(handle.db, { projectId: outro.id, title: "De fora" });
    exigirOk(
      await addTaskDependency(handle.db, {
        userId: USER,
        taskId: filha.id,
        dependsOnTaskId: deFora.id,
      }),
      "a filha espera de fora",
    );

    const grafo = await getTaskGraph(handle.db, { userId: USER, projectId });
    expect(grafo?.projectId).toBe(projectId);
    expect(
      grafo?.nodes.map((node) => [node.title, node.parentTaskId, node.hasOpenProposals]),
    ).toEqual([
      ["Origem", null, true],
      ["Filha", origem, false],
    ]);
    expect(grafo?.nodes[0]).toMatchObject({
      status: "COMPLETED",
      kind: "FEATURE",
      workflowId: null,
    });
    expect(grafo?.edges).toEqual([{ from: origem, to: filha.id, kind: "dependency" }]);

    expect(await getTaskGraph(handle.db, { userId: USER, projectId: ID_INEXISTENTE })).toBeNull();
  });
});
