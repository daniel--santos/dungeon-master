import type {
  Budget,
  BudgetAction,
  BudgetBreach,
  BudgetLimitKey,
  BudgetLimits,
  BudgetScope,
  BudgetUsage,
  BudgetWindow,
} from "@dungeon-master/contracts";
import {
  allowedLimitKeys,
  type BudgetConsumption,
  budgetPressure,
  budgetWindowBounds,
  checkBudgetForNewRun,
  evaluateBudget,
  isTerminalRunStatus,
  runTokenUsage,
} from "@dungeon-master/domain";
import { and, asc, count, desc, eq, gte, inArray, lt, or, type SQL } from "drizzle-orm";

import type { AutonomyWriteFailure } from "./autonomy-failure.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { findLoadoutRow } from "./loadout.js";
import { findProjectRow } from "./project.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { type BudgetRow, budgets } from "./schema/autonomy.js";
import { runs } from "./schema/run.js";
import { tasks } from "./schema/task.js";

/**
 * Budget: o teto de consumo por escopo e janela (planejamento v0.4, Fase 9A).
 *
 * O consumo é medido pelo que já existe — `run.result.usage`, `created_at`,
 * `started_at`/`finished_at` e o status — por `computeBudgetUsage`, que é a
 * função que `POST /runs`, `GET /budgets/{id}/usage` e a reclamação do Worker
 * (9B) compartilham. Uma medida só, para os três concordarem.
 */

const LIVE_RUN_STATUSES = ["QUEUED", "PREPARING", "RUNNING", "WAITING_APPROVAL"] as const;

export function toBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    projectId: row.projectId,
    loadoutId: row.loadoutId,
    window: row.window,
    limits: {
      maxTokens: row.maxTokens,
      maxRuns: row.maxRuns,
      maxWallClockMs: row.maxWallClockMs,
      maxConcurrentRuns: row.maxConcurrentRuns,
    },
    action: row.action,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findBudgetRow(
  db: DatabaseExecutor,
  input: { userId: string; budgetId: string },
): Promise<BudgetRow | null> {
  const [row] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, input.budgetId), eq(budgets.userId, input.userId)));
  return row ?? null;
}

export interface BudgetFilters {
  scope?: BudgetScope | undefined;
  projectId?: string | undefined;
  loadoutId?: string | undefined;
}

export interface ListBudgetsInput extends PageInput {
  userId: string;
  filters?: BudgetFilters;
}

export async function listBudgets(
  db: DatabaseExecutor,
  input: ListBudgetsInput,
): Promise<PageResult<Budget>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(budgets.userId, input.userId)];
  if (filters.scope !== undefined) conditions.push(eq(budgets.scope, filters.scope));
  if (filters.projectId !== undefined) {
    const c = or(eq(budgets.scope, "GLOBAL"), eq(budgets.projectId, filters.projectId));
    if (c !== undefined) conditions.push(c);
  }
  if (filters.loadoutId !== undefined) {
    const c = or(eq(budgets.scope, "GLOBAL"), eq(budgets.loadoutId, filters.loadoutId));
    if (c !== undefined) conditions.push(c);
  }
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(budgets)
    .where(where)
    .orderBy(asc(budgets.name), asc(budgets.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(budgets).where(where);

  return { items: rows.map(toBudget), total: counted?.total ?? 0 };
}

/** Os orçamentos ligados que alcançam um Run: os globais, os do Project e os do Loadout. */
export async function listApplicableBudgets(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string | null; loadoutId: string | null },
): Promise<BudgetRow[]> {
  const escopos: SQL[] = [eq(budgets.scope, "GLOBAL")];
  if (input.projectId !== null) escopos.push(eq(budgets.projectId, input.projectId));
  if (input.loadoutId !== null) escopos.push(eq(budgets.loadoutId, input.loadoutId));

  return await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.userId, input.userId), eq(budgets.enabled, true), or(...escopos)))
    .orderBy(asc(budgets.name), asc(budgets.id));
}

// --------------------------------------------------------------------------
// Consumo
// --------------------------------------------------------------------------

function condicaoDeEscopo(budget: Pick<BudgetRow, "scope" | "projectId" | "loadoutId">): SQL[] {
  switch (budget.scope) {
    case "GLOBAL":
      return [];
    case "PROJECT":
      return budget.projectId === null ? [] : [eq(tasks.projectId, budget.projectId)];
    case "LOADOUT":
      return budget.loadoutId === null ? [] : [eq(runs.loadoutId, budget.loadoutId)];
  }
}

