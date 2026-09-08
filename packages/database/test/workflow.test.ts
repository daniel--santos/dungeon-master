import { type WorkflowDefinition, WorkflowDefinitionSchema } from "@dungeon-master/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import {
  createApprovalGate,
  listApprovalGates,
  listRunApprovalGates,
  resolveApprovalGate,
} from "../src/approval-gate.js";
import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { listRunEventsSince } from "../src/run-event.js";
import { listRunSteps, transitionRunStep } from "../src/run-step.js";
import { claimNextQueuedRun, createRun, getRun, transitionRun } from "../src/run.js";
import { GUIDED_EXPEDITION_WORKFLOW, seedWorkflows } from "../src/seed-workflow.js";
import { createTask, getTaskDetail, updateTask } from "../src/task.js";
import {
  canonicalJson,
  captureWorkflowVersion,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  getWorkflowVersionDetail,
  listWorkflows,
  listWorkflowVersions,
  updateWorkflow,
} from "../src/workflow.js";
import {
  criarEquipamento,
  criarProjectComWorkspace,
  type Equipamento,
  exigirOk,
  limparExecucao,
  USER,
} from "./support.js";

let handle: DatabaseHandle;
let equipamento: Equipamento;
let projectId: string;

const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-workflow",
  });
});

beforeEach(async () => {
  await limparExecucao(handle);
  const project = await criarProjectComWorkspace(handle.db, {
    title: "Forja de Widgets",
    workspacePath: "C:\\repos\\forja",
  });
  projectId = project.id;
  equipamento = await criarEquipamento(handle.db, { nome: "de ritual" });
});

afterAll(async () => {
  await limparExecucao(handle);
  await handle.close();
});

function definicao(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse({ ...GUIDED_EXPEDITION_WORKFLOW, ...overrides });
}

async function criarWorkflow(overrides: Partial<WorkflowDefinition> = {}): Promise<string> {
  const created = exigirOk(
    await createWorkflow(handle.db, { userId: USER, definition: definicao(overrides) }),
    "a criação do Workflow",
  );
  return created.id;
}

async function criarTaskComWorkflow(workflowId: string, title = "Missão guiada"): Promise<string> {
  const task = exigirOk(
    await createTask(handle.db, { userId: USER, projectId, title, workflowId }),
    "a criação da Task",
  );
  return task.id;
}

async function criarRunGuiado(workflowId: string): Promise<{ runId: string; taskId: string }> {
  const taskId = await criarTaskComWorkflow(workflowId);
  const run = exigirOk(
    await createRun(handle.db, { userId: USER, taskId, loadoutId: equipamento.loadoutId }),
    "a criação do Run",
  );
  return { runId: run.id, taskId };
}

/** Leva o Run a RUNNING como o Worker faria, e o step de aprovação a RUNNING. */
async function levarAoGate(runId: string): Promise<void> {
  const claimed = await claimNextQueuedRun(handle.db, { userId: USER });
  expect(claimed?.run.id).toBe(runId);
  exigirOk(await transitionRun(handle.db, { userId: USER, runId, to: "RUNNING" }), "RUNNING");

  for (const key of ["analyze", "plan"]) {
    exigirOk(
      await transitionRunStep(handle.db, {
        userId: USER,
        runId,
        stepKey: key,
        from: "PENDING",
        to: "RUNNING",
        incrementAttempt: true,
      }),
      `${key} → RUNNING`,
    );
    exigirOk(
      await transitionRunStep(handle.db, {
        userId: USER,
        runId,
        stepKey: key,
        from: "RUNNING",
        to: "SUCCEEDED",
        patch: { result: { kind: "agent", status: "completed", summary: `${key} ok` } },
      }),
      `${key} → SUCCEEDED`,
    );
  }

  exigirOk(
    await transitionRunStep(handle.db, {
      userId: USER,
      runId,
      stepKey: "approve-plan",
      from: "PENDING",
      to: "RUNNING",
      incrementAttempt: true,
    }),
    "approve-plan → RUNNING",
  );
}

async function abrirGate(runId: string): Promise<string> {
  const opened = exigirOk(
    await createApprovalGate(handle.db, {
      userId: USER,
      runId,
      stepKey: "approve-plan",
      gateKey: "plan",
      title: "Aprovar o plano",
    }),
    "a abertura do gate",
  );
  expect(opened.created).toBe(true);
  return opened.gate.id;
}

