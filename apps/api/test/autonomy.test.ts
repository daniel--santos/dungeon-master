import {
  ApprovalPolicyPageSchema,
  ApprovalPolicySchema,
  BudgetPageSchema,
  BudgetSchema,
  BudgetUsageSchema,
  CircuitBreakerPageSchema,
  CircuitBreakerSchema,
  ExecutionProfileListSchema,
  HarnessListSchema,
  LoadoutSchema,
  ModelSchema,
  ProblemDetailsSchema,
  type Project,
  ProjectAutonomySchema,
  ProjectSchema,
  ProposedTaskPageSchema,
  RoutingRulePageSchema,
  RoutingRuleSchema,
  RunCreatedSchema,
  RunEventListSchema,
  type RunResult,
  RunSchema,
  type Task,
  TaskDetailSchema,
  TaskPageSchema,
  TaskSchema,
  TaskSuggestionsSchema,
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
  linhasDeActivity,
  pedir,
  tiposDeEvento,
} from "./support.js";

/**
 * A autonomia controlada (Fase 9A) pela API: os quatro cadastros, o nível de
 * autonomia do Project, as sugestões, e o que `POST /runs` faz com orçamento,
 * disjuntor, política de partida e roteamento — mais a proposta auto-aprovada
 * criando a Task na transação do desfecho.
 *
 * O único estado que não nasce pela aplicação é o disjuntor `OPEN`: quem o
 * abre é o Worker (9B), então aqui ele é fixture SQL, como os desfechos das
 * Fases 4 e 5 na web.
 */

let handle: DatabaseHandle;
let app: App;
let project: Project;
let workspace: string;
let harnessClaudeId: string;
let harnessPiId: string;
let perfilId: string;

const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

beforeAll(async () => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-autonomia-9a",
  });
  app = criarApp(handle);
  workspace = mkdtempSync(join(tmpdir(), "dm-autonomia-"));
});