interface RunUsageRow {
  readonly id: string;
  readonly status: (typeof runs.$inferSelect)["status"];
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly result: (typeof runs.$inferSelect)["result"];
}

const usageColumns = {
  id: runs.id,
  status: runs.status,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
  result: runs.result,
} as const;

/**
 * Soma o consumo de um conjunto de Runs.
 *
 * Tokens vêm de `run.result.usage`; um Run que **começou** e terminou sem
 * número é consumo desconhecido e derruba `tokensKnown` — um Run que nunca
 * saiu da fila consumiu zero com certeza. A duração conta os vivos até agora:
 * o teto de tempo é sobre o que já correu, não sobre o que já acabou.
 */
function somarConsumo(rows: readonly RunUsageRow[], now: Date): Omit<BudgetConsumption, "concurrentRuns"> {
  let tokens = 0;
  let runsWithoutUsage = 0;
  let wallClockMs = 0;

  for (const row of rows) {
    const usage = runTokenUsage(row.result?.usage);
    if (usage !== null) tokens += usage;
    else if (row.startedAt !== null && isTerminalRunStatus(row.status)) runsWithoutUsage += 1;

    if (row.startedAt !== null) {
      const fim = row.finishedAt ?? now;
      wallClockMs += Math.max(0, fim.getTime() - row.startedAt.getTime());
    }
  }

  return {
    tokens,
    tokensKnown: runsWithoutUsage === 0,
    runsWithoutUsage,
    runs: rows.length,
    wallClockMs,
  };
}

export interface ComputeBudgetUsageInput {
  userId: string;
  budget: BudgetRow;
  now?: Date;
  /** Em `PER_RUN`, o Run a medir. Ausente mede o último terminal do escopo. */
  runId?: string | undefined;
}

/**
 * O consumo de um orçamento na janela atual. **Reutilizável**: é a mesma
 * função em `POST /runs`, em `GET /budgets/{id}/usage` e na reclamação (9B).
 */
export async function computeBudgetUsage(
  db: DatabaseExecutor,
  input: ComputeBudgetUsageInput,
): Promise<BudgetUsage> {
  const now = input.now ?? new Date();
  const { budget } = input;
  const escopo = condicaoDeEscopo(budget);
  const limits: BudgetLimits = {
    maxTokens: budget.maxTokens,
    maxRuns: budget.maxRuns,
    maxWallClockMs: budget.maxWallClockMs,
    maxConcurrentRuns: budget.maxConcurrentRuns,
  };

  const [vivos] = await db
    .select({ total: count() })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(and(eq(runs.userId, input.userId), inArray(runs.status, [...LIVE_RUN_STATUSES]), ...escopo));
  const concurrentRuns = vivos?.total ?? 0;

  if (budget.window === "PER_RUN") {
    const rows =
      input.runId === undefined
        ? await db
            .select(usageColumns)
            .from(runs)
            .innerJoin(tasks, eq(tasks.id, runs.taskId))
            .where(
              and(
                eq(runs.userId, input.userId),
                inArray(runs.status, ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]),
                ...escopo,
              ),
            )
            .orderBy(desc(runs.createdAt), desc(runs.id))
            .limit(1)
        : await db
            .select(usageColumns)
            .from(runs)
            .innerJoin(tasks, eq(tasks.id, runs.taskId))
            .where(and(eq(runs.userId, input.userId), eq(runs.id, input.runId), ...escopo));

    const soma = somarConsumo(rows, now);
    const consumption: BudgetConsumption = { ...soma, concurrentRuns };
    const evaluation = evaluateBudget(limits, consumption);
    return {
      budgetId: budget.id,
      window: budget.window,
      windowStart: null,
      windowEnd: null,
      runId: rows[0]?.id ?? null,
      ...soma,
      concurrentRuns,
      limits,
      pressure: evaluation.pressure,
      exceeded: [...evaluation.exceeded],
      computedAt: now.toISOString(),
    };
  }

  const bounds = budgetWindowBounds(budget.window, now);
  const rows = await db
    .select(usageColumns)
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(
      and(
        eq(runs.userId, input.userId),
        gte(runs.createdAt, bounds.start),
        lt(runs.createdAt, bounds.end),
        ...escopo,
      ),
    );

  const soma = somarConsumo(rows, now);
  const consumption: BudgetConsumption = { ...soma, concurrentRuns };
  const evaluation = evaluateBudget(limits, consumption);

  return {
    budgetId: budget.id,
    window: budget.window,
    windowStart: bounds.start.toISOString(),
    windowEnd: bounds.end.toISOString(),
    runId: null,
    ...soma,
    concurrentRuns,
    limits,
    pressure: evaluation.pressure,
    exceeded: [...evaluation.exceeded],
    computedAt: now.toISOString(),
  };
}

