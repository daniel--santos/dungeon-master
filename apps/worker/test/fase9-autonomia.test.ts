import { join } from "node:path";

import type { RunEvent, WorkflowDefinition } from "@dungeon-master/contracts";
import { WorkflowDefinitionSchema } from "@dungeon-master/contracts";
import {
  createAgent,
  createApprovalPolicy,
  createBudget,
  createCircuitBreaker,
  createLoadout,
  createTask,
  createWorkflow,
  findCircuitBreakerRow,
  getRun,
  listChildRuns,
  listDashboardEventsSince,
  listExecutionProfiles,
  listHarnesses,
  listRunApprovalGates,
  listRunSteps,
  newId,
  requestRunCancellation,
  tasks,
  updateLoadout,
  updateProjectAutonomy,
  type Database,
  type DatabaseHandle,
} from "@dungeon-master/database";
import { createWorkspaceManager, type HarnessExecutionRequest } from "@dungeon-master/runtime";
import { fakeHarness } from "@dungeon-master/runtime/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { newWorkerId } from "../src/config.js";
import { createWorker, type Worker } from "../src/worker.js";
import {
  abrirBanco,
  CONFIG_PADRAO,
  criarRepositorio,
  diarioDoRun,
  enfileirar,
  esperar,
  esperarStatusDeRun,
  eventosDoRun,
  exigirOk,
  limpar,
  montarCenario,
  statusDaTask,
  USER,
  type Cenario,
  type RepositorioTemporario,
} from "./support.js";

/**
 * A autonomia em movimento no Worker (Fase 9B), com o banco embutido e o
 * harness falso: a delegação por step com o Run mãe soltando o Worker e
 * sobrevivendo a um restart no meio da espera; o cancelamento em cascata; o
 * Selo concedido ou negado por política; os disjuntores alimentados pelos
 * desfechos e a reclamação recusando um Run com disjuntor aberto; os
 * orçamentos re-checados na reclamação e por passo; o auto-despacho; e a
 * ferramenta de delegação oferecida só no nível 4.
 */

let handle: DatabaseHandle;
let db: Database;
let repositorio: RepositorioTemporario;
const workers: Worker[] = [];
/** Os pedidos que chegaram ao adapter falso, já resolvidos pelo runtime. */
let pedidos: HarnessExecutionRequest[] = [];

async function subirWorker(
  input: { maxConcurrentRuns?: number; dispatchRetryAfterMs?: number; start?: boolean } = {},
): Promise<Worker> {
  const criado = createWorker({
    db,
    pool: handle.pool,
    userId: USER,
    adapters: [fakeHarness({ onRequest: (request) => pedidos.push(request) })],
    workspace: createWorkspaceManager({ worktreesRoot: join(repositorio.sandbox, "worktrees") }),
    databaseUrl: inject("databaseUrl"),
    config: {
      ...CONFIG_PADRAO,
      workerId: newWorkerId(),
      ...(input.maxConcurrentRuns === undefined
        ? {}
        : { maxConcurrentRuns: input.maxConcurrentRuns }),
    },
    dispatch: { retryAfterMs: input.dispatchRetryAfterMs ?? 200 },
  });
  await criado.boot();
  if (input.start !== false) criado.start();
  workers.push(criado);
  return criado;
}

async function pararWorker(worker: Worker): Promise<void> {
  await worker.stop("fim do teste");
  const index = workers.indexOf(worker);
  if (index >= 0) workers.splice(index, 1);
}

/** Um segundo Loadout — o Revisor — sobre os mesmos cadastros semeados. */
async function criarRevisor(nome = "Revisor"): Promise<string> {
  const harness = (await listHarnesses(db, { userId: USER })).find(
    (item) => item.key === "CLAUDE_CODE",
  );
  const perfil = (await listExecutionProfiles(db, { userId: USER })).find((item) => item.enabled);
  if (harness === undefined || perfil === undefined) throw new Error("Semente ausente.");
  const agent = exigirOk(
    await createAgent(db, {
      userId: USER,
      name: `Revisora ${nome}`,
      role: "REVIEWER",
      instructions: "Revise o que a Task pede.",
    }),
    "Agent revisor",
  );
  return exigirOk(
    await createLoadout(db, {
      userId: USER,
      name: nome,
      agentId: agent.id,
      harnessId: harness.id,
      executionProfileId: perfil.id,
    }),
    "Loadout revisor",
  ).id;
}