beforeEach(async () => {
  await limparTudo(handle);

  const criado = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Campanha autônoma" },
  });
  project = ProjectSchema.parse(await criado.json());
  await definirWorkspace(handle, { projectId: project.id, workspacePath: workspace });

  const harnesses = HarnessListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` })).json(),
  );
  harnessClaudeId = harnesses.items.find((item) => item.key === "CLAUDE_CODE")?.id ?? "";
  harnessPiId = harnesses.items.find((item) => item.key === "PI")?.id ?? "";
  const perfis = ExecutionProfileListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/execution-profiles` })).json(),
  );
  perfilId = perfis.items.find((item) => item.enabled)?.id ?? "";
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
  rmSync(workspace, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// Ajudantes
// --------------------------------------------------------------------------

async function post(path: string, body: unknown): Promise<Response> {
  return await pedir({ app, method: "POST", path: `${API_BASE_PATH}${path}`, body });
}

async function get(path: string): Promise<Response> {
  return await pedir({ app, method: "GET", path: `${API_BASE_PATH}${path}` });
}

async function patch(path: string, body: unknown): Promise<Response> {
  return await pedir({ app, method: "PATCH", path: `${API_BASE_PATH}${path}`, body });
}

async function del(path: string): Promise<Response> {
  return await pedir({ app, method: "DELETE", path: `${API_BASE_PATH}${path}` });
}

/**
 * O problem details validado, **com** os membros de extensão: o schema do
 * contrato descarta o que não conhece, e `code`, `budget`, `breaker` e
 * `policyDecision` são exatamente o que estes testes olham.
 */
async function problema(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
  const cru = (await response.json()) as Record<string, unknown>;
  return { ...cru, ...ProblemDetailsSchema.parse(cru) } as ReturnType<
    typeof ProblemDetailsSchema.parse
  > &
    Record<string, unknown>;
}

async function criarAgent(name: string): Promise<string> {
  const response = await post("/agents", { name, role: "ENGINEER", instructions: "Faça." });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function criarLoadout(input: {
  name: string;
  harnessId?: string;
  modelId?: string;
  isDefault?: boolean;
}): Promise<string> {
  const agentId = await criarAgent(`Agente ${input.name}`);
  const response = await post("/loadouts", {
    name: input.name,
    agentId,
    harnessId: input.harnessId ?? harnessClaudeId,
    executionProfileId: perfilId,
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
  });
  expect(response.status).toBe(201);
  return LoadoutSchema.parse(await response.json()).id;
}

async function criarModel(input: { harnessId: string; key: string }): Promise<string> {
  const response = await post("/models", { harnessId: input.harnessId, key: input.key, name: input.key });
  expect(response.status).toBe(201);
  return ModelSchema.parse(await response.json()).id;
}

async function criarTask(body: Record<string, unknown>): Promise<Task> {
  const response = await post("/tasks", { projectId: project.id, ...body });
  expect(response.status).toBe(201);
  return TaskSchema.parse(await response.json());
}

async function criarRun(taskId: string, loadoutId: string): Promise<Response> {
  return await post(`/tasks/${taskId}/runs`, { loadoutId });
}

async function nivel(autonomyLevel: number): Promise<void> {
  const response = await patch(`/projects/${project.id}/autonomy`, { autonomyLevel });
  expect(response.status).toBe(200);
}

/** Um Run da Task, reclamado, levado a `RUNNING` e terminado com o resultado. */
async function terminarRun(taskId: string, loadoutId: string, result: RunResult): Promise<string> {
  const criado = await criarRun(taskId, loadoutId);
  expect(criado.status).toBe(201);
  const run = RunSchema.parse(await criado.json());
  await claimNextQueuedRun(handle.db, { userId: LOCAL_USER_ID });
  const movido = await transitionRun(handle.db, { userId: LOCAL_USER_ID, runId: run.id, to: "RUNNING" });
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

async function abrirDisjuntor(breakerId: string, openedAt: Date): Promise<void> {
  await handle.pool.query(
    "update circuit_breaker set state = 'OPEN', opened_at = $2, reason = 'fixture' where id = $1",
    [breakerId, openedAt],
  );
}

async function contar(tipo: string): Promise<number> {
  return (await tiposDeEvento(handle)).filter((t) => t === tipo).length;
}

// --------------------------------------------------------------------------
// Cadastros
// --------------------------------------------------------------------------

describe("os quatro cadastros da Fase 9A", () => {
  it("política: cria, lista da maior prioridade, lê, edita, apaga, com registry.changed", async () => {
    const criada = await post("/approval-policies", {
      name: "Chores passam",
      subject: "PROPOSAL",
      projectId: project.id,
      priority: 50,
      conditions: { taskKind: "CHORE" },
      action: "AUTO_APPROVE",
    });
    expect(criada.status).toBe(201);
    const politica = ApprovalPolicySchema.parse(await criada.json());
    expect(politica).toMatchObject({
      subject: "PROPOSAL",
      projectId: project.id,
      priority: 50,
      conditions: { taskKind: "CHORE" },
      action: "AUTO_APPROVE",
      enabled: true,
    });

    const global = await post("/approval-policies", {
      name: "Nada de Docker",
      subject: "RUN_START",
      priority: 900,
      conditions: { executionMode: "DOCKER" },
      action: "DENY",
    });
    expect(global.status).toBe(201);
    expect(ApprovalPolicySchema.parse(await global.json()).projectId).toBeNull();

    const lista = ApprovalPolicyPageSchema.parse(
      await (await get(`/approval-policies?projectId=${project.id}`)).json(),
    );
    expect(lista.items.map((item) => item.name)).toEqual(["Nada de Docker", "Chores passam"]);
    expect(
      ApprovalPolicyPageSchema.parse(await (await get("/approval-policies?subject=GATE")).json()).total,
    ).toBe(0);

    const lida = await get(`/approval-policies/${politica.id}`);
    expect(lida.status).toBe(200);

    const editada = await patch(`/approval-policies/${politica.id}`, { projectId: null, enabled: false });
    expect(editada.status).toBe(200);
    expect(ApprovalPolicySchema.parse(await editada.json())).toMatchObject({
      projectId: null,
      enabled: false,
    });

    expect((await patch(`/approval-policies/${politica.id}`, { projectId: ID_INEXISTENTE })).status).toBe(404);
    expect((await del(`/approval-policies/${politica.id}`)).status).toBe(204);
    expect((await get(`/approval-policies/${politica.id}`)).status).toBe(404);
    expect(await contar("registry.changed")).toBe(4);

    // Condição fora do vocabulário fechado é 400: `strictObject`.
    const fora = await post("/approval-policies", {
      name: "x",
      subject: "PROPOSAL",
      action: "DENY",
      conditions: { title: "algo" },
    });
    expect(fora.status).toBe(400);
  });

  it("orçamento: escopo e id precisam bater, pelo menos um teto, PER_RUN só tokens e tempo", async () => {
    const semId = await problema(
      await post("/budgets", { name: "x", scope: "PROJECT", window: "DAY", maxRuns: 1 }),
      409,
    );
    expect(semId.title).toBe("Id de escopo não bate com o escopo");

    const sobrando = await post("/budgets", {
      name: "x",
      scope: "GLOBAL",
      projectId: project.id,
      window: "DAY",
      maxRuns: 1,
    });
    expect(sobrando.status).toBe(409);

    const semTeto = await problema(
      await post("/budgets", { name: "x", scope: "GLOBAL", window: "DAY" }),
      409,
    );
    expect(semTeto.title).toBe("Orçamento sem teto");

    const porRun = await problema(
      await post("/budgets", { name: "x", scope: "GLOBAL", window: "PER_RUN", maxRuns: 1 }),
      409,
    );
    expect(porRun.title).toBe("Teto que a janela não aceita");

    expect(
      (
        await post("/budgets", {
          name: "x",
          scope: "PROJECT",
          projectId: ID_INEXISTENTE,
          window: "DAY",
          maxRuns: 1,
        })
      ).status,
    ).toBe(404);

    const criado = await post("/budgets", {
      name: "Diário da Campanha",
      scope: "PROJECT",
      projectId: project.id,
      window: "DAY",
      maxRuns: 2,
      maxTokens: 10_000,
      action: "WARN",
    });
    expect(criado.status).toBe(201);
    const budget = BudgetSchema.parse(await criado.json());
    expect(budget.limits).toEqual({
      maxTokens: 10_000,
      maxRuns: 2,
      maxWallClockMs: null,
      maxConcurrentRuns: null,
    });

    // `null` desliga um teto; desligar todos é recusado.
    const editado = await patch(`/budgets/${budget.id}`, { maxTokens: null });
    expect(BudgetSchema.parse(await editado.json()).limits.maxTokens).toBeNull();
    expect((await patch(`/budgets/${budget.id}`, { maxRuns: null })).status).toBe(409);

    const lista = BudgetPageSchema.parse(await (await get(`/budgets?projectId=${project.id}`)).json());
    expect(lista.total).toBe(1);

    const usage = BudgetUsageSchema.parse(await (await get(`/budgets/${budget.id}/usage`)).json());
    expect(usage).toMatchObject({ window: "DAY", runs: 0, tokens: 0, tokensKnown: true, pressure: 0 });
    expect(usage.windowStart).not.toBeNull();

    expect((await del(`/budgets/${budget.id}`)).status).toBe(204);
    expect((await get(`/budgets/${budget.id}/usage`)).status).toBe(404);
  });

  it("disjuntor: escopo com id, pelo menos um gatilho, nasce CLOSED", async () => {
    const semGatilho = await problema(
      await post("/circuit-breakers", { name: "x", scope: "HARNESS", harnessKey: "PI" }),
      409,
    );
    expect(semGatilho.title).toBe("Disjuntor sem gatilho");

    expect(
      (
        await post("/circuit-breakers", {
          name: "x",
          scope: "LOADOUT",
          projectId: project.id,
          consecutiveFailures: 1,
        })
      ).status,
    ).toBe(409);

    const criado = await post("/circuit-breakers", {
      name: "Pi instável",
      scope: "HARNESS",
      harnessKey: "PI",
      consecutiveFailures: 3,
      failuresInWindow: { count: 5, windowMs: 3_600_000 },
      cooldownMs: 60_000,
    });
    expect(criado.status).toBe(201);
    const breaker = CircuitBreakerSchema.parse(await criado.json());
    expect(breaker).toMatchObject({
      state: "CLOSED",
      openedAt: null,
      probeRunId: null,
      consecutiveFailures: 0,
      cooldownMs: 60_000,
      triggers: {
        consecutiveFailures: 3,
        failuresInWindow: { count: 5, windowMs: 3_600_000 },
        permissionDeniedInWindow: null,
        authNotAuthenticated: false,
      },
    });

    const editado = await patch(`/circuit-breakers/${breaker.id}`, {
      consecutiveFailures: null,
      failuresInWindow: null,
      authNotAuthenticated: true,
    });
    expect(CircuitBreakerSchema.parse(await editado.json()).triggers.authNotAuthenticated).toBe(true);
    expect(
      (await patch(`/circuit-breakers/${breaker.id}`, { authNotAuthenticated: false })).status,
    ).toBe(409);

    const lista = CircuitBreakerPageSchema.parse(
      await (await get("/circuit-breakers?state=CLOSED")).json(),
    );
    expect(lista.total).toBe(1);

    // Reset num disjuntor fechado é idempotente e não grava evento.
    const antes = await contar("breaker.closed");
    expect((await post(`/circuit-breakers/${breaker.id}/reset`, undefined)).status).toBe(200);
    expect(await contar("breaker.closed")).toBe(antes);

    expect((await del(`/circuit-breakers/${breaker.id}`)).status).toBe(204);
    expect((await post(`/circuit-breakers/${breaker.id}/reset`, undefined)).status).toBe(404);
  });

  it("regra de roteamento: alvo e fallbacks existem na tabela da espécie; kind não muda", async () => {
    const modelo = await criarModel({ harnessId: harnessClaudeId, key: "claude-a" });
    const loadoutId = await criarLoadout({ name: "Forja" });

    const alvoErrado = await problema(
      await post("/routing-rules", { name: "x", kind: "MODEL", targetId: loadoutId }),
      404,
    );
    expect(alvoErrado.title).toBe("Alvo do roteamento não encontrado");

    const criada = await post("/routing-rules", {
      name: "Bugs no claude-a",
      kind: "MODEL",
      projectId: project.id,
      conditions: { taskKind: "BUG" },
      targetId: modelo,
      // O alvo repetido no fallback é descartado.
      fallbackIds: [modelo],
    });
    expect(criada.status).toBe(201);
    const regra = RoutingRuleSchema.parse(await criada.json());
    expect(regra).toMatchObject({ kind: "MODEL", targetId: modelo, fallbackIds: [], priority: 100 });

    expect((await patch(`/routing-rules/${regra.id}`, { fallbackIds: [ID_INEXISTENTE] })).status).toBe(404);
    const editada = await patch(`/routing-rules/${regra.id}`, { priority: 5, projectId: null });
    expect(RoutingRuleSchema.parse(await editada.json())).toMatchObject({ priority: 5, projectId: null });

    const lista = RoutingRulePageSchema.parse(await (await get("/routing-rules?kind=MODEL")).json());
    expect(lista.total).toBe(1);
    expect((await del(`/routing-rules/${regra.id}`)).status).toBe(204);
  });
});

// --------------------------------------------------------------------------
// Nível de autonomia
// --------------------------------------------------------------------------

describe(`GET/PATCH ${API_BASE_PATH}/projects/{id}/autonomy`, () => {
  it("nasce em 2, sobe para 3 com evento e diário, e é idempotente", async () => {
    const lido = ProjectAutonomySchema.parse(await (await get(`/projects/${project.id}/autonomy`)).json());
    expect(lido).toMatchObject({
      projectId: project.id,
      autonomyLevel: 2,
      allows: {
        SUGGEST: true,
        AUTO_APPROVE_PROPOSAL: false,
        AUTO_APPROVE_GATE: false,
        AUTO_DISPATCH: false,
        DELEGATE: false,
      },
    });
    expect(ProjectSchema.parse(await (await get(`/projects/${project.id}`)).json()).autonomyLevel).toBe(2);

    const subiu = await patch(`/projects/${project.id}/autonomy`, { autonomyLevel: 3 });
    expect(subiu.status).toBe(200);
    expect(ProjectAutonomySchema.parse(await subiu.json()).allows.AUTO_APPROVE_PROPOSAL).toBe(true);
    expect(await contar("autonomy.changed")).toBe(1);
    expect(
      (await linhasDeActivity(handle)).filter(
        (row) => row.type === "project.updated" && (row.payload?.["from"] as number) === 2,
      ),
    ).toHaveLength(1);

    // O mesmo nível de novo não é um segundo fato.
    await patch(`/projects/${project.id}/autonomy`, { autonomyLevel: 3 });
    expect(await contar("autonomy.changed")).toBe(1);

    expect((await patch(`/projects/${project.id}/autonomy`, { autonomyLevel: 5 })).status).toBe(400);
    expect((await get(`/projects/${ID_INEXISTENTE}/autonomy`)).status).toBe(404);
  });
});

// --------------------------------------------------------------------------
// POST /runs: orçamento
// --------------------------------------------------------------------------

describe(`orçamentos em POST ${API_BASE_PATH}/tasks/{id}/runs`, () => {
  it("PROJECT/DAY maxRuns=2 BLOCK: o terceiro Run é 409 BUDGET_EXCEEDED, com consumo e teto", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const criado = await post("/budgets", {
      name: "Dois por dia",
      scope: "PROJECT",
      projectId: project.id,
      window: "DAY",
      maxRuns: 2,
    });
    const budget = BudgetSchema.parse(await criado.json());

    const [a, b, c] = await Promise.all([
      criarTask({ title: "A" }),
      criarTask({ title: "B" }),
      criarTask({ title: "C" }),
    ]);
    if (a === undefined || b === undefined || c === undefined) throw new Error("sem tasks");

    const primeiro = RunCreatedSchema.parse(await (await criarRun(a.id, loadoutId)).json());
    expect(primeiro).toMatchObject({ createdBy: "USER", parentRunId: null, budgetWarnings: [] });
    expect((await criarRun(b.id, loadoutId)).status).toBe(201);

    const terceiro = await problema(await criarRun(c.id, loadoutId), 409);
    expect(terceiro.title).toBe("Orçamento no teto");
    expect(terceiro["code"]).toBe("BUDGET_EXCEEDED");
    expect(terceiro["budget"]).toMatchObject({
      budgetId: budget.id,
      action: "BLOCK",
      limit: "maxRuns",
      limitValue: 2,
      current: 3,
      decidedBy: `BUDGET:${budget.id}`,
      usage: { runs: 2, pressure: 1, exceeded: ["maxRuns"] },
    });
    expect(await contar("budget.exceeded")).toBe(1);

    // A Task recusada continua READY: nada foi escrito além do evento.
    expect(TaskDetailSchema.parse(await (await get(`/tasks/${c.id}`)).json()).status).toBe("READY");

    const usage = BudgetUsageSchema.parse(await (await get(`/budgets/${budget.id}/usage`)).json());
    expect(usage).toMatchObject({ runs: 2, concurrentRuns: 2, pressure: 1, exceeded: ["maxRuns"] });
  });

  it("WARN deixa passar com o aviso em budgetWarnings e o evento budget.warned", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    await post("/budgets", {
      name: "Um por dia, mas só avisa",
      scope: "GLOBAL",
      window: "DAY",
      maxRuns: 1,
      action: "WARN",
    });
    const a = await criarTask({ title: "A" });
    const b = await criarTask({ title: "B" });
    expect(RunCreatedSchema.parse(await (await criarRun(a.id, loadoutId)).json()).budgetWarnings).toEqual([]);

    const segundo = RunCreatedSchema.parse(await (await criarRun(b.id, loadoutId)).json());
    expect(segundo.budgetWarnings).toHaveLength(1);
    expect(segundo.budgetWarnings[0]).toMatchObject({ action: "WARN", limit: "maxRuns", current: 2 });
    expect(await contar("budget.warned")).toBe(1);

    // O aviso foi ao diário do Run.
    const eventos = RunEventListSchema.parse(await (await get(`/runs/${segundo.id}/events`)).json());
    expect(
      eventos.items.map((event) => (event.payload as { code?: string }).code).filter(Boolean),
    ).toContain("BUDGET_WARNED");
  });

  it("fail-closed: teto de tokens com um Run que rodou sem reportar consumo não libera", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const a = await criarTask({ title: "Sem medida" });
    await terminarRun(a.id, loadoutId, { status: "completed" });

    const criado = await post("/budgets", {
      name: "Tokens do mês",
      scope: "PROJECT",
      projectId: project.id,
      window: "MONTH",
      maxTokens: 1_000_000,
    });
    const budget = BudgetSchema.parse(await criado.json());

    const usage = BudgetUsageSchema.parse(await (await get(`/budgets/${budget.id}/usage`)).json());
    expect(usage).toMatchObject({ tokens: 0, tokensKnown: false, runsWithoutUsage: 1, runs: 1 });
    expect(usage.wallClockMs).toBeGreaterThanOrEqual(0);

    const b = await criarTask({ title: "B" });
    const recusado = await problema(await criarRun(b.id, loadoutId), 409);
    expect(recusado["budget"]).toMatchObject({ limit: null, limitValue: 1_000_000 });
    expect(recusado.detail).toContain("sem reportar consumo");
  });

  it("tokens conhecidos somam input e output, e liberam abaixo do teto", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const a = await criarTask({ title: "Medida" });
    await terminarRun(a.id, loadoutId, {
      status: "completed",
      usage: { inputTokens: 300, outputTokens: 200 },
    });
    const criado = await post("/budgets", {
      name: "Tokens",
      scope: "GLOBAL",
      window: "WEEK",
      maxTokens: 1_000,
    });
    const budget = BudgetSchema.parse(await criado.json());
    const usage = BudgetUsageSchema.parse(await (await get(`/budgets/${budget.id}/usage`)).json());
    expect(usage).toMatchObject({ tokens: 500, tokensKnown: true, pressure: 0.5 });

    const b = await criarTask({ title: "B" });
    expect((await criarRun(b.id, loadoutId)).status).toBe(201);
  });
});