async function tiposDeRunEvent(runId: string): Promise<string[]> {
  const events = await listRunEventsSince(handle.db, { userId: USER, runId, afterSequence: 0 });
  return events.map((event) => event.type);
}

describe("canonicalJson", () => {
  it("ignora a ordem das chaves e campos undefined", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }], e: undefined })).toBe(
      canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});

describe("Workflow: CRUD", () => {
  it("cria, lista em ordem alfabética e lê com latestVersion nulo", async () => {
    const bId = await criarWorkflow({ name: "Beta" });
    const aId = await criarWorkflow({ name: "Alfa" });

    const page = await listWorkflows(handle.db, { userId: USER, page: 1, pageSize: 10 });
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.id)).toEqual([aId, bId]);

    const lido = await getWorkflow(handle.db, { userId: USER, workflowId: aId });
    expect(lido?.name).toBe("Alfa");
    expect(lido?.latestVersion).toBeNull();
    expect(lido?.definition.steps).toHaveLength(5);
  });

  it("recusa nome repetido na criação e na edição", async () => {
    await criarWorkflow({ name: "Único" });
    const outro = await criarWorkflow({ name: "Outro" });

    const duplicado = await createWorkflow(handle.db, {
      userId: USER,
      definition: definicao({ name: "Único" }),
    });
    expect(duplicado).toEqual({ ok: false, failure: { code: "NAME_TAKEN", name: "Único" } });

    const renomeado = await updateWorkflow(handle.db, {
      userId: USER,
      workflowId: outro,
      definition: definicao({ name: "Único" }),
    });
    expect(renomeado).toEqual({ ok: false, failure: { code: "NAME_TAKEN", name: "Único" } });
  });

  it("edita a definição inteira e apaga quando nenhum Run usa", async () => {
    const id = await criarWorkflow();

    const updated = exigirOk(
      await updateWorkflow(handle.db, {
        userId: USER,
        workflowId: id,
        definition: definicao({ name: "Renomeado", description: "nova" }),
      }),
      "a edição",
    );
    expect(updated.name).toBe("Renomeado");
    expect(updated.description).toBe("nova");
    expect(updated.definition.name).toBe("Renomeado");

    expect(await deleteWorkflow(handle.db, { userId: USER, workflowId: id })).toEqual({
      ok: true,
      value: null,
    });
    expect(await getWorkflow(handle.db, { userId: USER, workflowId: id })).toBeNull();
    expect(await deleteWorkflow(handle.db, { userId: USER, workflowId: id })).toBeNull();
  });

  it("apagar sem Run devolve as Tasks ao Run simples", async () => {
    const id = await criarWorkflow();
    const taskId = await criarTaskComWorkflow(id);

    exigirOk(await deleteWorkflow(handle.db, { userId: USER, workflowId: id }), "a remoção");

    const task = await getTaskDetail(handle.db, { userId: USER, taskId });
    expect(task?.workflowId).toBeNull();
  });
});

describe("Task e Workflow", () => {
  it("recusa Workflow inexistente na criação e na edição", async () => {
    const criada = await createTask(handle.db, {
      userId: USER,
      projectId,
      title: "Sem ritual",
      workflowId: ID_INEXISTENTE,
    });
    expect(criada).toEqual({
      ok: false,
      failure: { code: "WORKFLOW_NOT_FOUND", workflowId: ID_INEXISTENTE },
    });

    const task = exigirOk(
      await createTask(handle.db, { userId: USER, projectId, title: "Simples" }),
      "a Task",
    );
    const editada = await updateTask(handle.db, {
      userId: USER,
      taskId: task.id,
      patch: { workflowId: ID_INEXISTENTE },
    });
    expect(editada).toEqual({
      ok: false,
      failure: { code: "WORKFLOW_NOT_FOUND", workflowId: ID_INEXISTENTE },
    });
  });

  it("liga e desliga o Workflow pelo patch", async () => {
    const id = await criarWorkflow();
    const task = exigirOk(
      await createTask(handle.db, { userId: USER, projectId, title: "Simples" }),
      "a Task",
    );

    const ligada = exigirOk(
      await updateTask(handle.db, { userId: USER, taskId: task.id, patch: { workflowId: id } }),
      "ligar",
    );
    expect(ligada.workflowId).toBe(id);

    const desligada = exigirOk(
      await updateTask(handle.db, { userId: USER, taskId: task.id, patch: { workflowId: null } }),
      "desligar",
    );
    expect(desligada.workflowId).toBeNull();
  });
});