const COMPLETED = (summary: string) => `@@fake:block {"status":"completed","summary":"${summary}"}`;

/** analyze → delegate(Revisor) → execute, com o filho roteirizado pelo prompt do passo. */
function ritualComDelegacao(input: {
  childPrompt: string;
  loadoutRef?: string;
}): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse({
    name: "Análise, revisão delegada e execução",
    steps: [
      {
        type: "agent",
        key: "analyze",
        name: "Analisar",
        prompt: [
          "Analise a tarefa.",
          "@@fake:usage 30 10",
          COMPLETED("Análise: criar um arquivo."),
        ].join("\n"),
      },
      {
        type: "delegate",
        key: "review",
        name: "Revisar",
        dependsOn: ["analyze"],
        includeOutputsOf: ["analyze"],
        loadoutRef: input.loadoutRef ?? "Revisor",
        prompt: ["Revise a análise.", input.childPrompt].join("\n"),
      },
      {
        type: "agent",
        key: "execute",
        name: "Executar",
        dependsOn: ["review"],
        includeOutputsOf: ["review"],
        prompt: ["Implemente o que a revisão aprovou.", COMPLETED("Executado.")].join("\n"),
      },
    ],
  });
}

async function criarWorkflow(definition: WorkflowDefinition): Promise<string> {
  return exigirOk(await createWorkflow(db, { userId: USER, definition }), "a criação do Workflow")
    .id;
}

async function statusDosSteps(runId: string): Promise<Record<string, string>> {
  const steps = await listRunSteps(db, { userId: USER, runId });
  return Object.fromEntries(steps.map((step) => [step.key, step.status]));
}

function codigos(eventos: readonly RunEvent[]): string[] {
  return eventos.flatMap((evento) => {
    const payload = evento.payload as { code?: string };
    return evento.type === "Diagnostic" && payload.code !== undefined ? [payload.code] : [];
  });
}

async function tiposDePainel(): Promise<string[]> {
  const eventos = await listDashboardEventsSince(db, {
    userId: USER,
    afterSequence: 0,
    limit: 500,
  });
  return eventos.map((evento) => evento.type);
}

async function cenarioComRitual(nome: string, definition: WorkflowDefinition): Promise<Cenario> {
  const workflowId = await criarWorkflow(definition);
  return await montarCenario(db, { nome, workspacePath: repositorio.repo, workflowId });
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
  pedidos = [];
  repositorio = await criarRepositorio("dm-worker-9b-");
});

afterEach(async () => {
  for (const worker of [...workers]) await pararWorker(worker);
  await limpar(handle);
  await repositorio.remover();
});

