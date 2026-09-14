import type { RoutingKind, RoutingRule, RuleConditions } from "@dungeon-master/contracts";
import type { RoutingRuleLike } from "@dungeon-master/domain";
import { and, asc, count, desc, eq, isNull, or, type SQL } from "drizzle-orm";

import type { AutonomyWriteFailure } from "./autonomy-failure.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { findModelRow } from "./harness.js";
import { newId } from "./ids.js";
import { findLoadoutRow } from "./loadout.js";
import { findProjectRow } from "./project.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { routingRules, type RoutingRuleRow } from "./schema/autonomy.js";
import { findWorkflowRow } from "./workflow.js";

/**
 * RoutingRule: escolhe Model, Loadout ou Workflow por condições (Fase 9A).
 *
 * O alvo e os fallbacks são conferidos na escrita contra a tabela da
 * espécie, e conferidos de novo na hora de rotear: uma regra guardada não é
 * garantia de que o alvo ainda existe, e quem roteia pula o que sumiu.
 */

export function toRoutingRule(row: RoutingRuleRow): RoutingRule {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    projectId: row.projectId,
    priority: row.priority,
    conditions: row.conditions,
    targetId: row.targetId,
    fallbackIds: [...row.fallbackIds],
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findRoutingRuleRow(
  db: DatabaseExecutor,
  input: { userId: string; routingRuleId: string },
): Promise<RoutingRuleRow | null> {
  const [row] = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.id, input.routingRuleId), eq(routingRules.userId, input.userId)));
  return row ?? null;
}

/** As regras ligadas que valem num Project: as dele mais as globais, de todas as espécies. */
export async function listRoutingRulesForDecision(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string | null },
): Promise<RoutingRuleLike[]> {
  const escopo =
    input.projectId === null
      ? isNull(routingRules.projectId)
      : or(isNull(routingRules.projectId), eq(routingRules.projectId, input.projectId));

  const rows = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.userId, input.userId), eq(routingRules.enabled, true), escopo))
    .orderBy(desc(routingRules.priority), asc(routingRules.id));

  return rows.map(toRoutingRule);
}

export interface RoutingRuleFilters {
  kind?: RoutingKind | undefined;
  projectId?: string | undefined;
}

export interface ListRoutingRulesInput extends PageInput {
  userId: string;
  filters?: RoutingRuleFilters;
}

export async function listRoutingRules(
  db: DatabaseExecutor,
  input: ListRoutingRulesInput,
): Promise<PageResult<RoutingRule>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(routingRules.userId, input.userId)];
  if (filters.kind !== undefined) conditions.push(eq(routingRules.kind, filters.kind));
  if (filters.projectId !== undefined) {
    const doProject = or(
      isNull(routingRules.projectId),
      eq(routingRules.projectId, filters.projectId),
    );
    if (doProject !== undefined) conditions.push(doProject);
  }
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(routingRules)
    .where(where)
    .orderBy(desc(routingRules.priority), asc(routingRules.name), asc(routingRules.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(routingRules).where(where);

  return { items: rows.map(toRoutingRule), total: counted?.total ?? 0 };
}

/** O alvo existe na tabela da espécie, para este usuário? */
export async function routingTargetExists(
  db: DatabaseExecutor,
  input: { userId: string; kind: RoutingKind; targetId: string },
): Promise<boolean> {
  switch (input.kind) {
    case "MODEL":
      return (await findModelRow(db, { userId: input.userId, modelId: input.targetId })) !== null;
    case "LOADOUT":
      return (
        (await findLoadoutRow(db, { userId: input.userId, loadoutId: input.targetId })) !== null
      );
    case "WORKFLOW":
      return (
        (await findWorkflowRow(db, { userId: input.userId, workflowId: input.targetId })) !== null
      );
  }
}

async function conferirAlvos(
  db: DatabaseExecutor,
  input: { userId: string; kind: RoutingKind; targetIds: readonly string[] },
): Promise<AutonomyWriteFailure | null> {
  for (const targetId of input.targetIds) {
    const existe = await routingTargetExists(db, {
      userId: input.userId,
      kind: input.kind,
      targetId,
    });
    if (!existe) return { code: "ROUTING_TARGET_NOT_FOUND", kind: input.kind, targetId };
  }
  return null;
}

export interface CreateRoutingRuleInput {
  userId: string;
  name: string;
  kind: RoutingKind;
  projectId?: string | null;
  priority?: number;
  conditions?: RuleConditions;
  targetId: string;
  fallbackIds?: readonly string[];
  enabled?: boolean;
}

export async function createRoutingRule(
  db: Database,
  input: CreateRoutingRuleInput,
): Promise<Result<RoutingRule, AutonomyWriteFailure>> {
  return await db.transaction(async (tx) => {
    const projectId = input.projectId ?? null;
    if (projectId !== null) {
      const project = await findProjectRow(tx, { userId: input.userId, projectId });
      if (project === null) {
        return failed<AutonomyWriteFailure>({ code: "PROJECT_NOT_FOUND", projectId });
      }
    }

    const fallbackIds = [...new Set(input.fallbackIds ?? [])].filter((id) => id !== input.targetId);
    const recusa = await conferirAlvos(tx, {
      userId: input.userId,
      kind: input.kind,
      targetIds: [input.targetId, ...fallbackIds],
    });
    if (recusa !== null) return failed(recusa);

    const [row] = await tx
      .insert(routingRules)
      .values({
        id: newId(),
        userId: input.userId,
        name: input.name,
        kind: input.kind,
        projectId,
        priority: input.priority ?? 100,
        conditions: input.conditions ?? {},
        targetId: input.targetId,
        fallbackIds,
        enabled: input.enabled ?? true,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em routing_rule não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "routing_rule", id: row.id, action: "created" },
    });

    return ok(toRoutingRule(row));
  });
}

