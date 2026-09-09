import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { WorkflowDefinition } from "@dungeon-master/contracts";
import { WorkflowDefinitionSchema } from "@dungeon-master/contracts";
import {
  createWorkflow,
  getRun,
  listKnowledgeCandidates,
  listProposedTasks,
  listRunApprovalGates,
  listRunSteps,
  listWorkspaceLocksByRun,
  requestRunCancellation,
  resolveApprovalGate,
  runs,
  tasks,
  updateWorkflow,
  type Database,
  type DatabaseHandle,
} from "@dungeon-master/database";
import { createWorkspaceManager } from "@dungeon-master/runtime";
import { fakeHarness } from "@dungeon-master/runtime/testing";
import { and, eq } from "drizzle-orm";
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
  type RepositorioTemporario,
} from "./support.js";

/**
 * O Run com Workflow no Worker, com banco embutido e o harness falso.
 *
 * O roteiro de cada step de agente é o prompt dele: o agente falso lê as
 * diretivas `@@fake:` de onde estiverem no texto. O que se prova aqui é a
 * fiação — RunSteps no banco, gate por CAS, retomada por outra instância do
 * Worker, cancelamento em espera —; a coreografia do motor tem os testes dela
 * em `@dungeon-master/workflow`.
 */

let handle: DatabaseHandle;
let db: Database;
let repositorio: RepositorioTemporario;
const workers: Worker[] = [];

function managerPara(repo: RepositorioTemporario) {
  return createWorkspaceManager({ worktreesRoot: join(repo.sandbox, "worktrees") });
}