describe("delegação por step", () => {
  it("o filho roda com outro Loadout, o Run mãe espera, sobrevive ao restart e usa a saída do filho", async () => {
    await criarRevisor();
    const cenario = await cenarioComRitual(
      "delegacao",
      ritualComDelegacao({
        childPrompt: ["@@fake:usage 40 10", COMPLETED("Revisão: aprovado com uma ressalva.")].join(
          "\n",
        ),
      }),
    );
    await updateProjectAutonomy(db, {
      userId: USER,
      projectId: cenario.projectId,
      autonomyLevel: 3,
    });

    // Um Worker de capacidade 1: enquanto o "bloqueador" ocupa a vaga, o
    // filho fica na fila e o restart acontece com a mãe esperando de verdade.
    const primeiro = await subirWorker({ maxConcurrentRuns: 1 });
    const mae = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });
    const outra = await montarCenario(db, { nome: "bloqueador", workspacePath: repositorio.repo });
    const bloqueador = await enfileirar(db, {
      taskId: outra.taskId,
      loadoutId: outra.loadoutId,
      prompt: "@@fake:sleep 30000",
    });

    // ------------------------------------------------------------- espera
    const esperando = await esperarStatusDeRun(db, mae.id, [
      "WAITING_CHILD",
      "FAILED",
      "SUCCEEDED",
    ]);
    expect(esperando.status, diarioDoRun(await eventosDoRun(db, mae.id))).toBe("WAITING_CHILD");
    expect(await statusDosSteps(mae.id)).toEqual({
      analyze: "SUCCEEDED",
      review: "WAITING_CHILD",
      execute: "PENDING",
    });
    // A Task da mãe continua RUNNING: o filho na mesma Task não a move.
    expect(await statusDaTask(db, cenario.taskId)).toBe("RUNNING");

    const [filho] = await listChildRuns(db, { userId: USER, runId: mae.id });
    expect(filho).toMatchObject({
      createdBy: "DELEGATION",
      parentRunId: mae.id,
      parentStepKey: "review",
      taskId: cenario.taskId,
      attempt: 2,
    });
    expect(filho?.loadoutSnapshot.name).toBe("Revisor");
    expect(filho?.prompt).toContain("Revise a análise.");
    expect(filho?.prompt).toContain("Análise: criar um arquivo.");
    expect(codigos(await eventosDoRun(db, mae.id))).toContain("DELEGATION_STARTED");
    await esperar("o Worker soltar a mãe", () =>
      Promise.resolve(primeiro.inFlight <= 1 ? true : null),
    );
    await esperarStatusDeRun(db, bloqueador.id, ["RUNNING", "CANCELLED", "FAILED"]);
    expect((await getRun(db, { userId: USER, runId: filho!.id }))?.status).toBe("QUEUED");

    // ------------------------------------------------------------ restart
    await pararWorker(primeiro);
    expect((await getRun(db, { userId: USER, runId: mae.id }))?.status).toBe("WAITING_CHILD");
    const segundo = await subirWorker({ maxConcurrentRuns: 2 });
    expect(segundo.workerId).not.toBe(primeiro.workerId);

    // O filho roda, o desfecho dele devolve a mãe à fila, e ela termina.
    const filhoTerminado = await esperarStatusDeRun(db, filho!.id, ["SUCCEEDED", "FAILED"]);
    expect(filhoTerminado.status, diarioDoRun(await eventosDoRun(db, filho!.id))).toBe("SUCCEEDED");
    const terminado = await esperarStatusDeRun(db, mae.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const diario = await eventosDoRun(db, mae.id);
    expect(terminado.status, diarioDoRun(diario)).toBe("SUCCEEDED");
    expect(await statusDosSteps(mae.id)).toEqual({
      analyze: "SUCCEEDED",
      review: "SUCCEEDED",
      execute: "SUCCEEDED",
    });

    const review = (await listRunSteps(db, { userId: USER, runId: mae.id })).find(
      (step) => step.key === "review",
    );
    expect(review?.result).toMatchObject({
      kind: "delegate",
      childRunId: filho!.id,
      status: "SUCCEEDED",
      resultStatus: "completed",
      summary: "Revisão: aprovado com uma ressalva.",
      usage: { inputTokens: 40, outputTokens: 10 },
    });

    // O execute recebeu a saída do filho; o consumo do filho entrou na soma da mãe.
    const pedidoDoExecute = pedidos.find(
      (pedido) =>
        pedido.executionId.startsWith(mae.id) &&
        pedido.prompt.includes("Implemente o que a revisão"),
    );
    expect(pedidoDoExecute?.prompt).toContain("Revisão: aprovado com uma ressalva.");
    expect(terminado.result?.usage).toMatchObject({ inputTokens: 70, outputTokens: 20 });
    expect(codigos(diario)).toContain("DELEGATION_FINISHED");
    expect(await statusDaTask(db, cenario.taskId)).toBe("COMPLETED");

    const painel = await tiposDePainel();
    expect(painel).toContain("delegation.started");
    expect(painel).toContain("delegation.finished");
    expect(diario.at(-1)?.type).toBe("RunCompleted");
  });

  it("cancelar a mãe em espera cancela o filho em voo e fecha os dois", async () => {
    await criarRevisor();
    const cenario = await cenarioComRitual(
      "cascata",
      ritualComDelegacao({ childPrompt: "@@fake:hang" }),
    );
    await subirWorker({ maxConcurrentRuns: 2 });
    const mae = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });
    await esperarStatusDeRun(db, mae.id, ["WAITING_CHILD", "FAILED", "SUCCEEDED"]);
    const [filho] = await listChildRuns(db, { userId: USER, runId: mae.id });
    await esperarStatusDeRun(db, filho!.id, ["RUNNING", "FAILED", "SUCCEEDED"]);

    const pedido = await requestRunCancellation(db, { userId: USER, runId: mae.id });
    expect(pedido?.ok).toBe(true);

    const filhoCancelado = await esperarStatusDeRun(db, filho!.id, [
      "CANCELLED",
      "FAILED",
      "SUCCEEDED",
    ]);
    expect(filhoCancelado.status).toBe("CANCELLED");
    const maeCancelada = await esperarStatusDeRun(db, mae.id, ["CANCELLED", "FAILED", "SUCCEEDED"]);
    expect(maeCancelada.status).toBe("CANCELLED");
    expect(await statusDosSteps(mae.id)).toEqual({
      analyze: "SUCCEEDED",
      review: "CANCELLED",
      execute: "CANCELLED",
    });
    expect(await statusDaTask(db, cenario.taskId)).toBe("READY");
    expect((await eventosDoRun(db, mae.id)).at(-1)?.type).toBe("RunCancelled");
  });

  it("um Loadout que não existe assenta o passo em FAILED sem abrir filho", async () => {
    const cenario = await cenarioComRitual(
      "sem-loadout",
      ritualComDelegacao({ childPrompt: COMPLETED("x"), loadoutRef: "Bardo" }),
    );
    await subirWorker();
    const mae = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });
    const terminado = await esperarStatusDeRun(db, mae.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    expect(terminado.status).toBe("FAILED");
    expect(terminado.error?.["code"]).toBe("LOADOUT_REF_NOT_FOUND");
    expect(await listChildRuns(db, { userId: USER, runId: mae.id })).toHaveLength(0);
  });
});