describe("captura congelada", () => {
  it("captureWorkflowVersion é idempotente por conteúdo", async () => {
    const id = await criarWorkflow();

    const primeira = await captureWorkflowVersion(handle.db, { userId: USER, workflowId: id });
    const segunda = await captureWorkflowVersion(handle.db, { userId: USER, workflowId: id });

    expect(primeira?.created).toBe(true);
    expect(primeira?.version.version).toBe(1);
    expect(primeira?.steps.map((step) => step.key)).toEqual([
      "analyze",
      "plan",
      "approve-plan",
      "execute",
      "validate",
    ]);
    expect(primeira?.steps.map((step) => step.position)).toEqual([0, 1, 2, 3, 4]);

    expect(segunda?.created).toBe(false);
    expect(segunda?.version.id).toBe(primeira?.version.id);

    expect(
      await captureWorkflowVersion(handle.db, { userId: USER, workflowId: ID_INEXISTENTE }),
    ).toBeNull();
  });

  it("uma edição gera versão nova só no próximo Run; o Run antigo não muda", async () => {
    const id = await criarWorkflow();
    const { runId } = await criarRunGuiado(id);

    const run = await getRun(handle.db, { userId: USER, runId });
    expect(run?.workflowVersionId).not.toBeNull();
    const versionId = run!.workflowVersionId!;

    const steps = await listRunSteps(handle.db, { userId: USER, runId });
    expect(steps.map((step) => [step.key, step.status, step.attempt, step.position])).toEqual([
      ["analyze", "PENDING", 0, 0],
      ["plan", "PENDING", 0, 1],
      ["approve-plan", "PENDING", 0, 2],
      ["execute", "PENDING", 0, 3],
      ["validate", "PENDING", 0, 4],
    ]);

    // Edita o Workflow: tira o step de validação.
    const semValidate = definicao({
      steps: GUIDED_EXPEDITION_WORKFLOW.steps.filter((step) => step.key !== "validate"),
    });
    exigirOk(
      await updateWorkflow(handle.db, { userId: USER, workflowId: id, definition: semValidate }),
      "a edição",
    );

    const depois = await getRun(handle.db, { userId: USER, runId });
    expect(depois?.workflowVersionId).toBe(versionId);
    expect((await listRunSteps(handle.db, { userId: USER, runId })).map((s) => s.key)).toContain(
      "validate",
    );

    const detalhe = await getWorkflowVersionDetail(handle.db, {
      userId: USER,
      workflowVersionId: versionId,
    });
    expect(detalhe?.version).toBe(1);
    expect(detalhe?.definition.steps).toHaveLength(5);
    expect(detalhe?.steps.map((step) => step.key)).toContain("validate");

    // O próximo Run de outra Task captura a versão 2.
    const { runId: segundo } = await criarRunGuiado(id);
    const runDois = await getRun(handle.db, { userId: USER, runId: segundo });
    expect(runDois?.workflowVersionId).not.toBe(versionId);
    expect(
      (await listRunSteps(handle.db, { userId: USER, runId: segundo })).map((s) => s.key),
    ).toEqual(["analyze", "plan", "approve-plan", "execute"]);

    const versoes = await listWorkflowVersions(handle.db, {
      userId: USER,
      workflowId: id,
      page: 1,
      pageSize: 10,
    });
    expect(versoes.total).toBe(2);
    expect(versoes.items.map((item) => item.version)).toEqual([2, 1]);
    expect((await getWorkflow(handle.db, { userId: USER, workflowId: id }))?.latestVersion).toBe(2);
  });

  it("recusa apagar um Workflow com versão usada por Run", async () => {
    const id = await criarWorkflow();
    const { runId } = await criarRunGuiado(id);

    const result = await deleteWorkflow(handle.db, { userId: USER, workflowId: id });
    expect(result).toEqual({ ok: false, failure: { code: "IN_USE_BY_RUN", runIds: [runId] } });
  });

  it("um Run de Task sem Workflow continua sem versão e sem steps", async () => {
    const task = exigirOk(
      await createTask(handle.db, { userId: USER, projectId, title: "Simples" }),
      "a Task",
    );
    const run = exigirOk(
      await createRun(handle.db, {
        userId: USER,
        taskId: task.id,
        loadoutId: equipamento.loadoutId,
      }),
      "o Run",
    );
    expect(run.workflowVersionId).toBeNull();
    expect(await listRunSteps(handle.db, { userId: USER, runId: run.id })).toEqual([]);
  });
});