async function subirWorker(input: { workerId?: string; start?: boolean } = {}): Promise<Worker> {
  const criado = createWorker({
    db,
    pool: handle.pool,
    userId: USER,
    adapters: [fakeHarness()],
    workspace: managerPara(repositorio),
    config: { ...CONFIG_PADRAO, workerId: input.workerId ?? newWorkerId() },
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

/** A "Expedição guiada" com os agentes roteirizados para o harness falso. */
const EXPEDICAO_GUIADA: WorkflowDefinition = WorkflowDefinitionSchema.parse({
  name: "Expedição guiada (teste)",
  steps: [
    {
      type: "agent",
      key: "analyze",
      name: "Analisar",
      prompt: [
        "Analise a tarefa.",
        "@@fake:session sessao-analyze",
        '@@fake:block {"status":"completed","summary":"Analise: um arquivo a criar."}',
      ].join("\n"),
    },
    {
      type: "agent",
      key: "plan",
      name: "Planejar",
      dependsOn: ["analyze"],
      includeOutputsOf: ["analyze"],
      prompt: [
        "Escreva o plano.",
        "@@fake:session sessao-plan",
        '@@fake:block {"status":"completed","summary":"Plano: criar PLANO.md e commitar."}',
      ].join("\n"),
    },
    {
      type: "approval",
      key: "approve-plan",
      name: "Aprovar o plano",
      dependsOn: ["plan"],
      gateKey: "plan",
      title: "Aprovar o plano de implementação",
      description: "O plano precisa de aprovação.",
    },
    {
      type: "agent",
      key: "execute",
      name: "Executar",
      dependsOn: ["approve-plan"],
      includeOutputsOf: ["plan"],
      when: [{ kind: "stepSucceeded", step: "approve-plan" }],
      prompt: [
        "Implemente o plano.",
        "@@fake:session sessao-execute",
        "@@fake:write PLANO.md plano executado",
        "@@fake:git add -A",
        "@@fake:git commit -m executa-plano",
        "@@fake:usage 50 20",
        '@@fake:block {"status":"completed","summary":"Executado.","artifacts":[{"path":"PLANO.md"}],' +
          '"knowledgeCandidates":[{"title":"Dica","content":"Commit cedo."}],' +
          '"discoveredTasks":[{"title":"Revisar o PLANO.md","rationale":"Ficou sem revisão."}]}',
      ].join("\n"),
    },
    {
      type: "validation",
      key: "validate",
      name: "Validar",
      dependsOn: ["execute"],
      argv: ["git", "status", "--porcelain"],
    },
  ],
});

async function criarWorkflow(definition: WorkflowDefinition = EXPEDICAO_GUIADA): Promise<string> {
  return exigirOk(await createWorkflow(db, { userId: USER, definition }), "a criação do Workflow")
    .id;
}

async function statusDosSteps(runId: string): Promise<Record<string, string>> {
  const steps = await listRunSteps(db, { userId: USER, runId });
  return Object.fromEntries(steps.map((step) => [step.key, step.status]));
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
  repositorio = await criarRepositorio("dm-worker-wf-");
});

afterEach(async () => {
  for (const worker of [...workers]) await pararWorker(worker);
  await limpar(handle);
  await repositorio.remover();
});

describe("Expedição guiada no Worker", () => {
  it("pausa no gate, sobrevive ao restart do Worker e termina depois da aprovação", async () => {
    const workflowId = await criarWorkflow();
    const cenario = await montarCenario(db, {
      nome: "guiada",
      workspacePath: repositorio.repo,
      workflowId,
    });
    const primeiro = await subirWorker();

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });
    expect(criado.workflowVersionId).not.toBeNull();

    // ---------------------------------------------------------------- pausa
    const pausado = await esperarStatusDeRun(db, criado.id, [
      "WAITING_APPROVAL",
      "FAILED",
      "SUCCEEDED",
    ]);
    const diarioPausa = diarioDoRun(await eventosDoRun(db, criado.id));
    expect(pausado.status, diarioPausa).toBe("WAITING_APPROVAL");
    expect(await statusDaTask(db, cenario.taskId)).toBe("RUNNING");

    expect(await statusDosSteps(criado.id)).toEqual({
      analyze: "SUCCEEDED",
      plan: "SUCCEEDED",
      "approve-plan": "WAITING_APPROVAL",
      execute: "PENDING",
      validate: "PENDING",
    });

    const [gate] = await listRunApprovalGates(db, { userId: USER, runId: criado.id });
    expect(gate?.status).toBe("PENDING");
    expect(gate?.gateKey).toBe("plan");

    const tipos = (await eventosDoRun(db, criado.id)).map((evento) => evento.type);
    expect(tipos).toContain("ApprovalRequested");
    expect(tipos.filter((tipo) => tipo === "StepStarted")).toHaveLength(3);
    expect(tipos).not.toContain("RunCompleted");
    expect(tipos).not.toContain("RunStarted");

    // A trava saiu ao pausar; o Worker não segura nada em voo.
    expect(await listWorkspaceLocksByRun(db, { userId: USER, runId: criado.id })).toHaveLength(0);
    await esperar("o Worker soltar o Run", () =>
      Promise.resolve(primeiro.inFlight === 0 ? true : null),
    );

    // O worktree fica de pé, com a sessão do último agente no Run.
    expect(pausado.workspacePath).toContain("worktrees");
    await expect(stat(pausado.workspacePath as string)).resolves.toBeDefined();
    expect(pausado.harnessSessionId).toBe("sessao-plan");

    // A definição editada depois não alcança este Run.
    exigirOk(
      await updateWorkflow(db, {
        userId: USER,
        workflowId,
        definition: WorkflowDefinitionSchema.parse({
          ...EXPEDICAO_GUIADA,
          steps: EXPEDICAO_GUIADA.steps.filter((step) => step.key !== "validate"),
        }),
      }),
      "a edição do Workflow",
    );

    // -------------------------------------------------------------- restart
    await pararWorker(primeiro);
    const segundo = await subirWorker();
    expect(segundo.workerId).not.toBe(primeiro.workerId);

    // O restart não mexeu no Run pausado.
    expect((await getRun(db, { userId: USER, runId: criado.id }))?.status).toBe("WAITING_APPROVAL");

    // ------------------------------------------------------------ aprovação
    const decidido = await resolveApprovalGate(db, {
      userId: USER,
      gateId: gate!.id,
      decision: "approve",
      note: "Pode seguir.",
    });
    expect(decidido?.ok).toBe(true);
    // Sai da espera; o degrau é com o Worker, que já está no ar e é acordado por
    // `NOTIFY` — `PREPARING` aqui é tão correto quanto `QUEUED`.
    expect((await getRun(db, { userId: USER, runId: criado.id }))?.status).not.toBe(
      "WAITING_APPROVAL",
    );

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const diario = diarioDoRun(await eventosDoRun(db, criado.id));
    expect(terminado.status, `${JSON.stringify(terminado.error)}\n${diario}`).toBe("SUCCEEDED");

    expect(await statusDosSteps(criado.id)).toEqual({
      analyze: "SUCCEEDED",
      plan: "SUCCEEDED",
      "approve-plan": "SUCCEEDED",
      execute: "SUCCEEDED",
      validate: "SUCCEEDED",
    });

    const steps = await listRunSteps(db, { userId: USER, runId: criado.id });
    const porChave = new Map(steps.map((step) => [step.key, step]));
    expect(porChave.get("analyze")?.attempt).toBe(1);
    expect(porChave.get("approve-plan")?.result).toMatchObject({
      kind: "approval",
      decision: "approve",
      note: "Pode seguir.",
    });
    expect(porChave.get("execute")?.result).toMatchObject({
      kind: "agent",
      status: "completed",
      harnessSessionId: "sessao-execute",
      artifacts: [{ path: "PLANO.md" }],
      usage: { inputTokens: 50, outputTokens: 20 },
    });
    // `git status --porcelain` rodou no worktree, depois do commit do agente.
    expect(porChave.get("validate")?.result).toMatchObject({
      kind: "validation",
      verdict: "passed",
      exitCode: 0,
    });

    // O resultado agregado do Run tem o formato de sempre, e a Task fechou.
    expect(terminado.result?.status).toBe("completed");
    expect(terminado.result?.summary).toBe("Executado.");
    expect(terminado.result?.["knowledgeCandidates"]).toEqual([
      { title: "Dica", content: "Commit cedo." },
    ]);
    expect(terminado.result?.["discoveredTasks"]).toEqual([
      { title: "Revisar o PLANO.md", rationale: "Ficou sem revisão." },
    ]);
    expect(terminado.result?.usage?.inputTokens).toBe(50);
    expect(terminado.harnessSessionId).toBe("sessao-execute");
    expect(await statusDaTask(db, cenario.taskId)).toBe("COMPLETED");

    // O resultado agregado alimentou o domínio na transação do desfecho
    // (Fase 5), pelo mesmo caminho do Run simples.
    const propostas = await listProposedTasks(db, { userId: USER, page: 1, pageSize: 10 });
    expect(propostas.items.map((item) => [item.title, item.originRunId, item.status])).toEqual([
      ["Revisar o PLANO.md", criado.id, "PROPOSED"],
    ]);
    const candidatos = await listKnowledgeCandidates(db, { userId: USER, page: 1, pageSize: 10 });
    expect(candidatos.items.map((item) => [item.title, item.runId])).toEqual([["Dica", criado.id]]);

    // O commit do agente foi coletado do worktree reaberto.
    const commits = terminado.result?.["commits"] as ReadonlyArray<{ subject: string }> | undefined;
    expect(
      commits?.map((commit) => commit.subject),
      diario,
    ).toEqual(["executa-plano"]);

    // O diário conta a retomada e termina no evento terminal.
    const tiposFinais = (await eventosDoRun(db, criado.id)).map((evento) => evento.type);
    expect(tiposFinais).toContain("ApprovalGranted");
    expect(tiposFinais.at(-1)).toBe("RunCompleted");
    expect(tiposFinais.filter((tipo) => tipo === "RunCompleted")).toHaveLength(1);
    expect(tiposFinais.filter((tipo) => tipo === "StepFinished")).toHaveLength(5);
  });

  it("recusa do gate leva execute e validate a SKIPPED e o Run a FAILED", async () => {
    const workflowId = await criarWorkflow();
    const cenario = await montarCenario(db, {
      nome: "recusada",
      workspacePath: repositorio.repo,
      workflowId,
    });
    await subirWorker();

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });
    await esperarStatusDeRun(db, criado.id, ["WAITING_APPROVAL", "FAILED", "SUCCEEDED"]);
    const [gate] = await listRunApprovalGates(db, { userId: USER, runId: criado.id });

    const decidido = await resolveApprovalGate(db, {
      userId: USER,
      gateId: gate!.id,
      decision: "reject",
      note: "Plano incompleto.",
    });
    expect(decidido?.ok).toBe(true);

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const diario = diarioDoRun(await eventosDoRun(db, criado.id));
    expect(terminado.status, diario).toBe("FAILED");
    expect(terminado.error?.["code"]).toBe("APPROVAL_REJECTED");
    expect(terminado.error?.message).toContain("Plano incompleto.");
    expect(await statusDosSteps(criado.id)).toEqual({
      analyze: "SUCCEEDED",
      plan: "SUCCEEDED",
      "approve-plan": "FAILED",
      execute: "SKIPPED",
      validate: "SKIPPED",
    });
    expect(terminado.result?.warnings).toHaveLength(2);
    expect(await statusDaTask(db, cenario.taskId)).toBe("FAILED");

    // O worktree é preservado numa falha.
    await expect(stat(terminado.error?.["preservedWorktreePath"] as string)).resolves.toBeDefined();
  });
});

