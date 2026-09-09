import { join } from "node:path";

import { CONTEXT_PREAMBLE } from "@dungeon-master/context";
import type { KnowledgeItemType, RunContext, WorkflowDefinition } from "@dungeon-master/contracts";
import { WorkflowDefinitionSchema } from "@dungeon-master/contracts";
import {
  applyKnowledgeDecisions,
  claimNextQueuedRun,
  createDistillationRun,
  createRun,
  createTask,
  createWorkflow,
  getRun,
  getRunContext,
  listKnowledgeCandidates,
  listRunApprovalGates,
  resolveApprovalGate,
  transitionRun,
  updateLoadout,
  writeRunTerminalStatus,
  writeUserSetting,
  type Database,
  type DatabaseHandle,
} from "@dungeon-master/database";
import {
  createAgentRuntime,
  createHarnessRegistry,
  createWorkspaceManager,
  createWorkspaceResolver,
  type AgentRuntime,
  type ExecutionRequest,
  type WorkspaceManager,
} from "@dungeon-master/runtime";
import { fakeHarness } from "@dungeon-master/runtime/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { newWorkerId } from "../src/config.js";
import { createWorker, type Worker } from "../src/worker.js";
import {
  abrirBanco,
  CONFIG_PADRAO,
  criarRepositorio,
  diarioDoRun,
  esperar,
  esperarStatusDeRun,
  eventosDoRun,
  exigirOk,
  limpar,
  montarCenario,
  USER,
  type Cenario,
  type RepositorioTemporario,
} from "./support.js";

/**
 * O Context Engine no Worker (planejamento v0.4, Fase 7), com banco embutido
 * e o harness falso.
 *
 * O que se prova aqui é a fiação e a regra "estável ao longo do Run": o bloco
 * é montado uma vez, gravado em `run_context` antes da primeira chamada ao
 * agente, entra no prompt antes do pedido da Task (e antes de "# Tarefa" no
 * Workflow), é o mesmo texto em todos os passos, e uma retomada relê o
 * registro em vez de montar de novo — mesmo com o Grimório mudado no meio.
 * O runtime real é embrulhado só para gravar cada prompt que chegou ao
 * harness: o processo, o kill e o NDJSON continuam de verdade.
 */

let handle: DatabaseHandle;
let db: Database;
let repositorio: RepositorioTemporario;
const workers: Worker[] = [];

function managerPara(repo: RepositorioTemporario): WorkspaceManager {
  return createWorkspaceManager({ worktreesRoot: join(repo.sandbox, "worktrees") });
}

/** O runtime de produção, com os prompts gravados na passagem. */
function runtimeGravador(workspace: WorkspaceManager): {
  runtime: AgentRuntime;
  prompts: string[];
} {
  const real = createAgentRuntime({
    registry: createHarnessRegistry([fakeHarness()]),
    workspace: createWorkspaceResolver({ manager: workspace }),
    defaultTimeouts: {
      idleMs: CONFIG_PADRAO.runIdleTimeoutMs,
      completionMs: CONFIG_PADRAO.runCompletionTimeoutMs,
    },
  });
  const prompts: string[] = [];
  return {
    prompts,
    runtime: {
      execute: <T>(request: ExecutionRequest<T>) => {
        prompts.push(request.prompt);
        return real.execute(request);
      },
      cancel: (runId) => real.cancel(runId),
    },
  };
}

async function subirWorker(input: { runtime: AgentRuntime; workerId?: string }): Promise<Worker> {
  const criado = createWorker({
    db,
    pool: handle.pool,
    userId: USER,
    adapters: [fakeHarness()],
    runtime: input.runtime,
    workspace: managerPara(repositorio),
    config: { ...CONFIG_PADRAO, workerId: input.workerId ?? newWorkerId() },
  });
  await criado.boot();
  criado.start();
  workers.push(criado);
  return criado;
}

async function pararWorker(worker: Worker): Promise<void> {
  await worker.stop("fim do teste");
  const index = workers.indexOf(worker);
  if (index >= 0) workers.splice(index, 1);
}

/**
 * Páginas do Grimório pelo caminho do Distiller: candidatos gravados no
 * desfecho de um Run de uma Task auxiliar, promovidos com a revisão desligada.
 * Roda **sem** Worker no ar: o claim do Run auxiliar é feito aqui mesmo.
 */