describe("Selo por política", () => {
  const RITUAL_COM_SELO: WorkflowDefinition = WorkflowDefinitionSchema.parse({
    name: "Plano, Selo e execução",
    steps: [
      { type: "agent", key: "plan", name: "Planejar", prompt: COMPLETED("Plano.") },
      {
        type: "approval",
        key: "approve-plan",
        name: "Aprovar o plano",
        dependsOn: ["plan"],
        gateKey: "plan",
        title: "Aprovar o plano",
      },
      {
        type: "agent",
        key: "execute",
        name: "Executar",
        dependsOn: ["approve-plan"],
        when: [{ kind: "stepSucceeded", step: "approve-plan" }],
        prompt: COMPLETED("Executado."),
      },
    ],
  });

  it("AUTO_APPROVE no nível 3 concede o gate na hora, com POLICY:<id> no diário, e o Run não pausa", async () => {
    const cenario = await cenarioComRitual("selo-auto", RITUAL_COM_SELO);
    await updateProjectAutonomy(db, {
      userId: USER,
      projectId: cenario.projectId,
      autonomyLevel: 3,
    });
    const politica = exigirOk(
      await createApprovalPolicy(db, {
        userId: USER,
        name: "Selos de plano passam",
        subject: "GATE",
        projectId: cenario.projectId,
        conditions: { stepType: "approval" },
        action: "AUTO_APPROVE",
      }),
      "política",
    );
    await subirWorker();

    const run = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });
    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const diario = await eventosDoRun(db, run.id);
    expect(terminado.status, diarioDoRun(diario)).toBe("SUCCEEDED");
    expect(await statusDosSteps(run.id)).toEqual({
      plan: "SUCCEEDED",
      "approve-plan": "SUCCEEDED",
      execute: "SUCCEEDED",
    });

    const [gate] = await listRunApprovalGates(db, { userId: USER, runId: run.id });
    expect(gate?.status).toBe("GRANTED");
    expect(gate?.note).toContain(politica.id);
    const concedido = diario.find((evento) => evento.type === "ApprovalGranted");
    expect(concedido?.payload).toMatchObject({
      grantedBy: `POLICY:${politica.id}`,
      decidedBy: politica.id,
    });
    expect(codigos(diario)).toContain("POLICY_DECIDED");
    // Nunca passou por WAITING_APPROVAL: o diário não tem a espera.
    expect(diario.map((evento) => evento.type)).not.toContain("RunStarted");
    const painel = await tiposDePainel();
    expect(painel).toContain("approval.resolved");
    expect(painel).toContain("policy.decided");
  });

  it("DENY recusa o gate com a autoria da política; no nível 2 a mesma política só pausa", async () => {
    const cenario = await cenarioComRitual("selo-deny", RITUAL_COM_SELO);
    await updateProjectAutonomy(db, {
      userId: USER,
      projectId: cenario.projectId,
      autonomyLevel: 3,
    });
    const negacao = exigirOk(
      await createApprovalPolicy(db, {
        userId: USER,
        name: "Nada passa",
        subject: "GATE",
        projectId: cenario.projectId,
        action: "DENY",
      }),
      "política",
    );
    await subirWorker();

    const run = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });
    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    expect(terminado.status).toBe("FAILED");
    expect(terminado.error?.["code"]).toBe("APPROVAL_REJECTED");
    expect(await statusDosSteps(run.id)).toEqual({
      plan: "SUCCEEDED",
      "approve-plan": "FAILED",
      execute: "SKIPPED",
    });
    const recusado = (await eventosDoRun(db, run.id)).find(
      (evento) => evento.type === "ApprovalRejected",
    );
    expect(recusado?.payload).toMatchObject({ rejectedBy: `POLICY:${negacao.id}` });

    // A mesma Campanha rebaixada para o nível 2: um AUTO_APPROVE vira revisão
    // humana pela autonomia, e o Run pausa como sempre.
    await updateProjectAutonomy(db, {
      userId: USER,
      projectId: cenario.projectId,
      autonomyLevel: 2,
    });
    const outra = await montarCenario(db, {
      nome: "selo-nivel-2",
      workspacePath: repositorio.repo,
      workflowId: (
        await createWorkflow(db, {
          userId: USER,
          definition: { ...RITUAL_COM_SELO, name: "Plano, Selo e execução (2)" },
        }).then((r) => exigirOk(r, "workflow"))
      ).id,
    });
    await updateProjectAutonomy(db, { userId: USER, projectId: outra.projectId, autonomyLevel: 2 });
    exigirOk(
      await createApprovalPolicy(db, {
        userId: USER,
        name: "Selos passam (mas o nível não deixa)",
        subject: "GATE",
        projectId: outra.projectId,
        action: "AUTO_APPROVE",
      }),
      "política",
    );
    const pausado = await enfileirar(db, {
      taskId: outra.taskId,
      loadoutId: outra.loadoutId,
      prompt: "Faça a tarefa.",
    });
    const espera = await esperarStatusDeRun(db, pausado.id, [
      "WAITING_APPROVAL",
      "FAILED",
      "SUCCEEDED",
    ]);
    expect(espera.status).toBe("WAITING_APPROVAL");
    const decisao = codigos(await eventosDoRun(db, pausado.id));
    expect(decisao).toContain("POLICY_DECIDED");
  });
});

