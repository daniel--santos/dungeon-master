import type {
  ApprovalPolicy,
  PolicyAction,
  PolicySubject,
  RuleConditions,
} from "@dungeon-master/contracts";
import type { ApprovalPolicyRule } from "@dungeon-master/domain";
import { and, asc, count, desc, eq, isNull, or, type SQL } from "drizzle-orm";

import type { AutonomyWriteFailure } from "./autonomy-failure.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { findProjectRow } from "./project.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { approvalPolicies, type ApprovalPolicyRow } from "./schema/autonomy.js";

/**
 * ApprovalPolicy: a regra que decide sem humano (planejamento v0.4, Fase 9A).
 *
 * O repositório só guarda e lista; quem decide é `decideApproval`, no
 * domínio, sobre as políticas que `listPoliciesForDecision` lê **na
 * transação** da decisão — as ligadas do Project mais as globais, de todos os
 * assuntos, porque uma partida de Run e as propostas do desfecho dela podem
 * ser decididas na mesma transação e a leitura é uma só.
 */

export function toApprovalPolicy(row: ApprovalPolicyRow): ApprovalPolicy {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    projectId: row.projectId,
    priority: row.priority,
    conditions: row.conditions,
    action: row.action,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findApprovalPolicyRow(
  db: DatabaseExecutor,
  input: { userId: string; approvalPolicyId: string },
): Promise<ApprovalPolicyRow | null> {
  const [row] = await db
    .select()
    .from(approvalPolicies)
    .where(
      and(
        eq(approvalPolicies.id, input.approvalPolicyId),
        eq(approvalPolicies.userId, input.userId),
      ),
    );
  return row ?? null;
}

/** As políticas ligadas que valem num Project: as dele mais as globais. */
export async function listPoliciesForDecision(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string | null },
): Promise<ApprovalPolicyRule[]> {
  const escopo =
    input.projectId === null
      ? isNull(approvalPolicies.projectId)
      : or(isNull(approvalPolicies.projectId), eq(approvalPolicies.projectId, input.projectId));

  const rows = await db
    .select()
    .from(approvalPolicies)
    .where(and(eq(approvalPolicies.userId, input.userId), eq(approvalPolicies.enabled, true), escopo))
    .orderBy(desc(approvalPolicies.priority), asc(approvalPolicies.id));

  return rows.map(toApprovalPolicy);
}

export interface ApprovalPolicyFilters {
  projectId?: string | undefined;
  subject?: PolicySubject | undefined;
}

export interface ListApprovalPoliciesInput extends PageInput {
  userId: string;
  filters?: ApprovalPolicyFilters;
}

export async function listApprovalPolicies(
  db: DatabaseExecutor,
  input: ListApprovalPoliciesInput,
): Promise<PageResult<ApprovalPolicy>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(approvalPolicies.userId, input.userId)];
  if (filters.projectId !== undefined) {
    const doProject = or(
      isNull(approvalPolicies.projectId),
      eq(approvalPolicies.projectId, filters.projectId),
    );
    if (doProject !== undefined) conditions.push(doProject);
  }
  if (filters.subject !== undefined) conditions.push(eq(approvalPolicies.subject, filters.subject));
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(approvalPolicies)
    .where(where)
    .orderBy(desc(approvalPolicies.priority), asc(approvalPolicies.name), asc(approvalPolicies.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(approvalPolicies).where(where);

  return { items: rows.map(toApprovalPolicy), total: counted?.total ?? 0 };
}

export interface CreateApprovalPolicyInput {
  userId: string;
  name: string;
  subject: PolicySubject;
  projectId?: string | null;
  priority?: number;
  conditions?: RuleConditions;
  action: PolicyAction;
  enabled?: boolean;
}

export async function createApprovalPolicy(
  db: Database,
  input: CreateApprovalPolicyInput,
): Promise<Result<ApprovalPolicy, AutonomyWriteFailure>> {
  return await db.transaction(async (tx) => {
    const projectId = input.projectId ?? null;
    if (projectId !== null) {
      const project = await findProjectRow(tx, { userId: input.userId, projectId });
      if (project === null) {
        return failed<AutonomyWriteFailure>({ code: "PROJECT_NOT_FOUND", projectId });
      }
    }

    const [row] = await tx
      .insert(approvalPolicies)
      .values({
        id: newId(),
        userId: input.userId,
        name: input.name,
        subject: input.subject,
        projectId,
        priority: input.priority ?? 100,
        conditions: input.conditions ?? {},
        action: input.action,
        enabled: input.enabled ?? true,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em approval_policy não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "approval_policy", id: row.id, action: "created" },
    });

    return ok(toApprovalPolicy(row));
  });
}

export interface UpdateApprovalPolicyPatch {
  name?: string;
  subject?: PolicySubject;
  projectId?: string | null;
  priority?: number;
  conditions?: RuleConditions;
  action?: PolicyAction;
  enabled?: boolean;
}

export async function updateApprovalPolicy(
  db: Database,
  input: { userId: string; approvalPolicyId: string; patch: UpdateApprovalPolicyPatch },
): Promise<Result<ApprovalPolicy, AutonomyWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findApprovalPolicyRow(tx, input);
    if (current === null) return null;

    const { patch } = input;
    if (patch.projectId !== undefined && patch.projectId !== null) {
      const project = await findProjectRow(tx, { userId: input.userId, projectId: patch.projectId });
      if (project === null) {
        return failed<AutonomyWriteFailure>({
          code: "PROJECT_NOT_FOUND",
          projectId: patch.projectId,
        });
      }
    }

    const [row] = await tx
      .update(approvalPolicies)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.subject === undefined ? {} : { subject: patch.subject }),
        ...(patch.projectId === undefined ? {} : { projectId: patch.projectId }),
        ...(patch.priority === undefined ? {} : { priority: patch.priority }),
        ...(patch.conditions === undefined ? {} : { conditions: patch.conditions }),
        ...(patch.action === undefined ? {} : { action: patch.action }),
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      })
      .where(
        and(
          eq(approvalPolicies.id, input.approvalPolicyId),
          eq(approvalPolicies.userId, input.userId),
        ),
      )
      .returning();

    if (row === undefined) throw new Error("A atualização de approval_policy não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "approval_policy", id: row.id, action: "updated" },
    });

    return ok(toApprovalPolicy(row));
  });
}

export async function deleteApprovalPolicy(
  db: Database,
  input: { userId: string; approvalPolicyId: string },
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const current = await findApprovalPolicyRow(tx, input);
    if (current === null) return false;

    await tx
      .delete(approvalPolicies)
      .where(
        and(
          eq(approvalPolicies.id, input.approvalPolicyId),
          eq(approvalPolicies.userId, input.userId),
        ),
      );

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "approval_policy", id: input.approvalPolicyId, action: "deleted" },
    });

    return true;
  });
}