// --------------------------------------------------------------------------
// POST /runs: disjuntor
// --------------------------------------------------------------------------

describe(`disjuntores em POST ${API_BASE_PATH}/tasks/{id}/runs`, () => {
  async function criarDisjuntor(cooldownMs: number): Promise<string> {
    const response = await post("/circuit-breakers", {
      name: "Campanha instável",
      scope: "PROJECT",
      projectId: project.id,
      consecutiveFailures: 3,
      cooldownMs,
    });
    expect(response.status).toBe(201);
    return CircuitBreakerSchema.parse(await response.json()).id;
  }

  it("OPEN recusa com 409 BREAKER_OPEN; o reset fecha com breaker.closed e libera", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const breakerId = await criarDisjuntor(60_000);
    await abrirDisjuntor(breakerId, new Date());

    const a = await criarTask({ title: "A" });
    const recusado = await problema(await criarRun(a.id, loadoutId), 409);
    expect(recusado.title).toBe("Disjuntor aberto");
    expect(recusado["code"]).toBe("BREAKER_OPEN");
    expect(recusado["breaker"]).toMatchObject({
      breakerId,
      state: "OPEN",
      probe: false,
      decidedBy: `BREAKER:${breakerId}`,
    });
    expect((recusado["breaker"] as { reason: string }).reason).toContain("cooldown");

    const reset = await post(`/circuit-breakers/${breakerId}/reset`, undefined);
    expect(reset.status).toBe(200);
    expect(CircuitBreakerSchema.parse(await reset.json())).toMatchObject({
      state: "CLOSED",
      openedAt: null,
      reason: null,
    });
    expect(await contar("breaker.closed")).toBe(1);

    const liberado = RunCreatedSchema.parse(await (await criarRun(a.id, loadoutId)).json());
    expect(liberado.breaker).toBeNull();
  });

  it("OPEN com o cooldown vencido vira HALF_OPEN e deixa passar uma sondagem por vez", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const breakerId = await criarDisjuntor(60_000);
    await abrirDisjuntor(breakerId, new Date(Date.now() - 120_000));

    const a = await criarTask({ title: "A" });
    const sondagem = RunCreatedSchema.parse(await (await criarRun(a.id, loadoutId)).json());
    expect(sondagem.breaker).toMatchObject({ breakerId, state: "HALF_OPEN", probe: true });

    const lido = CircuitBreakerSchema.parse(await (await get(`/circuit-breakers/${breakerId}`)).json());
    expect(lido).toMatchObject({ state: "HALF_OPEN", probeRunId: sondagem.id });
    expect(await contar("breaker.half_open")).toBe(1);

    const eventos = RunEventListSchema.parse(await (await get(`/runs/${sondagem.id}/events`)).json());
    expect(
      eventos.items.map((event) => (event.payload as { code?: string }).code).filter(Boolean),
    ).toContain("BREAKER_PROBE");

    // A segunda sondagem espera a primeira.
    const b = await criarTask({ title: "B" });
    const esperando = await problema(await criarRun(b.id, loadoutId), 409);
    expect(esperando["breaker"]).toMatchObject({ state: "HALF_OPEN", probe: false });
    expect((esperando["breaker"] as { reason: string }).reason).toContain(sondagem.id);
  });

  it("um disjuntor desligado, ou de outro escopo, não entra na decisão", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const breakerId = await criarDisjuntor(60_000);
    await abrirDisjuntor(breakerId, new Date());
    await patch(`/circuit-breakers/${breakerId}`, { enabled: false });

    const doPi = await post("/circuit-breakers", {
      name: "Pi",
      scope: "HARNESS",
      harnessKey: "PI",
      consecutiveFailures: 1,
    });
    await abrirDisjuntor(CircuitBreakerSchema.parse(await doPi.json()).id, new Date());

    const a = await criarTask({ title: "A" });
    expect((await criarRun(a.id, loadoutId)).status).toBe(201);
  });
});

