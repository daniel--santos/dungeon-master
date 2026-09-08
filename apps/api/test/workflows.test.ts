import {
  ApprovalGateListSchema,
  ApprovalGatePageSchema,
  ApprovalGateSchema,
  ExecutionProfileListSchema,
  HarnessListSchema,
  LoadoutSchema,
  ProblemDetailsSchema,
  type Project,
  ProjectSchema,
  RunEventListSchema,
  RunSchema,
  RunStepListSchema,
  type Task,
  TaskDetailSchema,
  TaskSchema,
  type WorkflowDefinition,
  WorkflowPageSchema,
  WorkflowSchema,
  WorkflowVersionDetailSchema,
  WorkflowVersionPageSchema,
} from "@dungeon-master/contracts";
import {
  claimNextQueuedRun,
  createApprovalGate,
  createDatabase,
  type DatabaseHandle,
  GUIDED_EXPEDITION_WORKFLOW,
  LOCAL_USER_ID,
  transitionRun,
  transitionRunStep,
} from "@dungeon-master/database";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import { criarApp, limparTudo, pedir, tiposDeEvento } from "./support.js";

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
    applicationName: "vitest-workflows",
  });
  app = criarApp(handle);
  workspace = mkdtempSync(join(tmpdir(), "dm-workflow-"));
});

beforeEach(async () => {
  await limparTudo(handle);

  const criado = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Forja de Widgets" },
  });
  project = ProjectSchema.parse(await criado.json());

  await pedir({
    app,
    method: "PATCH",
    path: `${API_BASE_PATH}/projects/${project.id}`,
    body: { workspacePath: workspace },
  });

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
    body: {
      name: "Claude Code em campo aberto",
      agentId,
      harnessId: harness?.id,
      executionProfileId: perfil?.id,
    },
  });

  expect(response.status).toBe(201);
  return LoadoutSchema.parse(await response.json()).id;
}

function definicao(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return { ...GUIDED_EXPEDITION_WORKFLOW, ...overrides };
}

async function criarWorkflow(overrides: Partial<WorkflowDefinition> = {}): Promise<string> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/workflows`,
    body: definicao(overrides),
  });
  expect(response.status).toBe(201);
  return WorkflowSchema.parse(await response.json()).id;
}

async function criarTask(body: Record<string, unknown>): Promise<Task> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks`,
    body: { projectId: project.id, ...body },
  });
  expect(response.status).toBe(201);
  return TaskSchema.parse(await response.json());
}

async function criarRun(taskId: string): Promise<string> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks/${taskId}/runs`,
    body: { loadoutId },
  });
  expect(response.status).toBe(201);
  return RunSchema.parse(await response.json()).id;
}

async function lerSteps(runId: string): Promise<Array<{ key: string; status: string }>> {
  const response = await pedir({
    app,
    method: "GET",
    path: `${API_BASE_PATH}/runs/${runId}/steps`,
  });
  expect(response.status).toBe(200);
  return RunStepListSchema.parse(await response.json()).items.map((step) => ({
    key: step.key,
    status: step.status,
  }));
}

/**
 * Leva o Run até o gate como o motor (Fase 4B) fará: reclama o Run, o põe em
 * RUNNING, conclui os dois steps de agente e abre o gate no step de aprovação.
 * Não existe rota para isso de propósito — abrir um gate é trabalho do motor.
 */
async function abrirGate(runId: string): Promise<string> {
  const claimed = await claimNextQueuedRun(handle.db, { userId: LOCAL_USER_ID });
  expect(claimed?.run.id).toBe(runId);
  const running = await transitionRun(handle.db, { userId: LOCAL_USER_ID, runId, to: "RUNNING" });
  expect(running?.ok).toBe(true);

  for (const stepKey of ["analyze", "plan"]) {
    await transitionRunStep(handle.db, {
      userId: LOCAL_USER_ID,
      runId,
      stepKey,
      from: "PENDING",
      to: "RUNNING",
      incrementAttempt: true,
    });
    await transitionRunStep(handle.db, {
      userId: LOCAL_USER_ID,
      runId,
      stepKey,
      from: "RUNNING",
      to: "SUCCEEDED",
      patch: { result: { kind: "agent", status: "completed" } },
    });
  }
  await transitionRunStep(handle.db, {
    userId: LOCAL_USER_ID,
    runId,
    stepKey: "approve-plan",
    from: "PENDING",
    to: "RUNNING",
    incrementAttempt: true,
  });

  const opened = await createApprovalGate(handle.db, {
    userId: LOCAL_USER_ID,
    runId,
    stepKey: "approve-plan",
    gateKey: "plan",
    title: "Aprovar o plano de implementação",
  });
  if (opened === null || !opened.ok) throw new Error("O gate não abriu.");
  return opened.value.gate.id;
}

async function resolver(gateId: string, body: Record<string, unknown>): Promise<Response> {
  return await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/approval-gates/${gateId}/resolve`,
    body,
  });
}

