import {
  ExecutionProfileListSchema,
  HarnessListSchema,
  KnowledgeCandidatePageSchema,
  LoadoutSchema,
  ProblemDetailsSchema,
  type Project,
  ProjectDetailSchema,
  ProjectSchema,
  ProposedTaskListItemSchema,
  ProposedTaskPageSchema,
  ProposedTaskSchema,
  type RunResult,
  RunSchema,
  type Task,
  TaskDetailSchema,
  TaskGraphSchema,
  TaskSchema,
} from "@dungeon-master/contracts";
import {
  claimNextQueuedRun,
  createDatabase,
  type DatabaseHandle,
  LOCAL_USER_ID,
  transitionRun,
  writeRunTerminalStatus,
} from "@dungeon-master/database";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import {
  criarApp,
  definirWorkspace,
  limparTudo,
  pedir,
  tiposDeActivity,
  tiposDeEvento,
} from "./support.js";

/**
 * As rotas da Fase 5: propostas, candidatos, grafo e troca de dependências.
 *
 * As propostas nascem do desfecho de um Run, e o desfecho é escrito pela
 * mesma porta que o Worker usa (`writeRunTerminalStatus`): não há `INSERT`
 * direto, porque um estado que a aplicação não sabe produzir não é um teste.
 */

let handle: DatabaseHandle;
let app: App;
let project: Project;
let loadoutId: string;
let workspace: string;

const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-propostas",
  });
  app = criarApp(handle);
  workspace = mkdtempSync(join(tmpdir(), "dm-propostas-"));
});

beforeEach(async () => {
  await limparTudo(handle);

  const criado = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Forja de Propostas" },
  });
  project = ProjectSchema.parse(await criado.json());
  await definirWorkspace(handle, { projectId: project.id, workspacePath: workspace });
  loadoutId = await criarLoadout();
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
  rmSync(workspace, { recursive: true, force: true });
});

async function criarLoadout(): Promise<string> {
  const harnesses = HarnessListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` })).json(),
  );
  const harness = harnesses.items.find((item) => item.key === "CLAUDE_CODE");
  const perfis = ExecutionProfileListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/execution-profiles` })).json(),
  );
  const perfil = perfis.items.find((item) => item.enabled);

  const agent = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/agents`,
    body: { name: "Engenheiro", role: "ENGINEER", instructions: "Implemente." },
  });
  const { id: agentId } = (await agent.json()) as { id: string };

  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/loadouts`,
    body: { name: "Campo aberto", agentId, harnessId: harness?.id, executionProfileId: perfil?.id },
  });
  expect(response.status).toBe(201);
  return LoadoutSchema.parse(await response.json()).id;
}

async function criarTask(body: Record<string, unknown>, projectId = project.id): Promise<Task> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks`,
    body: { projectId, ...body },
  });
  expect(response.status).toBe(201);
  return TaskSchema.parse(await response.json());
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

/** Um Run da Task, levado a `RUNNING` e terminado com o resultado. */
async function terminarRun(taskId: string, result: RunResult = RESULTADO): Promise<string> {
  const criado = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks/${taskId}/runs`,
    body: { loadoutId },
  });
  expect(criado.status).toBe(201);
  const run = RunSchema.parse(await criado.json());

  await claimNextQueuedRun(handle.db, { userId: LOCAL_USER_ID });
  const movido = await transitionRun(handle.db, {
    userId: LOCAL_USER_ID,
    runId: run.id,
    to: "RUNNING",
  });
  expect(movido?.ok).toBe(true);

  const terminado = await writeRunTerminalStatus(handle.db, {
    userId: LOCAL_USER_ID,
    runId: run.id,
    status: "SUCCEEDED",
    result,
  });
  expect(terminado?.ok).toBe(true);
  return run.id;
}

async function listarPropostas(
  query = "",
): Promise<ReturnType<typeof ProposedTaskPageSchema.parse>> {
  const response = await pedir({
    app,
    method: "GET",
    path: `${API_BASE_PATH}/proposed-tasks${query}`,
  });
  expect(response.status).toBe(200);
  return ProposedTaskPageSchema.parse(await response.json());
}