export interface UpdateRoutingRulePatch {
  name?: string;
  projectId?: string | null;
  priority?: number;
  conditions?: RuleConditions;
  targetId?: string;
  fallbackIds?: readonly string[];
  enabled?: boolean;
}

export async function updateRoutingRule(
  db: Database,
  input: { userId: string; routingRuleId: string; patch: UpdateRoutingRulePatch },
): Promise<Result<RoutingRule, AutonomyWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findRoutingRuleRow(tx, input);
    if (current === null) return null;

    const { patch } = input;
    if (patch.projectId !== undefined && patch.projectId !== null) {
      const project = await findProjectRow(tx, {
        userId: input.userId,
        projectId: patch.projectId,
      });
      if (project === null) {
        return failed<AutonomyWriteFailure>({
          code: "PROJECT_NOT_FOUND",
          projectId: patch.projectId,
        });
      }
    }

    const targetId = patch.targetId ?? current.targetId;
    const fallbackIds =
      patch.fallbackIds === undefined
        ? [...current.fallbackIds]
        : [...new Set(patch.fallbackIds)].filter((id) => id !== targetId);

    const alvosNovos = [
      ...(patch.targetId === undefined ? [] : [patch.targetId]),
      ...(patch.fallbackIds === undefined ? [] : fallbackIds),
    ];
    const recusa = await conferirAlvos(tx, {
      userId: input.userId,
      kind: current.kind,
      targetIds: alvosNovos,
    });
    if (recusa !== null) return failed(recusa);

    const [row] = await tx
      .update(routingRules)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.projectId === undefined ? {} : { projectId: patch.projectId }),
        ...(patch.priority === undefined ? {} : { priority: patch.priority }),
        ...(patch.conditions === undefined ? {} : { conditions: patch.conditions }),
        targetId,
        fallbackIds,
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      })
      .where(and(eq(routingRules.id, input.routingRuleId), eq(routingRules.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de routing_rule não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "routing_rule", id: row.id, action: "updated" },
    });

    return ok(toRoutingRule(row));
  });
}

export async function deleteRoutingRule(
  db: Database,
  input: { userId: string; routingRuleId: string },
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const current = await findRoutingRuleRow(tx, input);
    if (current === null) return false;

    await tx
      .delete(routingRules)
      .where(and(eq(routingRules.id, input.routingRuleId), eq(routingRules.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "routing_rule", id: input.routingRuleId, action: "deleted" },
    });

    return true;
  });
}