describe("cancelamento em espera de aprovação", () => {
  it("o laço ocioso fecha o Run, cancela o passo do gate e uma decisão posterior é recusada", async () => {
    const workflowId = await criarWorkflow();
    const cenario = await montarCenario(db, {
      nome: "cancelar-espera",
      workspacePath: repositorio.repo,
      workflowId,
    });
    await subirWorker();

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });
    await esperarStatusDeRun(db, criado.id, ["WAITING_APPROVAL", "FAILED", "SUCCEEDED"]);

    // Pedir não é cancelar: em WAITING_APPROVAL a API só marca a coluna.
    const pedido = await requestRunCancellation(db, { userId: USER, runId: criado.id });
    expect(pedido?.ok).toBe(true);
    expect(pedido?.ok ? pedido.value.status : "").toBe("WAITING_APPROVAL");

    const terminado = await esperarStatusDeRun(db, criado.id, ["CANCELLED", "FAILED", "SUCCEEDED"]);
    expect(terminado.status).toBe("CANCELLED");
    expect(terminado.error?.["processTreeTerminated"]).toBe(true);
    expect(await statusDaTask(db, cenario.taskId)).toBe("READY");

    expect(await statusDosSteps(criado.id)).toEqual({
      analyze: "SUCCEEDED",
      plan: "SUCCEEDED",
      "approve-plan": "CANCELLED",
      execute: "CANCELLED",
      validate: "CANCELLED",
    });

    const eventos = await eventosDoRun(db, criado.id);
    expect(eventos.at(-1)?.type).toBe("RunCancelled");

    // O gate continua PENDING, e a decisão que chega depois é recusada.
    const [gate] = await listRunApprovalGates(db, { userId: USER, runId: criado.id });
    expect(gate?.status).toBe("PENDING");
    const tardia = await resolveApprovalGate(db, {
      userId: USER,
      gateId: gate!.id,
      decision: "approve",
    });
    expect(tardia?.ok).toBe(false);
    expect(tardia?.ok === false ? tardia.failure.code : "").toBe("RUN_NOT_WAITING_APPROVAL");
  });
});