describe(`${API_BASE_PATH}/workflows`, () => {
  it("cria, lê, lista, edita e apaga", async () => {
    const id = await criarWorkflow();

    const lido = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/workflows/${id}` });
    expect(lido.status).toBe(200);
    const workflow = WorkflowSchema.parse(await lido.json());
    expect(workflow.name).toBe("Expedição guiada");
    expect(workflow.latestVersion).toBeNull();
    expect(workflow.definition.steps.map((step) => step.key)).toEqual([
      "analyze",
      "plan",
      "approve-plan",
      "execute",
      "validate",
    ]);

    const lista = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/workflows` });
    expect(WorkflowPageSchema.parse(await lista.json()).total).toBe(1);

    const editado = await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/workflows/${id}`,
      body: definicao({ name: "Expedição curta", description: "editada" }),
    });
    expect(editado.status).toBe(200);
    expect(WorkflowSchema.parse(await editado.json()).name).toBe("Expedição curta");

    const apagado = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/workflows/${id}`,
    });
    expect(apagado.status).toBe(204);

    const sumiu = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/workflows/${id}` });
    expect(sumiu.status).toBe(404);

    expect(await tiposDeEvento(handle)).toEqual(
      expect.arrayContaining(["workflow.created", "workflow.updated", "workflow.deleted"]),
    );
  });

  it("409 no nome repetido", async () => {
    await criarWorkflow();
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/workflows`,
      body: definicao(),
    });
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    expect(ProblemDetailsSchema.parse(await response.json()).detail).toContain("Expedição guiada");
  });

  it("422 na definição inválida, apontando o step e o campo", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/workflows`,
      body: {
        name: "Torto",
        steps: [
          { type: "agent", key: "analyze", name: "A", prompt: "p", dependsOn: ["execute"] },
          {
            type: "agent",
            key: "execute",
            name: "E",
            prompt: "p",
            dependsOn: ["aprove-plan"],
            when: [{ kind: "stepSucceeded", step: "aprove-plan" }],
          },
        ],
      },
    });

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    const problema = ProblemDetailsSchema.parse(await response.json());
    expect(problema.title).toBe("Conteúdo inválido");
    expect(problema.errors?.map((issue) => issue.path)).toEqual([
      "steps.1.dependsOn.0",
      "steps.1.when.0.step",
    ]);
    expect(problema.errors?.[0]?.message).toContain('"execute"');
    expect(problema.errors?.[0]?.message).toContain('"aprove-plan"');
  });

  it("400 no corpo malformado e no predicado desconhecido", async () => {
    const semSteps = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/workflows`,
      body: { name: "Vazio", steps: [] },
    });
    expect(semSteps.status).toBe(400);

    const predicadoEstranho = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/workflows`,
      body: {
        name: "Expressão",
        steps: [
          { type: "agent", key: "aa", name: "A", prompt: "p" },
          {
            type: "agent",
            key: "bb",
            name: "B",
            prompt: "p",
            dependsOn: ["aa"],
            when: [{ kind: "expression", expr: "aa.ok && true" }],
          },
        ],
      },
    });
    expect(predicadoEstranho.status).toBe(400);
    const problema = ProblemDetailsSchema.parse(await predicadoEstranho.json());
    expect(problema.errors?.some((issue) => issue.path.startsWith("steps.1.when.0"))).toBe(true);
  });

  it("PATCH /tasks/{id} liga e desliga o Workflow, e recusa um inexistente", async () => {
    const id = await criarWorkflow();
    const task = await criarTask({ title: "Missão" });
    expect(task.workflowId).toBeNull();

    const ligada = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${task.id}`,
      body: { workflowId: id },
    });
    expect(ligada.status).toBe(200);
    expect(TaskDetailSchema.parse(await ligada.json()).workflowId).toBe(id);

    const inexistente = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${task.id}`,
      body: { workflowId: ID_INEXISTENTE },
    });
    expect(inexistente.status).toBe(404);

    const desligada = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${task.id}`,
      body: { workflowId: null },
    });
    expect(desligada.status).toBe(200);
    expect(TaskDetailSchema.parse(await desligada.json()).workflowId).toBeNull();
  });
});