describe("disjuntores alimentados pelos desfechos", () => {
  it("duas falhas seguidas abrem; o terceiro Run fica na fila com BREAKER_OPEN; a sondagem fecha", async () => {
    const cenario = await montarCenario(db, { nome: "disjuntor", workspacePath: repositorio.repo });
    const breaker = exigirOk(
      await createCircuitBreaker(db, {
        userId: USER,
        name: "Duas falhas",
        scope: "PROJECT",
        projectId: cenario.projectId,
        consecutiveFailures: 2,
        cooldownMs: 1_500,
      }),
      "disjuntor",
    );
    const worker = await subirWorker({ maxConcurrentRuns: 1, start: false });

    // Três Runs na fila antes de o Worker começar: os dois primeiros falham.
    const primeira = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:error boom 1",
    });
    const segunda = exigirOk(
      await createTask(db, { userId: USER, projectId: cenario.projectId, title: "Segunda" }),
      "segunda Task",
    );
    const segundo = await enfileirar(db, {
      taskId: segunda.id,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:error boom 2",
    });
    const terceira = exigirOk(
      await createTask(db, { userId: USER, projectId: cenario.projectId, title: "Terceira" }),
      "terceira Task",
    );
    const terceiro = await enfileirar(db, {
      taskId: terceira.id,
      loadoutId: cenario.loadoutId,
      prompt: COMPLETED("sondagem ok"),
    });
    worker.start();

    expect((await esperarStatusDeRun(db, primeira.id, ["FAILED", "SUCCEEDED"])).status).toBe(
      "FAILED",
    );
    expect((await esperarStatusDeRun(db, segundo.id, ["FAILED", "SUCCEEDED"])).status).toBe(
      "FAILED",
    );

    // O disjuntor abriu no desfecho do segundo, na mesma transação.
    const aberto = await findCircuitBreakerRow(db, { userId: USER, circuitBreakerId: breaker.id });
    expect(aberto?.state).toBe("OPEN");
    expect(aberto?.consecutiveFailures).toBe(2);
    expect(aberto?.reason).toContain("2 falha(s) seguida(s)");
    expect(codigos(await eventosDoRun(db, segundo.id))).toContain("BREAKER_OPENED");

    // O terceiro fica na fila, anotado uma vez.
    await esperar("o Diagnostic BREAKER_OPEN no terceiro", async () =>
      codigos(await eventosDoRun(db, terceiro.id)).includes("BREAKER_OPEN") ? true : null,
    );
    expect((await getRun(db, { userId: USER, runId: terceiro.id }))?.status).toBe("QUEUED");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      codigos(await eventosDoRun(db, terceiro.id)).filter((c) => c === "BREAKER_OPEN"),
    ).toHaveLength(1);

    // O cooldown passa: o terceiro vira a sondagem, termina bem e fecha o disjuntor.
    const sondagem = await esperarStatusDeRun(db, terceiro.id, ["SUCCEEDED", "FAILED"], 30_000);
    expect(sondagem.status, diarioDoRun(await eventosDoRun(db, terceiro.id))).toBe("SUCCEEDED");
    const fechado = await findCircuitBreakerRow(db, { userId: USER, circuitBreakerId: breaker.id });
    expect(fechado).toMatchObject({ state: "CLOSED", probeRunId: null, consecutiveFailures: 0 });
    expect(codigos(await eventosDoRun(db, terceiro.id))).toContain("BREAKER_CLOSED");

    const painel = await tiposDePainel();
    expect(painel).toContain("breaker.opened");
    expect(painel).toContain("breaker.half_open");
    expect(painel).toContain("breaker.closed");
  });
});