describe("reconciliação de Run com Workflow", () => {
  it("assenta o passo em RUNNING como FAILED e os pendentes como CANCELLED", async () => {
    const workflowId = await criarWorkflow();
    const cenario = await montarCenario(db, {
      nome: "orfao-wf",
      workspacePath: repositorio.repo,
      workflowId,
    });

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "Faça a tarefa.",
    });

    // O estado que um `kill -9` congela: Run e Task em RUNNING, o primeiro
    // passo em RUNNING, reclamado por um processo que não existe mais.
    await db
      .update(runs)
      .set({ status: "RUNNING", claimedBy: "worker-morto", startedAt: new Date() })
      .where(and(eq(runs.id, criado.id), eq(runs.userId, USER)));
    await db
      .update(tasks)
      .set({ status: "RUNNING" })
      .where(and(eq(tasks.id, cenario.taskId), eq(tasks.userId, USER)));
    const { runSteps } = await import("@dungeon-master/database");
    await db
      .update(runSteps)
      .set({ status: "RUNNING", attempt: 1, startedAt: new Date() })
      .where(and(eq(runSteps.runId, criado.id), eq(runSteps.key, "analyze")));

    await subirWorker({ start: false });

    const run = await getRun(db, { userId: USER, runId: criado.id });
    expect(run?.status).toBe("FAILED");
    expect(run?.error?.["code"]).toBe("WORKER_LOST");
    expect(await statusDosSteps(criado.id)).toEqual({
      analyze: "FAILED",
      plan: "CANCELLED",
      "approve-plan": "CANCELLED",
      execute: "CANCELLED",
      validate: "CANCELLED",
    });
    const analyze = (await listRunSteps(db, { userId: USER, runId: criado.id })).find(
      (step) => step.key === "analyze",
    );
    expect(analyze?.error?.code).toBe("WORKER_LOST");
  });
});

describe("Run simples continua igual", () => {
  it("uma Task sem Workflow roda pelo caminho de um agente só", async () => {
    const cenario = await montarCenario(db, { nome: "simples", workspacePath: repositorio.repo });
    await subirWorker();

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: [
        "@@fake:write OLA.md ola",
        '@@fake:block {"status":"completed","summary":"pronto"}',
      ].join("\n"),
    });
    expect(criado.workflowVersionId).toBeNull();

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);
    expect(terminado.status, JSON.stringify(terminado.error)).toBe("SUCCEEDED");
    expect(await listRunSteps(db, { userId: USER, runId: criado.id })).toHaveLength(0);
    expect((await eventosDoRun(db, criado.id)).map((evento) => evento.type)).toContain(
      "RunStarted",
    );
    const preservado = terminado.result?.["preservedWorktreePath"] as string;
    expect((await readFile(join(preservado, "OLA.md"), "utf8")).trim()).toBe("ola");
  });
});