// --------------------------------------------------------------------------
// POST /runs: política de partida
// --------------------------------------------------------------------------

describe(`políticas RUN_START em POST ${API_BASE_PATH}/tasks/{id}/runs`, () => {
  it("sem política é DEFAULT; AUTO_APPROVE só vale no nível 3; DENY é 409 POLICY_DENIED", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const a = await criarTask({ title: "A", kind: "BUG" });
    const padrao = RunCreatedSchema.parse(await (await criarRun(a.id, loadoutId)).json());
    expect(padrao.policyDecision).toMatchObject({
      subject: "RUN_START",
      action: "REQUIRE_APPROVAL",
      decidedBy: "DEFAULT",
      autonomyLevel: 2,
    });
    expect(await contar("policy.decided")).toBe(0);

    const criada = await post("/approval-policies", {
      name: "Bugs partem sozinhos",
      subject: "RUN_START",
      projectId: project.id,
      conditions: { taskKind: "BUG", executionMode: "HOST" },
      action: "AUTO_APPROVE",
    });
    const politica = ApprovalPolicySchema.parse(await criada.json());

    const b = await criarTask({ title: "B", kind: "BUG" });
    const rebaixado = RunCreatedSchema.parse(await (await criarRun(b.id, loadoutId)).json());
    expect(rebaixado.policyDecision).toMatchObject({
      action: "REQUIRE_APPROVAL",
      policyId: politica.id,
      policyAction: "AUTO_APPROVE",
      decidedBy: "AUTONOMY:2",
    });
    expect(await contar("policy.decided")).toBe(1);

    await nivel(3);
    const c = await criarTask({ title: "C", kind: "BUG" });
    const aprovado = RunCreatedSchema.parse(await (await criarRun(c.id, loadoutId)).json());
    expect(aprovado.policyDecision).toMatchObject({
      action: "AUTO_APPROVE",
      decidedBy: `POLICY:${politica.id}`,
      autonomyLevel: 3,
    });
    const eventos = RunEventListSchema.parse(await (await get(`/runs/${aprovado.id}/events`)).json());
    expect(
      eventos.items.map((event) => (event.payload as { code?: string }).code).filter(Boolean),
    ).toContain("POLICY_DECIDED");

    // Uma feature não casa: continua DEFAULT.
    const d = await criarTask({ title: "D", kind: "FEATURE" });
    expect(
      RunCreatedSchema.parse(await (await criarRun(d.id, loadoutId)).json()).policyDecision.decidedBy,
    ).toBe("DEFAULT");

    const nega = await post("/approval-policies", {
      name: "Urgentes só com humano",
      subject: "RUN_START",
      priority: 500,
      conditions: { taskPriority: "URGENT" },
      action: "DENY",
    });
    const negacao = ApprovalPolicySchema.parse(await nega.json());
    const e = await criarTask({ title: "E", kind: "BUG", priority: "URGENT" });
    const recusado = await problema(await criarRun(e.id, loadoutId), 409);
    expect(recusado["code"]).toBe("POLICY_DENIED");
    expect(recusado["policyDecision"]).toMatchObject({ action: "DENY", decidedBy: `POLICY:${negacao.id}` });
    expect(TaskDetailSchema.parse(await (await get(`/tasks/${e.id}`)).json()).status).toBe("READY");
  });

  it("empate entre políticas de mesma prioridade é revisão humana", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    await nivel(3);
    await post("/approval-policies", { name: "x", subject: "RUN_START", priority: 7, action: "DENY" });
    await post("/approval-policies", {
      name: "y",
      subject: "RUN_START",
      priority: 7,
      action: "AUTO_APPROVE",
    });
    const a = await criarTask({ title: "A" });
    const run = RunCreatedSchema.parse(await (await criarRun(a.id, loadoutId)).json());
    expect(run.policyDecision.action).toBe("REQUIRE_APPROVAL");
    expect(run.policyDecision.decidedBy.startsWith("TIE:")).toBe(true);
  });
});