async function promoverPaginas(
  cenario: Cenario,
  paginas: ReadonlyArray<{
    type: Exclude<KnowledgeItemType, "SUMMARY">;
    title: string;
    content: string;
  }>,
): Promise<void> {
  const task = exigirOk(
    await createTask(db, {
      userId: USER,
      projectId: cenario.projectId,
      title: `Origem ${String(Date.now())}`,
    }),
    "a Task de origem",
  );
  const run = exigirOk(
    await createRun(db, { userId: USER, taskId: task.id, loadoutId: cenario.loadoutId }),
    "o Run de origem",
  );
  await claimNextQueuedRun(db, { userId: USER });
  exigirOk(await transitionRun(db, { userId: USER, runId: run.id, to: "RUNNING" }), "RUNNING");
  exigirOk(
    await writeRunTerminalStatus(db, {
      userId: USER,
      runId: run.id,
      status: "SUCCEEDED",
      result: {
        status: "completed",
        summary: "Aprendi.",
        knowledgeCandidates: paginas.map((p) => ({ title: p.title, content: p.content })),
      },
    }),
    "o desfecho de origem",
  );
  const candidatos = await listKnowledgeCandidates(db, {
    userId: USER,
    page: 1,
    pageSize: 50,
    filters: { runId: run.id },
  });
  const porPosicao = [...candidatos.items].sort((a, b) => (a.id < b.id ? -1 : 1));
  const lote = await createDistillationRun(db, {
    userId: USER,
    projectId: cenario.projectId,
    trigger: "MANUAL",
    loadoutId: null,
  });
  await applyKnowledgeDecisions(db, {
    userId: USER,
    projectId: cenario.projectId,
    distillationRunId: lote.id,
    humanReview: false,
    provenance: { harnessSessionId: null, usage: null },
    decisions: porPosicao.map((candidato, indice) => {
      const pagina = paginas[indice];
      if (pagina === undefined) throw new Error("candidato sem página");
      return {
        candidateId: candidato.id,
        decision: "PROMOTE" as const,
        decidedBy: "RULE" as const,
        reason: "teste",
        item: { type: pagina.type, title: pagina.title, content: pagina.content },
      };
    }),
  });
}

const PAGINA_DA_PORTA = {
  type: "FACT" as const,
  title: "Porta do serviço de widgets",
  content: "O serviço de widgets escuta na porta 48213 em desenvolvimento.",
};

const PAGINA_NOVA = {
  type: "FACT" as const,
  title: "Porta nova do serviço de widgets",
  content: "Depois da migração, o serviço de widgets passou a escutar na porta 50000.",
};

async function criarTaskDaPorta(
  cenario: Cenario,
  extra: { workflowId?: string } = {},
): Promise<string> {
  return exigirOk(
    await createTask(db, {
      userId: USER,
      projectId: cenario.projectId,
      title: "Registrar a porta do serviço de widgets",
      description: "Escreva PORT.txt com a porta do serviço de widgets registrada no projeto.",
      ...(extra.workflowId === undefined ? {} : { workflowId: extra.workflowId }),
    }),
    "a Task da porta",
  ).id;
}

function mensagensDeDiagnostico(eventos: Awaited<ReturnType<typeof eventosDoRun>>): string[] {
  return eventos
    .filter((evento) => evento.type === "Diagnostic")
    .map((evento) => String((evento.payload as { message?: string }).message ?? ""));
}

async function contextoDoRun(runId: string): Promise<RunContext> {
  const contexto = await getRunContext(db, { userId: USER, runId });
  if (contexto === null) throw new Error(`O Run ${runId} não tem run_context.`);
  return contexto;
}

/** O bloco aparece uma vez, antes do pedido, e o prefixo é o papel do Agent. */
function esperarBlocoNoPrompt(prompt: string, contexto: RunContext, pedido: string): void {
  expect(prompt.startsWith("Implemente o que a Task pede.\n\n---\n\n")).toBe(true);
  expect(prompt.split(CONTEXT_PREAMBLE)).toHaveLength(2);
  expect(prompt).toContain(contexto.text);
  expect(prompt.indexOf(contexto.text)).toBeLessThan(prompt.indexOf(pedido));
}