describe("transitionRunStep", () => {
  it("é um CAS: perde quando o estado já mudou, e devolve o atual", async () => {
    const id = await criarWorkflow();
    const { runId } = await criarRunGuiado(id);

    const started = exigirOk(
      await transitionRunStep(handle.db, {
        userId: USER,
        runId,
        stepKey: "analyze",
        from: "PENDING",
        to: "RUNNING",
        incrementAttempt: true,
        events: [
          {
            type: "StepStarted",
            payload: { type: "StepStarted", stepKey: "analyze", stepType: "agent", attempt: 1 },
          },
        ],
      }),
      "PENDING → RUNNING",
    );
    expect(started.status).toBe("RUNNING");
    expect(started.attempt).toBe(1);
    expect(started.startedAt).not.toBeNull();

    const perdeu = await transitionRunStep(handle.db, {
      userId: USER,
      runId,
      stepKey: "analyze",
      from: "PENDING",
      to: "RUNNING",
    });
    expect(perdeu).toMatchObject({
      ok: false,
      failure: { code: "RUN_STEP_STATUS_CHANGED", expected: "PENDING" },
    });

    const invalida = await transitionRunStep(handle.db, {
      userId: USER,
      runId,
      stepKey: "analyze",
      from: "RUNNING",
      to: "SKIPPED",
    });
    expect(invalida).toMatchObject({
      ok: false,
      failure: { code: "RUN_STEP_TRANSITION_REJECTED" },
    });

    expect(await tiposDeRunEvent(runId)).toEqual(["StepStarted"]);
    expect(
      await transitionRunStep(handle.db, {
        userId: USER,
        runId,
        stepKey: "ghost",
        from: "PENDING",
        to: "RUNNING",
      }),
    ).toBeNull();
  });

  it("a retentativa volta a PENDING e a próxima entrada soma a tentativa", async () => {
    const id = await criarWorkflow();
    const { runId } = await criarRunGuiado(id);
    const mover = (from: "PENDING" | "RUNNING", to: "PENDING" | "RUNNING") =>
      transitionRunStep(handle.db, {
        userId: USER,
        runId,
        stepKey: "analyze",
        from,
        to,
        incrementAttempt: to === "RUNNING",
      });

    exigirOk(await mover("PENDING", "RUNNING"), "1ª");
    exigirOk(await mover("RUNNING", "PENDING"), "retentativa");
    const segunda = exigirOk(await mover("PENDING", "RUNNING"), "2ª");
    expect(segunda.attempt).toBe(2);
  });
});