describe("orçamentos no Worker", () => {
  it("PER_RUN maxTokens pequeno derruba o segundo passo com BUDGET_EXCEEDED sem subir agente", async () => {
    const cenario = await cenarioComRitual(
      "orcamento-passo",
      WorkflowDefinitionSchema.parse({
        name: "Dois agentes",
        steps: [
          {
            type: "agent",
            key: "first",
            name: "Primeiro",
            prompt: ["@@fake:usage 80 40", COMPLETED("primeiro")].join("\n"),
          },
          {
            type: "agent",
            key: "second",
            name: "Segundo",
            dependsOn: ["first"],
            prompt: COMPLETED("segundo"),
          },
        ],
      }),
    );
    exigirOk(
      await createBudget(db, {
        userId: USER,
        name: "Por Run",
        scope: "PROJECT",
        projectId: cenario.projectId,
        window: "PER_RUN",
        maxTokens: 100,
      }),
      "orçamento",
    );
    await subirWorker();

    const run = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });
    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const diario = await eventosDoRun(db, run.id);
    expect(terminado.status, diarioDoRun(diario)).toBe("FAILED");
    expect(terminado.error?.["code"]).toBe("BUDGET_EXCEEDED");
    expect(await statusDosSteps(run.id)).toEqual({ first: "SUCCEEDED", second: "FAILED" });
    expect(codigos(diario)).toContain("BUDGET_EXCEEDED");
    // Só um agente subiu: o segundo passo nunca chegou ao harness.
    expect(pedidos.filter((pedido) => pedido.executionId.startsWith(run.id))).toHaveLength(1);
  });

  it("na reclamação, um BLOCK estourado fecha o Run como FAILED BUDGET_EXCEEDED sem agente", async () => {
    const cenario = await montarCenario(db, {
      nome: "orcamento-claim",
      workspacePath: repositorio.repo,
    });
    const outraTask = exigirOk(
      await createTask(db, { userId: USER, projectId: cenario.projectId, title: "Segunda do dia" }),
      "segunda Task",
    );
    // Dois Runs do mesmo Project na fila e, só então, o teto de um Run por
    // dia: o mundo mudou depois do POST /runs.
    const primeiro = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: COMPLETED("a"),
    });
    await enfileirar(db, {
      taskId: outraTask.id,
      loadoutId: cenario.loadoutId,
      prompt: COMPLETED("b"),
    });
    exigirOk(
      await createBudget(db, {
        userId: USER,
        name: "Um por dia",
        scope: "PROJECT",
        projectId: cenario.projectId,
        window: "DAY",
        maxRuns: 1,
      }),
      "orçamento",
    );
    await subirWorker();

    const terminado = await esperarStatusDeRun(db, primeiro.id, ["SUCCEEDED", "FAILED"]);
    const diario = await eventosDoRun(db, primeiro.id);
    expect(terminado.status, diarioDoRun(diario)).toBe("FAILED");
    expect(terminado.error?.["code"]).toBe("BUDGET_EXCEEDED");
    expect(diario.map((evento) => evento.type)).not.toContain("RunStarted");
    expect(codigos(diario)).toContain("BUDGET_EXCEEDED");
    expect(await tiposDePainel()).toContain("budget.exceeded");
  });
});