// --------------------------------------------------------------------------
// POST /runs: roteamento do Model
// --------------------------------------------------------------------------

describe(`roteamento de Model em POST ${API_BASE_PATH}/tasks/{id}/runs`, () => {
  it("o alvo de outro Harness cai no fallback; o snapshot registra quem escolheu", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const doPi = await criarModel({ harnessId: harnessPiId, key: "pi-grande" });
    const doClaude = await criarModel({ harnessId: harnessClaudeId, key: "claude-a" });
    const criada = await post("/routing-rules", {
      name: "Bugs",
      kind: "MODEL",
      conditions: { taskKind: "BUG" },
      targetId: doPi,
      fallbackIds: [doClaude],
    });
    const regra = RoutingRuleSchema.parse(await criada.json());

    const a = await criarTask({ title: "A", kind: "BUG" });
    const run = RunCreatedSchema.parse(await (await criarRun(a.id, loadoutId)).json());
    expect(run.modelRouting).toMatchObject({
      kind: "MODEL",
      selectedId: doClaude,
      selectedName: "claude-a",
      ruleId: regra.id,
      decidedBy: `ROUTING:${regra.id}`,
    });
    expect(run.modelRouting?.attempts.map((attempt) => attempt.accepted)).toEqual([false, true]);
    expect(run.modelKey).toBe("claude-a");
    expect(run.loadoutSnapshot.model?.key).toBe("claude-a");
    expect(run.loadoutSnapshot.modelSelectedBy).toBe(`ROUTING:${regra.id}`);

    // Sem regra que case e sem Model padrão no Harness: nenhum, e diz por quê.
    const b = await criarTask({ title: "B", kind: "CHORE" });
    const semRegra = RunCreatedSchema.parse(await (await criarRun(b.id, loadoutId)).json());
    expect(semRegra.modelRouting).toMatchObject({ selectedId: null, decidedBy: "DEFAULT" });
    expect(semRegra.loadoutSnapshot.modelSelectedBy).toBe("NONE");
  });

  it("um Loadout que pina o Model não é roteado", async () => {
    const doClaude = await criarModel({ harnessId: harnessClaudeId, key: "claude-a" });
    const outro = await criarModel({ harnessId: harnessClaudeId, key: "claude-b" });
    await post("/routing-rules", { name: "Tudo no b", kind: "MODEL", targetId: outro });
    const loadoutId = await criarLoadout({ name: "Pinado", modelId: doClaude });
    const a = await criarTask({ title: "A" });
    const run = RunCreatedSchema.parse(await (await criarRun(a.id, loadoutId)).json());
    expect(run.modelRouting).toBeNull();
    expect(run.modelKey).toBe("claude-a");
    expect(run.loadoutSnapshot.modelSelectedBy).toBe("LOADOUT");
  });

  it("a pressão de orçamento (≥ 0,8) troca para o Model barato", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const caro = await criarModel({ harnessId: harnessClaudeId, key: "claude-caro" });
    const barato = await criarModel({ harnessId: harnessClaudeId, key: "claude-barato" });
    await post("/routing-rules", { name: "Caro", kind: "MODEL", priority: 10, targetId: caro });
    await post("/routing-rules", {
      name: "Barato quando aperta",
      kind: "MODEL",
      priority: 500,
      conditions: { minBudgetPressure: 0.8 },
      targetId: barato,
    });
    await post("/budgets", {
      name: "Cinco por dia",
      scope: "PROJECT",
      projectId: project.id,
      window: "DAY",
      maxRuns: 5,
      action: "WARN",
    });

    const chaves: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const task = await criarTask({ title: `T${String(i)}` });
      const run = RunCreatedSchema.parse(await (await criarRun(task.id, loadoutId)).json());
      chaves.push(run.modelKey ?? "");
    }
    // Quatro Runs criados = pressão 0,8 na hora do quinto.
    expect(chaves).toEqual(["claude-caro", "claude-caro", "claude-caro", "claude-caro", "claude-barato"]);
  });
});