async function decidir(
  proposedTaskId: string,
  decisao: "approve" | "reject",
  body: Record<string, unknown> = {},
): Promise<Response> {
  return await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/proposed-tasks/${proposedTaskId}/${decisao}`,
    body,
  });
}

async function lerTask(taskId: string): Promise<ReturnType<typeof TaskDetailSchema.parse>> {
  const response = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/tasks/${taskId}` });
  expect(response.status).toBe(200);
  return TaskDetailSchema.parse(await response.json());
}

async function lerGrafo(projectId = project.id): Promise<Response> {
  return await pedir({
    app,
    method: "GET",
    path: `${API_BASE_PATH}/projects/${projectId}/task-graph`,
  });
}

describe(`GET ${API_BASE_PATH}/proposed-tasks e /knowledge-candidates`, () => {
  it("lista o que o desfecho do Run gravou, com os títulos da origem e as contagens", async () => {
    const origem = await criarTask({ title: "Parser" });
    const runId = await terminarRun(origem.id);

    const pagina = await listarPropostas("?status=PROPOSED");
    expect(pagina.total).toBe(2);
    expect(pagina.items.map((item) => item.title)).toEqual([
      "Documentar o formato",
      "Cobrir o parser com testes",
    ]);
    expect(pagina.items[1]).toMatchObject({
      projectId: project.id,
      originTaskId: origem.id,
      originRunId: runId,
      originTaskTitle: "Parser",
      projectTitle: "Forja de Propostas",
      status: "PROPOSED",
      createdTaskId: null,
    });

    // Filtros por Project e por Task de origem.
    expect((await listarPropostas(`?projectId=${project.id}`)).total).toBe(2);
    expect((await listarPropostas(`?taskId=${origem.id}`)).total).toBe(2);
    expect((await listarPropostas(`?projectId=${ID_INEXISTENTE}`)).total).toBe(0);

    const uma = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/proposed-tasks/${pagina.items[0]?.id ?? ""}`,
    });
    expect(uma.status).toBe(200);
    expect(ProposedTaskListItemSchema.parse(await uma.json()).title).toBe("Documentar o formato");

    const candidatos = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/knowledge-candidates?projectId=${project.id}&status=PENDING`,
    });
    expect(candidatos.status).toBe(200);
    const candidatosPagina = KnowledgeCandidatePageSchema.parse(await candidatos.json());
    expect(candidatosPagina.total).toBe(1);
    expect(candidatosPagina.items[0]).toMatchObject({
      taskId: origem.id,
      runId,
      title: "Rodar o lint antes",
      kind: "howto",
      status: "PENDING",
    });

    // As contagens de propostas abertas no Project e na Task.
    const detalheProject = ProjectDetailSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/projects/${project.id}` })
      ).json(),
    );
    expect(detalheProject.openProposalCount).toBe(2);
    expect((await lerTask(origem.id)).openProposalCount).toBe(2);

    // O evento saiu na transação do desfecho.
    expect((await tiposDeEvento(handle)).filter((tipo) => tipo === "task.proposed")).toHaveLength(
      1,
    );
  });

  it("404 para uma proposta que não existe", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/proposed-tasks/${ID_INEXISTENTE}`,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toBe(
      "ProposedTask não encontrado",
    );
  });
});