describe("auto-despacho no nível 3", () => {
  async function taskDePolitica(projectId: string, title: string): Promise<string> {
    const id = newId();
    await db.insert(tasks).values({
      id,
      userId: USER,
      projectId,
      title,
      status: "READY",
      createdBy: "POLICY",
    });
    return id;
  }

  it("uma Task POLICY ganha um Run com createdBy POLICY quando há Loadout sugerido e a política autoriza", async () => {
    const cenario = await montarCenario(db, { nome: "despacho", workspacePath: repositorio.repo });
    await updateProjectAutonomy(db, {
      userId: USER,
      projectId: cenario.projectId,
      autonomyLevel: 3,
    });
    exigirOk(
      await updateLoadout(db, {
        userId: USER,
        loadoutId: cenario.loadoutId,
        patch: { isDefault: true },
      }),
      "Loadout padrão",
    );
    exigirOk(
      await createApprovalPolicy(db, {
        userId: USER,
        name: "Partidas automáticas passam",
        subject: "RUN_START",
        projectId: cenario.projectId,
        action: "AUTO_APPROVE",
      }),
      "política",
    );
    const taskId = await taskDePolitica(cenario.projectId, "Criada por política");
    // A Task da política precisa de um prompt roteirizado: o padrão é o título
    // e a descrição, então a descrição carrega a diretiva.
    await db
      .update(tasks)
      .set({ description: COMPLETED("despachada") })
      .where(eq(tasks.id, taskId));
    await subirWorker();

    const run = await esperar("o Run automático", async () => {
      const [criado] = (await listChildRunsOfTask(taskId)) ?? [];
      return criado ?? null;
    });
    expect(run.createdBy).toBe("POLICY");
    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED"]);
    expect(terminado.status, diarioDoRun(await eventosDoRun(db, run.id))).toBe("SUCCEEDED");
    expect(codigos(await eventosDoRun(db, run.id))).toContain("AUTO_DISPATCHED");
    expect(await tiposDePainel()).toContain("dispatch.created");

    // Idempotente: a Task só ganha um Run automático, mesmo depois de terminar.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await listChildRunsOfTask(taskId)).toHaveLength(1);
  });

  it("sem política que autorize a partida, a Task é pulada com dispatch.skipped e não ganha Run", async () => {
    const cenario = await montarCenario(db, {
      nome: "despacho-pulado",
      workspacePath: repositorio.repo,
    });
    await updateProjectAutonomy(db, {
      userId: USER,
      projectId: cenario.projectId,
      autonomyLevel: 3,
    });
    exigirOk(
      await updateLoadout(db, {
        userId: USER,
        loadoutId: cenario.loadoutId,
        patch: { isDefault: true },
      }),
      "Loadout padrão",
    );
    const taskId = await taskDePolitica(cenario.projectId, "Sem política de partida");
    await subirWorker();

    await esperar("o dispatch.skipped", async () =>
      (await tiposDePainel()).includes("dispatch.skipped") ? true : null,
    );
    expect(await listChildRunsOfTask(taskId)).toHaveLength(0);
    const eventos = await listDashboardEventsSince(db, {
      userId: USER,
      afterSequence: 0,
      limit: 500,
    });
    const pulado = eventos.find((evento) => evento.type === "dispatch.skipped");
    expect(pulado?.payload).toMatchObject({ taskId, code: "POLICY_REQUIRES_APPROVAL" });

    // No nível 2 a Task nem entra na lista: nada é gravado por ela.
    await updateProjectAutonomy(db, {
      userId: USER,
      projectId: cenario.projectId,
      autonomyLevel: 2,
    });
    const antes = (await tiposDePainel()).filter((tipo) => tipo === "dispatch.skipped").length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await tiposDePainel()).filter((tipo) => tipo === "dispatch.skipped").length).toBe(
      antes,
    );
  });

  async function listChildRunsOfTask(taskId: string) {
    const { listRunsForTask } = await import("@dungeon-master/database");
    return await listRunsForTask(db, { userId: USER, taskId });
  }
});