// --------------------------------------------------------------------------
// Sugestões
// --------------------------------------------------------------------------

describe(`POST ${API_BASE_PATH}/tasks/{id}/suggestions`, () => {
  it("nível 0 recusa; nível 1 sugere com o motivo de cada escolha", async () => {
    const padrao = await criarLoadout({ name: "Padrão", isDefault: true });
    const especial = await criarLoadout({ name: "Especial" });
    const modelo = await criarModel({ harnessId: harnessClaudeId, key: "claude-a" });
    await post("/routing-rules", {
      name: "Bugs no especial",
      kind: "LOADOUT",
      conditions: { taskKind: "BUG" },
      targetId: especial,
    });
    const regraModel = RoutingRuleSchema.parse(
      await (
        await post("/routing-rules", { name: "Model", kind: "MODEL", targetId: modelo })
      ).json(),
    );
    const bug = await criarTask({ title: "Bug", kind: "BUG" });
    const feature = await criarTask({ title: "Feature" });

    await nivel(0);
    const recusado = await problema(await post(`/tasks/${bug.id}/suggestions`, undefined), 409);
    expect(recusado["code"]).toBe("AUTOMATION_NOT_ALLOWED");

    await nivel(1);
    const doBug = TaskSuggestionsSchema.parse(await (await post(`/tasks/${bug.id}/suggestions`, undefined)).json());
    expect(doBug.loadout).toMatchObject({ selectedId: especial, selectedName: "Especial" });
    expect(doBug.loadout.decidedBy.startsWith("ROUTING:")).toBe(true);
    expect(doBug.workflow).toMatchObject({ selectedId: null, decidedBy: "DEFAULT" });
    expect(doBug.model).toMatchObject({
      selectedId: modelo,
      selectedName: "claude-a",
      decidedBy: `ROUTING:${regraModel.id}`,
    });
    expect(doBug.autonomyLevel).toBe(1);

    const daFeature = TaskSuggestionsSchema.parse(
      await (await post(`/tasks/${feature.id}/suggestions`, undefined)).json(),
    );
    expect(daFeature.loadout).toMatchObject({ selectedId: padrao, decidedBy: "DEFAULT" });
    expect(daFeature.loadout.reason).toContain("padrão");

    expect((await post(`/tasks/${ID_INEXISTENTE}/suggestions`, undefined)).status).toBe(404);
  });
});