export interface NewRunBudgetsCheck {
  /** O primeiro `BLOCK` atingido. Com ele, o Run não nasce. */
  readonly blocked: BudgetBreach | null;
  /** Os `WARN` atingidos: o Run nasce e cada um vira aviso e evento. */
  readonly warnings: BudgetBreach[];
  /** A maior pressão entre os orçamentos aplicáveis: o fato do roteamento. */
  readonly pressure: number;
}

/**
 * Todos os orçamentos que alcançam um Run novo, medidos e decididos.
 *
 * `PER_RUN` não entra nem na decisão nem na pressão: não há Run para medir.
 */
export async function checkBudgetsForNewRun(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string | null; loadoutId: string | null; now?: Date },
): Promise<NewRunBudgetsCheck> {
  const now = input.now ?? new Date();
  const aplicaveis = await listApplicableBudgets(db, input);
  const warnings: BudgetBreach[] = [];
  const pressoes: { pressure: number }[] = [];

  for (const budget of aplicaveis) {
    if (budget.window === "PER_RUN") continue;
    const usage = await computeBudgetUsage(db, { userId: input.userId, budget, now });
    pressoes.push({ pressure: usage.pressure });

    const check = checkBudgetForNewRun({
      budget: { id: budget.id, name: budget.name, window: budget.window, limits: usage.limits, action: budget.action },
      consumption: usage,
    });
    if (check.breach === null) continue;

    const breach: BudgetBreach = {
      budgetId: budget.id,
      name: budget.name,
      action: budget.action,
      limit: check.breach.limit,
      limitValue: check.breach.limitValue,
      current: check.breach.current,
      decidedBy: `BUDGET:${budget.id}`,
      reason: check.breach.reason,
      usage,
    };
    if (!check.admit) return { blocked: breach, warnings, pressure: budgetPressure(pressoes) };
    warnings.push(breach);
  }

  return { blocked: null, warnings, pressure: budgetPressure(pressoes) };
}

// --------------------------------------------------------------------------
// Escrita
// --------------------------------------------------------------------------

export interface CreateBudgetInput {
  userId: string;
  name: string;
  scope: BudgetScope;
  projectId?: string | null;
  loadoutId?: string | null;
  window: BudgetWindow;
  maxTokens?: number | null;
  maxRuns?: number | null;
  maxWallClockMs?: number | null;
  maxConcurrentRuns?: number | null;
  action?: BudgetAction;
  enabled?: boolean;
}

function conferirTetos(window: BudgetWindow, limits: BudgetLimits): AutonomyWriteFailure | null {
  const definidos = (Object.keys(limits) as BudgetLimitKey[]).filter((key) => limits[key] !== null);
  if (definidos.length === 0) return { code: "BUDGET_WITHOUT_LIMIT" };
  const permitidos = allowedLimitKeys(window);
  const fora = definidos.find((key) => !permitidos.includes(key));
  if (fora !== undefined) return { code: "BUDGET_LIMIT_NOT_ALLOWED", window, limit: fora };
  return null;
}

async function conferirEscopo(
  db: DatabaseExecutor,
  input: { userId: string; scope: BudgetScope; projectId: string | null; loadoutId: string | null },
): Promise<AutonomyWriteFailure | null> {
  const { scope } = input;
  if ((scope === "PROJECT") !== (input.projectId !== null)) {
    return {
      code: "SCOPE_MISMATCH",
      scope,
      field: "projectId",
      expected: scope === "PROJECT" ? "required" : "forbidden",
    };
  }
  if ((scope === "LOADOUT") !== (input.loadoutId !== null)) {
    return {
      code: "SCOPE_MISMATCH",
      scope,
      field: "loadoutId",
      expected: scope === "LOADOUT" ? "required" : "forbidden",
    };
  }
  if (input.projectId !== null) {
    const project = await findProjectRow(db, { userId: input.userId, projectId: input.projectId });
    if (project === null) return { code: "PROJECT_NOT_FOUND", projectId: input.projectId };
  }
  if (input.loadoutId !== null) {
    const loadout = await findLoadoutRow(db, { userId: input.userId, loadoutId: input.loadoutId });
    if (loadout === null) return { code: "LOADOUT_NOT_FOUND", loadoutId: input.loadoutId };
  }
  return null;
}