beforeAll(() => {
  handle = abrirBanco(inject("databaseUrl"));
  db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await limpar(handle);
  repositorio = await criarRepositorio("dm-worker-ctx-");
});

afterEach(async () => {
  for (const worker of [...workers]) await pararWorker(worker);
  // `limpar` não toca em `user_setting`; o interruptor volta ao padrão aqui.
  await handle.pool.query("delete from user_setting where user_id = $1 and key like 'context.%'", [
    USER,
  ]);
  await limpar(handle);
  await repositorio.remover();
});

describe("o Context Engine no Run simples", () => {
  it("monta uma vez, grava antes do agente, e o bloco entra no prompt antes do pedido", async () => {
    const cenario = await montarCenario(db, { nome: "contexto", workspacePath: repositorio.repo });
    await promoverPaginas(cenario, [
      PAGINA_DA_PORTA,
      { type: "DECISION", title: "Widgets em Hono", content: "O serviço de widgets usa Hono." },
      { type: "FACT", title: "Convenção de commits", content: "Mensagens no imperativo." },
    ]);
    const taskId = await criarTaskDaPorta(cenario);

    const gravador = runtimeGravador(managerPara(repositorio));
    await subirWorker({ runtime: gravador.runtime });

    const pedido = '@@fake:block {"status":"completed","summary":"Escrevi PORT.txt."}';
    const run = exigirOk(
      await createRun(db, { userId: USER, taskId, loadoutId: cenario.loadoutId, prompt: pedido }),
      "o Run",
    );
    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const eventos = await eventosDoRun(db, run.id);
    expect(terminado.status, diarioDoRun(eventos)).toBe("SUCCEEDED");

    const contexto = await contextoDoRun(run.id);
    expect(contexto.status).toBe("ASSEMBLED");
    expect(contexto.inheritedFromRunId).toBeNull();
    expect(contexto.text).toContain("porta 48213");
    expect(contexto.text).not.toContain("Convenção de commits");
    expect(contexto.sections.map((s) => [s.kind, s.items.map((i) => i.reason)])).toEqual([
      ["SUMMARY", []],
      ["DECISIONS", ["RECENT_DECISION"]],
      ["KNOWLEDGE", ["FTS_MATCH"]],
      ["LINEAGE", []],
      ["ARTIFACTS", []],
      ["SKILLS", []],
    ]);
    expect(contexto.sections.find((s) => s.kind === "KNOWLEDGE")?.items[0]).toMatchObject({
      title: "Porta do serviço de widgets",
      score: expect.any(Number) as number,
    });
    expect(contexto.policy.source.loadout.id).toBe(cenario.loadoutId);
    expect(contexto.policy.source.settings).toEqual({
      enabled: true,
      budgetTokens: 6000,
      maxKnowledgeItems: 8,
      maxDecisions: 5,
      maxArtifacts: 10,
    });

    expect(gravador.prompts).toHaveLength(1);
    esperarBlocoNoPrompt(gravador.prompts[0] ?? "", contexto, pedido);

    // O registro precede o agente: o Diagnostic da montagem vem antes do RunStarted.
    const tipos = eventos.map((e) => e.type);
    const montagem = mensagensDeDiagnostico(eventos).findIndex((m) =>
      m.startsWith("Contexto montado"),
    );
    expect(montagem).toBeGreaterThanOrEqual(0);
    const posicaoDaMontagem = eventos.findIndex(
      (e) =>
        e.type === "Diagnostic" &&
        String((e.payload as { message?: string }).message).startsWith("Contexto montado"),
    );
    expect(posicaoDaMontagem).toBeLessThan(tipos.indexOf("RunStarted"));
  });

  it("honra o Loadout com maxItems 0: sem páginas, com o resto", async () => {
    const cenario = await montarCenario(db, {
      nome: "sem-paginas",
      workspacePath: repositorio.repo,
    });
    await promoverPaginas(cenario, [
      PAGINA_DA_PORTA,
      { type: "DECISION", title: "Widgets em Hono", content: "O serviço de widgets usa Hono." },
    ]);
    exigirOk(
      await updateLoadout(db, {
        userId: USER,
        loadoutId: cenario.loadoutId,
        patch: {
          knowledgePolicy: { includeProjectSummary: true, includeDecisions: true, maxItems: 0 },
          skills: ["review"],
        },
      }),
      "a edição do Loadout",
    );
    const taskId = await criarTaskDaPorta(cenario);

    const gravador = runtimeGravador(managerPara(repositorio));
    await subirWorker({ runtime: gravador.runtime });

    const pedido = '@@fake:block {"status":"completed","summary":"ok"}';
    const run = exigirOk(
      await createRun(db, { userId: USER, taskId, loadoutId: cenario.loadoutId, prompt: pedido }),
      "o Run",
    );
    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    expect(terminado.status, diarioDoRun(await eventosDoRun(db, run.id))).toBe("SUCCEEDED");

    const contexto = await contextoDoRun(run.id);
    expect(contexto.status).toBe("ASSEMBLED");
    expect(contexto.policy.maxKnowledgeItems).toBe(0);
    expect(contexto.sections.map((s) => s.kind)).toEqual([
      "SUMMARY",
      "DECISIONS",
      "LINEAGE",
      "ARTIFACTS",
      "SKILLS",
    ]);
    expect(contexto.text).not.toContain("<knowledge>");
    expect(contexto.text).not.toContain("48213");
    expect(contexto.text).toContain("<decisions>");
    expect(contexto.text).toContain("<skills>\n- review\n</skills>");
    esperarBlocoNoPrompt(gravador.prompts[0] ?? "", contexto, pedido);
  });

  it("desligado por context.enabled, grava DISABLED, avisa no diário e o prompt vai sem bloco", async () => {
    const cenario = await montarCenario(db, { nome: "desligado", workspacePath: repositorio.repo });
    await promoverPaginas(cenario, [PAGINA_DA_PORTA]);
    await writeUserSetting(db, { userId: USER, key: "context.enabled", value: false });
    const taskId = await criarTaskDaPorta(cenario);

    const gravador = runtimeGravador(managerPara(repositorio));
    await subirWorker({ runtime: gravador.runtime });

    const pedido = '@@fake:block {"status":"completed","summary":"ok"}';
    const run = exigirOk(
      await createRun(db, { userId: USER, taskId, loadoutId: cenario.loadoutId, prompt: pedido }),
      "o Run",
    );
    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const eventos = await eventosDoRun(db, run.id);
    expect(terminado.status, diarioDoRun(eventos)).toBe("SUCCEEDED");

    const contexto = await contextoDoRun(run.id);
    expect(contexto.status).toBe("DISABLED");
    expect(contexto.text).toBe("");
    expect(contexto.policy.enabled).toBe(false);
    expect(gravador.prompts[0]).toBe(`Implemente o que a Task pede.\n\n---\n\n${pedido}`);
    expect(
      mensagensDeDiagnostico(eventos).some((m) => m.startsWith("Context Engine desligado")),
    ).toBe(true);
  });

  it("um Run que retoma a sessão de outro herda o contexto dele, mesmo com o Grimório mudado", async () => {
    const cenario = await montarCenario(db, { nome: "retomada", workspacePath: repositorio.repo });
    await promoverPaginas(cenario, [PAGINA_DA_PORTA]);
    const taskId = await criarTaskDaPorta(cenario);

    const gravador = runtimeGravador(managerPara(repositorio));
    await subirWorker({ runtime: gravador.runtime });

    // Veredito `failed`: a Task volta a FAILED e aceita outro Run.
    const primeiro = exigirOk(
      await createRun(db, {
        userId: USER,
        taskId,
        loadoutId: cenario.loadoutId,
        prompt:
          '@@fake:session sessao-um\n@@fake:block {"status":"failed","summary":"Faltou a porta."}',
      }),
      "o primeiro Run",
    );
    expect((await esperarStatusDeRun(db, primeiro.id, ["SUCCEEDED", "FAILED"])).status).toBe(
      "SUCCEEDED",
    );
    const original = await contextoDoRun(primeiro.id);
    expect(original.status).toBe("ASSEMBLED");

    // O Grimório muda antes da retomada: a conversa continua com o que já tinha.
    await pararWorker(workers[0] as Worker);
    await promoverPaginas(cenario, [PAGINA_NOVA]);
    const gravador2 = runtimeGravador(managerPara(repositorio));
    await subirWorker({ runtime: gravador2.runtime });

    const segundo = exigirOk(
      await createRun(db, {
        userId: USER,
        taskId,
        resumeFromRunId: primeiro.id,
        prompt: '@@fake:block {"status":"completed","summary":"Agora sim."}',
      }),
      "o Run retomado",
    );
    expect(segundo.resumedFromRunId).toBe(primeiro.id);
    const terminado = await esperarStatusDeRun(db, segundo.id, [
      "SUCCEEDED",
      "FAILED",
      "TIMED_OUT",
    ]);
    const eventos = await eventosDoRun(db, segundo.id);
    expect(terminado.status, diarioDoRun(eventos)).toBe("SUCCEEDED");

    const herdado = await contextoDoRun(segundo.id);
    expect(herdado.inheritedFromRunId).toBe(primeiro.id);
    expect(herdado.text).toBe(original.text);
    expect(herdado.text).not.toContain("50000");
    expect(gravador2.prompts[0]).toContain(original.text);
    expect(
      mensagensDeDiagnostico(eventos).some((m) => m.startsWith("Contexto herdado do Run")),
    ).toBe(true);
  });

  it("herda também de uma origem EMPTY: a conversa não ganha um bloco no meio", async () => {
    const cenario = await montarCenario(db, { nome: "vazio", workspacePath: repositorio.repo });
    const taskId = await criarTaskDaPorta(cenario);

    const gravador = runtimeGravador(managerPara(repositorio));
    await subirWorker({ runtime: gravador.runtime });

    // Sem página no Grimório: o primeiro Run monta um contexto EMPTY, e o
    // prompt dele não tem bloco nenhum.
    const primeiro = exigirOk(
      await createRun(db, {
        userId: USER,
        taskId,
        loadoutId: cenario.loadoutId,
        prompt:
          '@@fake:session sessao-vazia\n@@fake:block {"status":"failed","summary":"Faltou a porta."}',
      }),
      "o primeiro Run",
    );
    expect((await esperarStatusDeRun(db, primeiro.id, ["SUCCEEDED", "FAILED"])).status).toBe(
      "SUCCEEDED",
    );
    const original = await contextoDoRun(primeiro.id);
    expect(original.status).toBe("EMPTY");
    expect(original.text).toBe("");
    expect(gravador.prompts[0]).not.toContain(CONTEXT_PREAMBLE);

    // O Grimório ganha uma página antes da retomada.
    await pararWorker(workers[0] as Worker);
    await promoverPaginas(cenario, [PAGINA_DA_PORTA]);
    const gravador2 = runtimeGravador(managerPara(repositorio));
    await subirWorker({ runtime: gravador2.runtime });

    const segundo = exigirOk(
      await createRun(db, {
        userId: USER,
        taskId,
        resumeFromRunId: primeiro.id,
        prompt: '@@fake:block {"status":"completed","summary":"Agora sim."}',
      }),
      "o Run retomado",
    );
    const terminado = await esperarStatusDeRun(db, segundo.id, [
      "SUCCEEDED",
      "FAILED",
      "TIMED_OUT",
    ]);
    const eventos = await eventosDoRun(db, segundo.id);
    expect(terminado.status, diarioDoRun(eventos)).toBe("SUCCEEDED");

    // A conversa continua com o que já tinha: nada. Montar o seu daria um
    // bloco que não existia no primeiro turno.
    const herdado = await contextoDoRun(segundo.id);
    expect(herdado.inheritedFromRunId).toBe(primeiro.id);
    expect(herdado.status).toBe("EMPTY");
    expect(herdado.text).toBe("");
    expect(gravador2.prompts[0]).not.toContain(CONTEXT_PREAMBLE);
    expect(
      mensagensDeDiagnostico(eventos).some((m) => m.startsWith("Contexto herdado do Run")),
    ).toBe(true);
  });
});