// --------------------------------------------------------------------------
// Propostas decididas por política no desfecho
// --------------------------------------------------------------------------

describe("propostas decididas por política na transação do desfecho", () => {
  const RESULTADO: RunResult = {
    status: "completed",
    discoveredTasks: [{ title: "Arrumar o lint" }, { title: "Atualizar o README" }],
  };

  it("nível 3 + AUTO_APPROVE para CHORE cria as Tasks com createdBy POLICY", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    const politica = ApprovalPolicySchema.parse(
      await (
        await post("/approval-policies", {
          name: "Chores passam",
          subject: "PROPOSAL",
          projectId: project.id,
          conditions: { taskKind: "CHORE" },
          action: "AUTO_APPROVE",
        })
      ).json(),
    );
    await nivel(3);
    const origem = await criarTask({ title: "Faxina", kind: "CHORE" });
    const runId = await terminarRun(origem.id, loadoutId, RESULTADO);

    const propostas = ProposedTaskPageSchema.parse(
      await (await get(`/proposed-tasks?taskId=${origem.id}`)).json(),
    );
    expect(propostas.total).toBe(2);
    for (const proposta of propostas.items) {
      expect(proposta.status).toBe("APPROVED");
      expect(proposta.createdTaskId).not.toBeNull();
      expect(proposta.note).toContain(politica.id);
      expect(proposta.originRunId).toBe(runId);
    }

    const criadas = TaskPageSchema.parse(
      await (await get(`/tasks?projectId=${project.id}&createdBy=POLICY`)).json(),
    );
    expect(criadas.total).toBe(2);
    for (const task of criadas.items) {
      expect(task).toMatchObject({ parentTaskId: origem.id, status: "READY", createdBy: "POLICY" });
    }
    expect(TaskDetailSchema.parse(await (await get(`/tasks/${origem.id}`)).json())).toMatchObject({
      openProposalCount: 0,
      createdBy: "USER",
    });

    const tipos = await tiposDeEvento(handle);
    expect(tipos.filter((t) => t === "task.auto_created")).toHaveLength(2);
    expect(tipos.filter((t) => t === "task.proposal.resolved")).toHaveLength(2);
    expect(tipos.filter((t) => t === "task.proposed")).toHaveLength(1);
    expect(tipos.filter((t) => t === "policy.decided")).toHaveLength(1);
    expect(
      (await linhasDeActivity(handle)).filter(
        (row) => row.type === "task.created" && row.payload?.["createdBy"] === "POLICY",
      ),
    ).toHaveLength(2);
  });

  it("nível 2 rebaixa o AUTO_APPROVE: as propostas ficam PROPOSED, e a decisão fica auditada", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    await post("/approval-policies", {
      name: "Chores passam",
      subject: "PROPOSAL",
      conditions: { taskKind: "CHORE" },
      action: "AUTO_APPROVE",
    });
    const origem = await criarTask({ title: "Faxina", kind: "CHORE" });
    await terminarRun(origem.id, loadoutId, RESULTADO);

    const propostas = ProposedTaskPageSchema.parse(await (await get("/proposed-tasks?status=PROPOSED")).json());
    expect(propostas.total).toBe(2);
    expect(TaskPageSchema.parse(await (await get("/tasks?createdBy=POLICY")).json()).total).toBe(0);
    expect(await contar("policy.decided")).toBe(1);
    expect(await contar("task.auto_created")).toBe(0);
  });

  it("DENY recusa as propostas com o motivo; uma proposta aprovada à mão nasce PROPOSAL", async () => {
    const loadoutId = await criarLoadout({ name: "Forja" });
    await post("/approval-policies", {
      name: "Sem propostas de pesquisa",
      subject: "PROPOSAL",
      conditions: { taskKind: "RESEARCH" },
      action: "DENY",
    });
    const pesquisa = await criarTask({ title: "Investigar", kind: "RESEARCH" });
    await terminarRun(pesquisa.id, loadoutId, RESULTADO);
    const recusadas = ProposedTaskPageSchema.parse(
      await (await get(`/proposed-tasks?taskId=${pesquisa.id}`)).json(),
    );
    expect(recusadas.items.map((item) => item.status)).toEqual(["REJECTED", "REJECTED"]);
    expect(recusadas.items[0]?.note).toContain("recusa");

    // Um bug não casa com a política: revisão humana, e a aprovação à mão marca PROPOSAL.
    const bug = await criarTask({ title: "Bug", kind: "BUG" });
    await terminarRun(bug.id, loadoutId, RESULTADO);
    const abertas = ProposedTaskPageSchema.parse(
      await (await get(`/proposed-tasks?taskId=${bug.id}&status=PROPOSED`)).json(),
    );
    expect(abertas.total).toBe(2);
    const aprovada = await post(`/proposed-tasks/${abertas.items[0]?.id ?? ""}/approve`, {});
    expect(aprovada.status).toBe(200);
    const criadaId = ((await aprovada.json()) as { createdTaskId: string }).createdTaskId;
    expect(TaskDetailSchema.parse(await (await get(`/tasks/${criadaId}`)).json()).createdBy).toBe("PROPOSAL");
  });
});
