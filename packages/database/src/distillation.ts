import {
  type DistillationRun,
  type DistillationRunStatus,
  type DistillationTrigger,
  KNOWLEDGE_DISTILL_CHANNEL,
  type UsageSummary,
} from "@dungeon-master/contracts";
import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import type { PageInput, PageResult } from "./result.js";
import { type DistillationRunRow, distillationRuns } from "./schema/distillation.js";
import { knowledgeCandidates } from "./schema/knowledge-candidate.js";

/**
 * DistillationRun: o registro de cada lote do Distiller (planejamento v0.4,
 * Fase 6).
 *
 * Criado `RUNNING` antes da primeira chamada ao modelo e terminado
 * `SUCCEEDED` ou `FAILED` depois, sempre pelo pool e nunca dentro da
 * transação do lote: um lote que falhou precisa continuar existindo, com o
 * erro, depois do rollback (documento técnico, seção 20.1).
 */

export function toDistillationRun(row: DistillationRunRow): DistillationRun {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    trigger: row.trigger,
    loadoutId: row.loadoutId,
    harnessSessionId: row.harnessSessionId,
    usage: row.usage,
    candidateCount: row.candidateCount,
    promoted: row.promoted,
    rejected: row.rejected,
    merged: row.merged,
    summaryRegenerated: row.summaryRegenerated,
    forgedAchievementId: row.forgedAchievementId,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export interface CreateDistillationRunInput {
  userId: string;
  projectId: string;
  trigger: DistillationTrigger;
  loadoutId: string | null;
}

export async function createDistillationRun(
  db: DatabaseExecutor,
  input: CreateDistillationRunInput,
): Promise<{ id: string }> {
  const id = newId();
  await db.insert(distillationRuns).values({
    id,
    userId: input.userId,
    projectId: input.projectId,
    status: "RUNNING",
    trigger: input.trigger,
    loadoutId: input.loadoutId,
  });
  return { id };
}

export interface FinishDistillationRunInput {
  userId: string;
  id: string;
  status: "SUCCEEDED" | "FAILED";
  error: string | null;
  candidateCount: number;
  promoted: number;
  rejected: number;
  merged: number;
  summaryRegenerated: boolean;
  forgedAchievementId: string | null;
  harnessSessionId: string | null;
  usage: UsageSummary | null;
}

export async function finishDistillationRun(
  db: DatabaseExecutor,
  input: FinishDistillationRunInput,
): Promise<void> {
  await db
    .update(distillationRuns)
    .set({
      status: input.status,
      error: input.status === "FAILED" ? input.error : null,
      candidateCount: input.candidateCount,
      promoted: input.promoted,
      rejected: input.rejected,
      merged: input.merged,
      summaryRegenerated: input.summaryRegenerated,
      forgedAchievementId: input.forgedAchievementId,
      harnessSessionId: input.harnessSessionId,
      usage: input.usage,
      finishedAt: new Date(),
    })
    .where(and(eq(distillationRuns.id, input.id), eq(distillationRuns.userId, input.userId)));
}

export async function getDistillationRun(
  db: DatabaseExecutor,
  input: { userId: string; distillationRunId: string },
): Promise<DistillationRun | null> {
  const [row] = await db
    .select()
    .from(distillationRuns)
    .where(
      and(
        eq(distillationRuns.id, input.distillationRunId),
        eq(distillationRuns.userId, input.userId),
      ),
    );
  return row === undefined ? null : toDistillationRun(row);
}

export interface DistillationRunFilters {
  projectId?: string | undefined;
  status?: DistillationRunStatus | undefined;
}

export interface ListDistillationRunsInput extends PageInput {
  userId: string;
  filters?: DistillationRunFilters;
}

/** Os lotes, do mais recente para o mais antigo. */
export async function listDistillationRuns(
  db: DatabaseExecutor,
  input: ListDistillationRunsInput,
): Promise<PageResult<DistillationRun>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(distillationRuns.userId, input.userId)];
  if (filters.projectId !== undefined)
    conditions.push(eq(distillationRuns.projectId, filters.projectId));
  if (filters.status !== undefined) conditions.push(eq(distillationRuns.status, filters.status));
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(distillationRuns)
    .where(where)
    .orderBy(desc(distillationRuns.startedAt), desc(distillationRuns.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(distillationRuns).where(where);

  return { items: rows.map(toDistillationRun), total: counted?.total ?? 0 };
}

/**
 * O lote mais recente do Project. Com `finishedOnly`, só os que já
 * terminaram — é o que a forja usa para saber "desde quando" olhar os Runs.
 */
export async function latestDistillationRun(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string; finishedOnly?: boolean },
): Promise<DistillationRunRow | null> {
  const [row] = await db
    .select()
    .from(distillationRuns)
    .where(
      and(
        eq(distillationRuns.userId, input.userId),
        eq(distillationRuns.projectId, input.projectId),
        input.finishedOnly === true
          ? inArray(distillationRuns.status, ["SUCCEEDED", "FAILED"])
          : sql`true`,
      ),
    )
    .orderBy(desc(distillationRuns.startedAt), desc(distillationRuns.id))
    .limit(1);

  return row ?? null;
}