describe("o Context Engine no Run com Workflow", () => {
  const RITUAL: WorkflowDefinition = WorkflowDefinitionSchema.parse({
    name: "Ritual com contexto (teste)",
    steps: [
      {
        type: "agent",
        key: "analyze",
        name: "Analisar",
        prompt: 'Analise.\n@@fake:block {"status":"completed","summary":"Análise."}',
      },
      {
        type: "agent",
        key: "plan",
        name: "Planejar",
        dependsOn: ["analyze"],
        includeOutputsOf: ["analyze"],
        prompt: 'Planeje.\n@@fake:block {"status":"completed","summary":"Plano."}',
      },
      {
        type: "approval",
        key: "approve",
        name: "Aprovar",
        dependsOn: ["plan"],
        gateKey: "plan",
        title: "Aprovar o plano",
      },
      {
        type: "agent",
        key: "execute",
        name: "Executar",
        dependsOn: ["approve"],
        when: [{ kind: "stepSucceeded", step: "approve" }],
        prompt: 'Execute.\n@@fake:block {"status":"completed","summary":"Feito."}',
      },
    ],
  });

  it("todo passo de agente recebe o mesmo bloco antes de # Tarefa, e a retomada relê o registro", async () => {
    const workflowId = exigirOk(
      await createWorkflow(db, { userId: USER, definition: RITUAL }),
      "o Workflow",
    ).id;
    const cenario = await montarCenario(db, {
      nome: "ritual",
      workspacePath: repositorio.repo,
      workflowId,
    });
    await promoverPaginas(cenario, [PAGINA_DA_PORTA]);
    const taskId = await criarTaskDaPorta(cenario, { workflowId });

    const gravador = runtimeGravador(managerPara(repositorio));
    const primeiro = await subirWorker({ runtime: gravador.runtime });

    const run = exigirOk(
      await createRun(db, {
        userId: USER,
        taskId,
        loadoutId: cenario.loadoutId,
        prompt: "Faça a tarefa.",
      }),
      "o Run",
    );
    expect(run.workflowVersionId).not.toBeNull();

    const pausado = await esperarStatusDeRun(db, run.id, [
      "WAITING_APPROVAL",
      "FAILED",
      "SUCCEEDED",
    ]);
    expect(pausado.status, diarioDoRun(await eventosDoRun(db, run.id))).toBe("WAITING_APPROVAL");
    await esperar("o Worker soltar o Run", () =>
      Promise.resolve(primeiro.inFlight === 0 ? true : null),
    );

    const contexto = await contextoDoRun(run.id);
    expect(contexto.status).toBe("ASSEMBLED");
    expect(contexto.text).toContain("porta 48213");

    expect(gravador.prompts).toHaveLength(2);
    for (const prompt of gravador.prompts) {
      esperarBlocoNoPrompt(prompt, contexto, "# Tarefa");
      expect(prompt).toContain("# Tarefa\n\nFaça a tarefa.\n\n# Este passo");
    }

    // ------------------------------------------------------------ retomada
    // Outro Worker, e o Grimório mudou: o registro vale, não uma nova montagem.
    await pararWorker(primeiro);
    await promoverPaginas(cenario, [PAGINA_NOVA]);
    const gravador2 = runtimeGravador(managerPara(repositorio));
    await subirWorker({ runtime: gravador2.runtime });

    const [gate] = await listRunApprovalGates(db, { userId: USER, runId: run.id });
    if (gate === undefined) throw new Error("sem gate");
    expect(
      (await resolveApprovalGate(db, { userId: USER, gateId: gate.id, decision: "approve" }))?.ok,
    ).toBe(true);
    expect((await getRun(db, { userId: USER, runId: run.id }))?.status).toBe("QUEUED");

    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const eventos = await eventosDoRun(db, run.id);
    expect(terminado.status, diarioDoRun(eventos)).toBe("SUCCEEDED");

    expect(gravador2.prompts).toHaveLength(1);
    esperarBlocoNoPrompt(gravador2.prompts[0] ?? "", contexto, "# Tarefa");
    expect(gravador2.prompts[0]).not.toContain("50000");

    const relido = await contextoDoRun(run.id);
    expect(relido).toEqual(contexto);
    const { rows } = await handle.pool.query<{ n: string }>(
      "select count(*)::text as n from run_context where run_id = $1",
      [run.id],
    );
    expect(rows[0]?.n).toBe("1");

    const mensagens = mensagensDeDiagnostico(eventos);
    expect(mensagens.filter((m) => m.startsWith("Contexto montado"))).toHaveLength(1);
    expect(mensagens.filter((m) => m.startsWith("Contexto relido do registro"))).toHaveLength(1);
  });
});