export async function createBudget(
  db: Database,
  input: CreateBudgetInput,
): Promise<Result<Budget, AutonomyWriteFailure>> {
  return await db.transaction(async (tx) => {
    const projectId = input.projectId ?? null;
    const loadoutId = input.loadoutId ?? null;
    const limits: BudgetLimits = {
      maxTokens: input.maxTokens ?? null,
      maxRuns: input.maxRuns ?? null,
      maxWallClockMs: input.maxWallClockMs ?? null,
      maxConcurrentRuns: input.maxConcurrentRuns ?? null,
    };

    const recusaEscopo = await conferirEscopo(tx, { userId: input.userId, scope: input.scope, projectId, loadoutId });
    if (recusaEscopo !== null) return failed(recusaEscopo);
    const recusaTetos = conferirTetos(input.window, limits);
    if (recusaTetos !== null) return failed(recusaTetos);

    const [row] = await tx
      .insert(budgets)
      .values({
        id: newId(),
        userId: input.userId,
        name: input.name,
        scope: input.scope,
        projectId,
        loadoutId,
        window: input.window,
        ...limits,
        action: input.action ?? "BLOCK",
        enabled: input.enabled ?? true,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em budget não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "budget", id: row.id, action: "created" },
    });

    return ok(toBudget(row));
  });
}

export interface UpdateBudgetPatch {
  name?: string;
  maxTokens?: number | null;
  maxRuns?: number | null;
  maxWallClockMs?: number | null;
  maxConcurrentRuns?: number | null;
  action?: BudgetAction;
  enabled?: boolean;
}

export async function updateBudget(
  db: Database,
  input: { userId: string; budgetId: string; patch: UpdateBudgetPatch },
): Promise<Result<Budget, AutonomyWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findBudgetRow(tx, input);
    if (current === null) return null;

    const { patch } = input;
    const limits: BudgetLimits = {
      maxTokens: patch.maxTokens === undefined ? current.maxTokens : patch.maxTokens,
      maxRuns: patch.maxRuns === undefined ? current.maxRuns : patch.maxRuns,
      maxWallClockMs: patch.maxWallClockMs === undefined ? current.maxWallClockMs : patch.maxWallClockMs,
      maxConcurrentRuns:
        patch.maxConcurrentRuns === undefined ? current.maxConcurrentRuns : patch.maxConcurrentRuns,
    };
    const recusaTetos = conferirTetos(current.window, limits);
    if (recusaTetos !== null) return failed(recusaTetos);

    const [row] = await tx
      .update(budgets)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...limits,
        ...(patch.action === undefined ? {} : { action: patch.action }),
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      })
      .where(and(eq(budgets.id, input.budgetId), eq(budgets.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de budget não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "budget", id: row.id, action: "updated" },
    });

    return ok(toBudget(row));
  });
}

export async function deleteBudget(
  db: Database,
  input: { userId: string; budgetId: string },
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const current = await findBudgetRow(tx, input);
    if (current === null) return false;

    await tx
      .delete(budgets)
      .where(and(eq(budgets.id, input.budgetId), eq(budgets.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "budget", id: input.budgetId, action: "deleted" },
    });

    return true;
  });
}

/**
 * A pressão de orçamento de um contexto, sem decidir nada: o fato que o
 * roteamento e as sugestões usam. `PER_RUN` fica de fora, como na decisão.
 */
export async function computeBudgetPressure(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string | null; loadoutId: string | null; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date();
  const aplicaveis = await listApplicableBudgets(db, input);
  const pressoes: { pressure: number }[] = [];
  for (const budget of aplicaveis) {
    if (budget.window === "PER_RUN") continue;
    const usage = await computeBudgetUsage(db, { userId: input.userId, budget, now });
    pressoes.push({ pressure: usage.pressure });
  }
  return budgetPressure(pressoes);
}