/** Teto de idade de um lote `RUNNING` antes de a partida do Worker o considerar órfão. */
export const STALE_DISTILLATION_RUN_MS = 60 * 60 * 1000;

/**
 * Fecha como `FAILED` os lotes que ficaram `RUNNING` depois de o processo
 * que os conduzia morrer.
 *
 * O lock do lote é transacional e morre com a conexão, e a transação com as
 * decisões foi desfeita, então os candidatos continuam `PENDING`: nada se
 * perdeu. O que sobra é a linha do lote, e é ela que precisa dizer o que
 * aconteceu em vez de ficar `RUNNING` para sempre.
 */
export async function reconcileStaleDistillationRuns(
  db: DatabaseExecutor,
  input: { userId: string; olderThanMs?: number; now?: Date },
): Promise<{ reconciled: string[] }> {
  const limite = new Date(
    (input.now ?? new Date()).getTime() - (input.olderThanMs ?? STALE_DISTILLATION_RUN_MS),
  );
  const rows = await db
    .update(distillationRuns)
    .set({
      status: "FAILED",
      error: "O Worker reiniciou com o lote em andamento; os candidatos continuam PENDING.",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(distillationRuns.userId, input.userId),
        eq(distillationRuns.status, "RUNNING"),
        sql`${distillationRuns.startedAt} < ${limite}`,
      ),
    )
    .returning({ id: distillationRuns.id });

  return { reconciled: rows.map((row) => row.id) };
}

export async function countPendingKnowledgeCandidates(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(knowledgeCandidates)
    .where(
      and(
        eq(knowledgeCandidates.userId, input.userId),
        eq(knowledgeCandidates.projectId, input.projectId),
        eq(knowledgeCandidates.status, "PENDING"),
      ),
    );
  return row?.total ?? 0;
}

export interface PendingCandidatesByProject {
  readonly projectId: string;
  readonly pending: number;
  readonly oldestAt: string;
}

/** Os Projects com candidatos `PENDING`, para o Worker agendar na partida e no tique. */
export async function listProjectsWithPendingCandidates(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<PendingCandidatesByProject[]> {
  const rows = await db
    .select({
      projectId: knowledgeCandidates.projectId,
      pending: count(),
      oldestAt: sql<Date>`min(${knowledgeCandidates.createdAt})`,
    })
    .from(knowledgeCandidates)
    .where(
      and(eq(knowledgeCandidates.userId, input.userId), eq(knowledgeCandidates.status, "PENDING")),
    )
    .groupBy(knowledgeCandidates.projectId);

  return rows.map((row) => ({
    projectId: row.projectId,
    pending: row.pending,
    oldestAt: new Date(row.oldestAt).toISOString(),
  }));
}

/**
 * Pede um lote ao Worker: um `NOTIFY` sem payload no canal de pedidos.
 *
 * O pedido em si não é durável, e não precisa ser: os candidatos são. Se o
 * Worker estiver fora do ar, o `NOTIFY` se perde e o lote sai no timer da
 * próxima partida. O que a resposta carrega é a contagem de pendentes, para
 * a tela dizer "não há nada a destilar" sem esperar um lote vazio.
 */
export async function requestDistillation(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<{ pendingCandidates: number }> {
  const pendingCandidates = await countPendingKnowledgeCandidates(db, input);
  await db.execute(sql`select pg_notify(${KNOWLEDGE_DISTILL_CHANNEL}, '')`);
  return { pendingCandidates };
}