describe(`POST ${API_BASE_PATH}/proposed-tasks/{id}/approve`, () => {
  it("cria a Task filha com as dependências, aparece no grafo, e a segunda decisão recebe 409", async () => {
    const origem = await criarTask({ title: "Parser" });
    await terminarRun(origem.id);
    const [documentar, cobrir] = (await listarPropostas()).items;
    if (documentar === undefined || cobrir === undefined) throw new Error("sem propostas");

    const aprovada = await decidir(cobrir.id, "approve", {
      dependsOn: [origem.id],
      priority: "HIGH",
      note: "Vale a pena.",
    });
    expect(aprovada.status).toBe(200);
    const proposta = ProposedTaskSchema.parse(await aprovada.json());
    expect(proposta.status).toBe("APPROVED");
    expect(proposta.note).toBe("Vale a pena.");
    expect(proposta.decidedAt).not.toBeNull();
    const criadaId = proposta.createdTaskId;
    if (criadaId === null) throw new Error("a aprovação não criou Task");

    const criada = await lerTask(criadaId);
    expect(criada).toMatchObject({
      projectId: project.id,
      parentTaskId: origem.id,
      title: "Cobrir o parser com testes",
      status: "READY",
      priority: "HIGH",
    });
    expect(criada.dependencies.map((dependency) => dependency.id)).toEqual([origem.id]);

    // A origem tem a filha, e uma proposta aberta a menos.
    const detalheOrigem = await lerTask(origem.id);
    expect(detalheOrigem.children.map((child) => child.id)).toEqual([criadaId]);
    expect(detalheOrigem.openProposalCount).toBe(1);

    // O grafo mostra o nó novo e a aresta no sentido da execução.
    const grafo = TaskGraphSchema.parse(await (await lerGrafo()).json());
    expect(grafo.nodes.map((node) => [node.id, node.parentTaskId, node.hasOpenProposals])).toEqual([
      [origem.id, null, true],
      [criadaId, origem.id, false],
    ]);
    expect(grafo.edges).toEqual([{ from: origem.id, to: criadaId, kind: "dependency" }]);

    // Diário e stream na mesma transação.
    const activity = await tiposDeActivity(handle);
    expect(activity.filter((tipo) => tipo === "task.created")).toHaveLength(2);
    expect(activity.filter((tipo) => tipo === "task.dependency_created")).toHaveLength(1);
    expect(
      (await tiposDeEvento(handle)).filter((tipo) => tipo === "task.proposal.resolved"),
    ).toEqual(["task.proposal.resolved"]);

    // A segunda decisão perde o CAS: 409 com a proposta atual em `proposedTask`.
    const denovo = await decidir(cobrir.id, "reject");
    expect(denovo.status).toBe(409);
    expect(denovo.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    const corpo = (await denovo.json()) as Record<string, unknown>;
    expect(ProblemDetailsSchema.parse(corpo).title).toBe("Proposta já decidida");
    expect(ProposedTaskSchema.parse(corpo["proposedTask"])).toMatchObject({
      id: cobrir.id,
      status: "APPROVED",
      createdTaskId: criadaId,
    });
    expect((await listarPropostas("?status=PROPOSED")).items.map((item) => item.id)).toEqual([
      documentar.id,
    ]);
  });

  it("parentTaskId nulo cria sem mãe; dependência de outro Project é 404; mãe na Inbox é 409", async () => {
    const origem = await criarTask({ title: "Parser" });
    await terminarRun(origem.id);
    const [proposta] = (await listarPropostas()).items;
    if (proposta === undefined) throw new Error("sem proposta");

    const outro = ProjectSchema.parse(
      await (
        await pedir({
          app,
          method: "POST",
          path: `${API_BASE_PATH}/projects`,
          body: { title: "Outro" },
        })
      ).json(),
    );
    const deFora = await criarTask({ title: "De fora" }, outro.id);

    const foraDoProject = await decidir(proposta.id, "approve", { dependsOn: [deFora.id] });
    expect(foraDoProject.status).toBe(404);
    expect(ProblemDetailsSchema.parse(await foraDoProject.json()).title).toBe(
      "Dependência não encontrada no Project",
    );

    const capturada = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox`,
      body: { text: "captura" },
    });
    const { id: inboxId } = (await capturada.json()) as { id: string };
    const maeNaInbox = await decidir(proposta.id, "approve", { parentTaskId: inboxId });
    expect(maeNaInbox.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await maeNaInbox.json()).title).toBe("Task mãe na Inbox");

    const semMae = await decidir(proposta.id, "approve", { parentTaskId: null });
    expect(semMae.status).toBe(200);
    const aprovada = ProposedTaskSchema.parse(await semMae.json());
    const criada = await lerTask(aprovada.createdTaskId ?? "");
    expect(criada.parentTaskId).toBeNull();
    expect(criada.dependencies).toEqual([]);
  });

  it("404 para uma proposta que não existe e 400 para um corpo inválido", async () => {
    expect((await decidir(ID_INEXISTENTE, "approve")).status).toBe(404);
    expect((await decidir(ID_INEXISTENTE, "reject")).status).toBe(404);

    const origem = await criarTask({ title: "Parser" });
    await terminarRun(origem.id);
    const [proposta] = (await listarPropostas()).items;
    expect(
      (await decidir(proposta?.id ?? "", "approve", { dependsOn: ["não é uuid"] })).status,
    ).toBe(400);
  });
});

describe(`POST ${API_BASE_PATH}/proposed-tasks/{id}/reject`, () => {
  it("recusa com nota, não cria Task, e a aprovação depois recebe 409", async () => {
    const origem = await criarTask({ title: "Parser" });
    await terminarRun(origem.id);
    const [proposta] = (await listarPropostas()).items;
    if (proposta === undefined) throw new Error("sem proposta");

    const recusada = await decidir(proposta.id, "reject", { note: "Fora do escopo." });
    expect(recusada.status).toBe(200);
    expect(ProposedTaskSchema.parse(await recusada.json())).toMatchObject({
      status: "REJECTED",
      note: "Fora do escopo.",
      createdTaskId: null,
    });
    expect((await lerTask(origem.id)).children).toEqual([]);
    expect(
      (await tiposDeEvento(handle)).filter((tipo) => tipo === "task.proposal.resolved"),
    ).toEqual(["task.proposal.resolved"]);

    const aprovar = await decidir(proposta.id, "approve");
    expect(aprovar.status).toBe(409);
    const corpo = (await aprovar.json()) as Record<string, unknown>;
    expect(ProposedTaskSchema.parse(corpo["proposedTask"]).status).toBe("REJECTED");
  });
});

describe(`PUT ${API_BASE_PATH}/tasks/{id}/dependencies`, () => {
  async function trocar(taskId: string, dependsOn: string[]): Promise<Response> {
    return await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/tasks/${taskId}/dependencies`,
      body: { dependsOn },
    });
  }

  it("troca o conjunto inteiro e o grafo acompanha", async () => {
    const alvo = await criarTask({ title: "Alvo" });
    const a = await criarTask({ title: "A" });
    const b = await criarTask({ title: "B" });

    const primeiro = await trocar(alvo.id, [a.id, b.id]);
    expect(primeiro.status).toBe(200);
    expect(
      TaskDetailSchema.parse(await primeiro.json())
        .dependencies.map((dependency) => dependency.title)
        .sort(),
    ).toEqual(["A", "B"]);

    const segundo = await trocar(alvo.id, [b.id]);
    expect(segundo.status).toBe(200);
    expect(TaskDetailSchema.parse(await segundo.json()).dependencies.map((d) => d.title)).toEqual([
      "B",
    ]);

    const grafo = TaskGraphSchema.parse(await (await lerGrafo()).json());
    expect(grafo.edges).toEqual([{ from: b.id, to: alvo.id, kind: "dependency" }]);

    const activity = await tiposDeActivity(handle);
    expect(activity.filter((tipo) => tipo === "task.dependency_created")).toHaveLength(2);
    expect(activity.filter((tipo) => tipo === "task.dependency_removed")).toHaveLength(1);
  });

  it("ciclo vira 409 com o caminho em `path`; outro Project vira 404", async () => {
    const a = await criarTask({ title: "A" });
    const b = await criarTask({ title: "B" });
    expect((await trocar(b.id, [a.id])).status).toBe(200);

    const ciclo = await trocar(a.id, [b.id]);
    expect(ciclo.status).toBe(409);
    expect(ciclo.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    const corpo = (await ciclo.json()) as Record<string, unknown>;
    expect(ProblemDetailsSchema.parse(corpo).title).toBe("Ciclo de dependências");
    expect(corpo["path"]).toEqual([b.id, a.id, b.id]);

    const outro = ProjectSchema.parse(
      await (
        await pedir({
          app,
          method: "POST",
          path: `${API_BASE_PATH}/projects`,
          body: { title: "Outro" },
        })
      ).json(),
    );
    const deFora = await criarTask({ title: "De fora" }, outro.id);
    const fora = await trocar(a.id, [deFora.id]);
    expect(fora.status).toBe(404);
    expect(ProblemDetailsSchema.parse(await fora.json()).title).toBe(
      "Dependência não encontrada no Project",
    );

    expect((await trocar(ID_INEXISTENTE, [])).status).toBe(404);
    expect((await trocar(a.id, [a.id])).status).toBe(409);
  });
});

describe(`GET ${API_BASE_PATH}/projects/{id}/task-graph`, () => {
  it("404 para um Project que não existe e grafo vazio para um Project sem Tasks", async () => {
    expect((await lerGrafo(ID_INEXISTENTE)).status).toBe(404);

    const vazio = await lerGrafo();
    expect(vazio.status).toBe(200);
    expect(TaskGraphSchema.parse(await vazio.json())).toEqual({
      projectId: project.id,
      nodes: [],
      edges: [],
    });
  });
});