describe("ferramenta de delegação no nível 4", () => {
  it("o Claude Code (falso) chama delegate_task e o filho nasce DELEGATION; no nível 3 a ferramenta não é oferecida", async () => {
    await criarRevisor();
    const cenario = await montarCenario(db, { nome: "nivel-4", workspacePath: repositorio.repo });
    await updateProjectAutonomy(db, {
      userId: USER,
      projectId: cenario.projectId,
      autonomyLevel: 4,
    });
    await subirWorker({ maxConcurrentRuns: 2 });

    const childPrompt = COMPLETED("revisado pelo filho").replace(/"/g, '\\"');
    const mae = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: [
        `@@fake:mcp orchestration delegate_task {"loadout":"Revisor","prompt":"${childPrompt}"}`,
        COMPLETED("delegado"),
      ].join("\n"),
    });
    const terminada = await esperarStatusDeRun(db, mae.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const diario = await eventosDoRun(db, mae.id);
    expect(terminada.status, diarioDoRun(diario)).toBe("SUCCEEDED");

    const pedido = pedidos.find((item) => item.executionId.startsWith(mae.id));
    expect(pedido?.mcpServers?.map((server) => server.name)).toContain("orchestration");
    expect(pedido?.prompt).toContain("delegate_task");
    expect(codigos(diario)).toContain("DELEGATION_OFFERED");
    const resultado = diario.find((evento) => evento.type === "ToolResult");
    expect((resultado?.payload as { output: string }).output).toContain("Run filho aberto");

    const [filho] = await listChildRuns(db, { userId: USER, runId: mae.id });
    expect(filho).toMatchObject({
      createdBy: "DELEGATION",
      parentRunId: mae.id,
      parentStepKey: null,
      taskId: cenario.taskId,
    });
    expect(filho?.loadoutSnapshot.name).toBe("Revisor");
    const filhoTerminado = await esperarStatusDeRun(db, filho!.id, ["SUCCEEDED", "FAILED"]);
    expect(filhoTerminado.status, diarioDoRun(await eventosDoRun(db, filho!.id))).toBe("SUCCEEDED");
    expect(filhoTerminado.result?.summary).toBe("revisado pelo filho");
    expect(codigos(await eventosDoRun(db, filho!.id))).toContain("DELEGATED_FROM");

    // No nível 3 o servidor não sobe: o pedido chega sem ele e o diário diz.
    await updateProjectAutonomy(db, {
      userId: USER,
      projectId: cenario.projectId,
      autonomyLevel: 3,
    });
    const outra = await montarCenario(db, { nome: "nivel-3", workspacePath: repositorio.repo });
    await updateProjectAutonomy(db, { userId: USER, projectId: outra.projectId, autonomyLevel: 3 });
    const semFerramenta = await enfileirar(db, {
      taskId: outra.taskId,
      loadoutId: outra.loadoutId,
      prompt: COMPLETED("sem delegar"),
    });
    await esperarStatusDeRun(db, semFerramenta.id, ["SUCCEEDED", "FAILED"]);
    const pedidoSem = pedidos.find((item) => item.executionId.startsWith(semFerramenta.id));
    expect(pedidoSem?.mcpServers?.map((server) => server.name) ?? []).not.toContain(
      "orchestration",
    );
    expect(codigos(await eventosDoRun(db, semFerramenta.id))).not.toContain("DELEGATION_OFFERED");
  });
});