describe("captura congelada", () => {
  it("o Run congela a versão e os steps; editar o Workflow depois não muda nada nele", async () => {
    const id = await criarWorkflow();
    const task = await criarTask({ title: "Guiada", workflowId: id });
    const runId = await criarRun(task.id);

    const run = RunSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs/${runId}` })).json(),
    );
    expect(run.workflowVersionId).not.toBeNull();
    const versionId = run.workflowVersionId!;

    expect(await lerSteps(runId)).toEqual([
      { key: "analyze", status: "PENDING" },
      { key: "plan", status: "PENDING" },
      { key: "approve-plan", status: "PENDING" },
      { key: "execute", status: "PENDING" },
      { key: "validate", status: "PENDING" },
    ]);

    const editado = await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/workflows/${id}`,
      body: definicao({
        steps: GUIDED_EXPEDITION_WORKFLOW.steps.filter((step) => step.key !== "validate"),
      }),
    });
    expect(editado.status).toBe(200);

    const depois = RunSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs/${runId}` })).json(),
    );
    expect(depois.workflowVersionId).toBe(versionId);
    expect((await lerSteps(runId)).map((step) => step.key)).toContain("validate");

    const versao = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/workflow-versions/${versionId}`,
    });
    expect(versao.status).toBe(200);
    const detalhe = WorkflowVersionDetailSchema.parse(await versao.json());
    expect(detalhe.version).toBe(1);
    expect(detalhe.steps.map((step) => step.key)).toEqual([
      "analyze",
      "plan",
      "approve-plan",
      "execute",
      "validate",
    ]);

    const versoes = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/workflows/${id}/versions`,
    });
    expect(
      WorkflowVersionPageSchema.parse(await versoes.json()).items.map((v) => v.version),
    ).toEqual([1]);

    const remover = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/workflows/${id}`,
    });
    expect(remover.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await remover.json()).detail).toContain(runId);
  });

  it("404 nas versões de um Workflow inexistente e numa versão inexistente", async () => {
    const versoes = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/workflows/${ID_INEXISTENTE}/versions`,
    });
    expect(versoes.status).toBe(404);

    const versao = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/workflow-versions/${ID_INEXISTENTE}`,
    });
    expect(versao.status).toBe(404);

    const steps = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${ID_INEXISTENTE}/steps`,
    });
    expect(steps.status).toBe(404);
  });
});

describe(`${API_BASE_PATH}/approval-gates`, () => {
  it("lista os pendentes, aprova por CAS, e a segunda decisão recebe 409 com o gate atual", async () => {
    const id = await criarWorkflow();
    const task = await criarTask({ title: "Guiada", workflowId: id });
    const runId = await criarRun(task.id);
    const gateId = await abrirGate(runId);

    const pendentes = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/approval-gates?status=PENDING`,
    });
    expect(pendentes.status).toBe(200);
    const pagina = ApprovalGatePageSchema.parse(await pendentes.json());
    expect(pagina.total).toBe(1);
    expect(pagina.items[0]).toMatchObject({
      id: gateId,
      taskId: task.id,
      taskTitle: "Guiada",
      workflowId: id,
      workflowName: GUIDED_EXPEDITION_WORKFLOW.name,
      workflowVersion: 1,
    });
    expect(pagina.items[0]?.workflowVersionId).toMatch(/^[0-9a-f-]{36}$/);

    const doRun = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs/${runId}/gates` });
    expect(ApprovalGateListSchema.parse(await doRun.json()).items.map((g) => g.status)).toEqual([
      "PENDING",
    ]);

    const aprovado = await resolver(gateId, { decision: "approve", note: "Vai." });
    expect(aprovado.status).toBe(200);
    const gate = ApprovalGateSchema.parse(await aprovado.json());
    expect(gate.status).toBe("GRANTED");
    expect(gate.note).toBe("Vai.");

    const run = RunSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs/${runId}` })).json(),
    );
    expect(run.status).toBe("QUEUED");
    expect((await lerSteps(runId)).find((step) => step.key === "approve-plan")?.status).toBe(
      "SUCCEEDED",
    );

    // A segunda decisão perde o CAS: 409 com o estado atual em `gate`.
    const denovo = await resolver(gateId, { decision: "reject" });
    expect(denovo.status).toBe(409);
    expect(denovo.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    const corpo = (await denovo.json()) as Record<string, unknown>;
    const problema = ProblemDetailsSchema.parse(corpo);
    expect(problema.title).toBe("Gate já decidido");
    expect(ApprovalGateSchema.parse(corpo["gate"])).toMatchObject({
      id: gateId,
      status: "GRANTED",
    });

    // A auditoria existe uma vez só.
    const eventos = RunEventListSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs/${runId}/events` })
      ).json(),
    );
    expect(eventos.items.map((event) => event.type)).toEqual([
      "ApprovalRequested",
      "ApprovalGranted",
      "StepFinished",
    ]);

    // Os eventos de dashboard saíram na mesma transação do gate.
    const dashboard = await tiposDeEvento(handle);
    expect(dashboard.filter((type) => type.startsWith("approval."))).toEqual([
      "approval.requested",
      "approval.resolved",
    ]);

    const vazio = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/approval-gates?status=PENDING`,
    });
    expect(ApprovalGatePageSchema.parse(await vazio.json()).total).toBe(0);
  });

  it("recusa: gate REJECTED, step FAILED, evento ApprovalRejected", async () => {
    const id = await criarWorkflow();
    const task = await criarTask({ title: "Guiada", workflowId: id });
    const runId = await criarRun(task.id);
    const gateId = await abrirGate(runId);

    const recusado = await resolver(gateId, { decision: "reject", note: "Plano incompleto." });
    expect(recusado.status).toBe(200);
    expect(ApprovalGateSchema.parse(await recusado.json()).status).toBe("REJECTED");

    expect((await lerSteps(runId)).find((step) => step.key === "approve-plan")?.status).toBe(
      "FAILED",
    );

    const eventos = RunEventListSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs/${runId}/events` })
      ).json(),
    );
    expect(eventos.items.map((event) => event.type)).toContain("ApprovalRejected");
  });

  it("404 no gate inexistente e 400 na decisão fora do vocabulário", async () => {
    expect((await resolver(ID_INEXISTENTE, { decision: "approve" })).status).toBe(404);

    const id = await criarWorkflow();
    const task = await criarTask({ title: "Guiada", workflowId: id });
    const runId = await criarRun(task.id);
    const gateId = await abrirGate(runId);

    expect((await resolver(gateId, { decision: "maybe" })).status).toBe(400);
  });
});