describe("ApprovalGate", () => {
  it("abre o gate: RunStep e Run em WAITING_APPROVAL, evento e dashboard na mesma transação", async () => {
    const id = await criarWorkflow();
    const { runId, taskId } = await criarRunGuiado(id);
    await levarAoGate(runId);

    const gateId = await abrirGate(runId);

    const run = await getRun(handle.db, { userId: USER, runId });
    expect(run?.status).toBe("WAITING_APPROVAL");
    // A Task fica em RUNNING: o gate é do Run, não do trabalho.
    expect((await getTaskDetail(handle.db, { userId: USER, taskId }))?.status).toBe("RUNNING");

    const steps = await listRunSteps(handle.db, { userId: USER, runId });
    expect(steps.find((step) => step.key === "approve-plan")?.status).toBe("WAITING_APPROVAL");

    expect(await tiposDeRunEvent(runId)).toEqual(["ApprovalRequested"]);
    const [gate] = await listRunApprovalGates(handle.db, { userId: USER, runId });
    expect(gate?.id).toBe(gateId);
    expect(gate?.status).toBe("PENDING");

    const dashboard = await handle.pool.query<{ type: string; payload: { gateId: string } }>(
      "select type, payload from dashboard_event where user_id = $1 and type = 'approval.requested'",
      [USER],
    );
    expect(dashboard.rows).toHaveLength(1);
    expect(dashboard.rows[0]?.payload.gateId).toBe(gateId);
  });

  it("é idempotente por (run, gateKey): abrir de novo devolve o mesmo gate sem escrever", async () => {
    const id = await criarWorkflow();
    const { runId } = await criarRunGuiado(id);
    await levarAoGate(runId);
    const gateId = await abrirGate(runId);

    const again = exigirOk(
      await createApprovalGate(handle.db, {
        userId: USER,
        runId,
        stepKey: "approve-plan",
        gateKey: "plan",
        title: "Outro título",
      }),
      "a reabertura",
    );
    expect(again.created).toBe(false);
    expect(again.gate.id).toBe(gateId);
    expect(again.gate.title).toBe("Aprovar o plano");
    expect(await tiposDeRunEvent(runId)).toEqual(["ApprovalRequested"]);
  });

  it("recusa abrir com o step fora de RUNNING, sem escrever nada", async () => {
    const id = await criarWorkflow();
    const { runId } = await criarRunGuiado(id);

    const result = await createApprovalGate(handle.db, {
      userId: USER,
      runId,
      stepKey: "approve-plan",
      gateKey: "plan",
      title: "Cedo demais",
    });
    expect(result).toMatchObject({ ok: false, failure: { code: "RUN_STEP_WRITE_REJECTED" } });
    expect(await listRunApprovalGates(handle.db, { userId: USER, runId })).toEqual([]);
    expect((await getRun(handle.db, { userId: USER, runId }))?.status).toBe("QUEUED");
  });

  it("aprovar: CAS, RunStep SUCCEEDED, Run de volta a QUEUED, auditoria uma vez só", async () => {
    const id = await criarWorkflow();
    const { runId, taskId } = await criarRunGuiado(id);
    await levarAoGate(runId);
    const gateId = await abrirGate(runId);

    const resolved = exigirOk(
      await resolveApprovalGate(handle.db, {
        userId: USER,
        gateId,
        decision: "approve",
        note: "Plano bom.",
      }),
      "a aprovação",
    );
    expect(resolved.status).toBe("GRANTED");
    expect(resolved.note).toBe("Plano bom.");
    expect(resolved.resolvedAt).not.toBeNull();

    const run = await getRun(handle.db, { userId: USER, runId });
    expect(run?.status).toBe("QUEUED");
    expect((await getTaskDetail(handle.db, { userId: USER, taskId }))?.status).toBe("RUNNING");

    const step = (await listRunSteps(handle.db, { userId: USER, runId })).find(
      (item) => item.key === "approve-plan",
    );
    expect(step?.status).toBe("SUCCEEDED");
    expect(step?.result).toMatchObject({ kind: "approval", decision: "approve", gateId });
    expect(step?.finishedAt).not.toBeNull();

    // A segunda decisão perde o CAS e devolve o estado atual, sem novo evento.
    const again = await resolveApprovalGate(handle.db, {
      userId: USER,
      gateId,
      decision: "reject",
    });
    expect(again).toMatchObject({
      ok: false,
      failure: { code: "GATE_ALREADY_RESOLVED", gate: { id: gateId, status: "GRANTED" } },
    });

    expect(await tiposDeRunEvent(runId)).toEqual([
      "ApprovalRequested",
      "ApprovalGranted",
      "StepFinished",
    ]);

    const dashboard = await handle.pool.query<{ type: string }>(
      "select type from dashboard_event where user_id = $1 and type like 'approval.%' order by sequence",
      [USER],
    );
    expect(dashboard.rows.map((row) => row.type)).toEqual([
      "approval.requested",
      "approval.resolved",
    ]);

    // O Worker reclama o Run de novo e a Task, já em RUNNING, não se mexe.
    const reclaimed = await claimNextQueuedRun(handle.db, { userId: USER });
    expect(reclaimed?.run.id).toBe(runId);
    expect(reclaimed?.run.status).toBe("PREPARING");
  });

  it("recusar: RunStep FAILED com o erro, gate REJECTED, evento ApprovalRejected", async () => {
    const id = await criarWorkflow();
    const { runId } = await criarRunGuiado(id);
    await levarAoGate(runId);
    const gateId = await abrirGate(runId);

    const resolved = exigirOk(
      await resolveApprovalGate(handle.db, { userId: USER, gateId, decision: "reject" }),
      "a recusa",
    );
    expect(resolved.status).toBe("REJECTED");
    expect(resolved.note).toBeNull();

    const step = (await listRunSteps(handle.db, { userId: USER, runId })).find(
      (item) => item.key === "approve-plan",
    );
    expect(step?.status).toBe("FAILED");
    expect(step?.error?.code).toBe("APPROVAL_REJECTED");
    expect(step?.result).toMatchObject({ kind: "approval", decision: "reject" });

    expect(await tiposDeRunEvent(runId)).toEqual([
      "ApprovalRequested",
      "ApprovalRejected",
      "StepFinished",
    ]);
    expect((await getRun(handle.db, { userId: USER, runId }))?.status).toBe("QUEUED");
  });

  it("recusa decidir um gate cujo Run não está mais esperando", async () => {
    const id = await criarWorkflow();
    const { runId } = await criarRunGuiado(id);
    await levarAoGate(runId);
    const gateId = await abrirGate(runId);

    // Cancelamento confirmado pelo Worker: o Run sai de WAITING_APPROVAL.
    await handle.pool.query("update run set status = 'CANCELLED' where id = $1", [runId]);

    const result = await resolveApprovalGate(handle.db, {
      userId: USER,
      gateId,
      decision: "approve",
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { code: "RUN_NOT_WAITING_APPROVAL", runId, status: "CANCELLED" },
    });
    const [gate] = await listRunApprovalGates(handle.db, { userId: USER, runId });
    expect(gate?.status).toBe("PENDING");
  });

  it("lista os pendentes do usuário com a Task junto, e 404 no gate inexistente", async () => {
    const id = await criarWorkflow();
    const { runId, taskId } = await criarRunGuiado(id);
    await levarAoGate(runId);
    const gateId = await abrirGate(runId);

    const pendentes = await listApprovalGates(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { status: "PENDING" },
    });
    expect(pendentes.total).toBe(1);
    expect(pendentes.items[0]).toMatchObject({ id: gateId, taskId, taskTitle: "Missão guiada" });

    // O Workflow vem junto, pelo caminho Run → versão congelada → Workflow.
    const run = await getRun(handle.db, { userId: USER, runId });
    expect(pendentes.items[0]).toMatchObject({
      workflowId: id,
      workflowVersionId: run?.workflowVersionId,
      workflowName: GUIDED_EXPEDITION_WORKFLOW.name,
      workflowVersion: 1,
    });

    exigirOk(
      await resolveApprovalGate(handle.db, { userId: USER, gateId, decision: "approve" }),
      "ok",
    );

    const depois = await listApprovalGates(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { status: "PENDING" },
    });
    expect(depois.total).toBe(0);

    expect(
      await resolveApprovalGate(handle.db, {
        userId: USER,
        gateId: ID_INEXISTENTE,
        decision: "approve",
      }),
    ).toBeNull();
  });
});

describe("seedWorkflows", () => {
  it("cria a Expedição guiada uma vez e respeita o que já existe", async () => {
    const primeira = await seedWorkflows(handle.db, { userId: USER });
    expect(primeira).toEqual({ workflowsCreated: 1, workflowsTotal: 1 });

    const page = await listWorkflows(handle.db, { userId: USER, page: 1, pageSize: 10 });
    const guiada = page.items.find((item) => item.name === GUIDED_EXPEDITION_WORKFLOW.name);
    expect(guiada?.definition.steps.map((step) => step.key)).toEqual([
      "analyze",
      "plan",
      "approve-plan",
      "execute",
      "validate",
    ]);

    exigirOk(
      await updateWorkflow(handle.db, {
        userId: USER,
        workflowId: guiada!.id,
        definition: definicao({ description: "editada pelo usuário" }),
      }),
      "a edição",
    );

    const segunda = await seedWorkflows(handle.db, { userId: USER });
    expect(segunda).toEqual({ workflowsCreated: 0, workflowsTotal: 1 });
    expect(
      (await getWorkflow(handle.db, { userId: USER, workflowId: guiada!.id }))?.description,
    ).toBe("editada pelo usuário");
  });
});
