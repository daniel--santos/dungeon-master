import type {
  KnowledgeCandidate,
  KnowledgeCandidateInput,
  KnowledgeCandidateStatus,
} from "@dungeon-master/contracts";
import { sanitizeCredentials } from "@dungeon-master/events";
import { and, count, desc, eq, type SQL } from "drizzle-orm";

import type { DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import type { PageInput, PageResult } from "./result.js";
import { type KnowledgeCandidateRow, knowledgeCandidates } from "./schema/knowledge-candidate.js";

/**
 * KnowledgeCandidate: o que um Run aprendeu, à espera da destilação
 * (documento técnico, seção 21).
 *
 * Duas operações do lado do Run: gravar, na transação do desfecho, e listar.
 * Promover, rejeitar ou mesclar é trabalho do Distiller
 * (`knowledge-distiller.ts`), sob advisory lock por Project.
 */

export function toKnowledgeCandidate(row: KnowledgeCandidateRow): KnowledgeCandidate {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    runId: row.runId,
    title: row.title,
    content: row.content,
    kind: row.kind,
    status: row.status,
    decision: row.decision,
    reason: row.reason,
    knowledgeItemId: row.knowledgeItemId,
    distillationRunId: row.distillationRunId,
    processedAt: row.processedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PersistKnowledgeCandidatesInput {
  userId: string;
  projectId: string;
  taskId: string;
  runId: string;
  candidates: readonly KnowledgeCandidateInput[];
  /**
   * Deslocamento da posição. As `decisions` do resultado entram pela mesma
   * porta numa faixa própria, para não colidir com os `knowledgeCandidates`
   * na chave `(run_id, position)`.
   */
  positionOffset?: number;
}

function normalizar(text: string): string {
  return sanitizeCredentials(text).trim();
}

/**
 * Grava os `knowledgeCandidates` de um resultado.
 *
 * Mesmo contrato de `persistDiscoveredTasks`: recebe o executor da transação
 * do desfecho e é idempotente por `(run_id, position)`. Um candidato sem
 * título ou sem conteúdo depois de sanitizado não vale uma linha: o Distiller
 * não teria o que ler.
 */
export async function persistKnowledgeCandidates(
  db: DatabaseExecutor,
  input: PersistKnowledgeCandidatesInput,
): Promise<{ inserted: number }> {
  const offset = input.positionOffset ?? 0;
  const values = input.candidates.flatMap((candidate, position) => {
    const title = normalizar(candidate.title);
    const content = normalizar(candidate.content);
    if (title.length === 0 || content.length === 0) return [];
    const kind = candidate.kind === undefined ? null : normalizar(candidate.kind);
    return [
      {
        id: newId(),
        userId: input.userId,
        projectId: input.projectId,
        taskId: input.taskId,
        runId: input.runId,
        position: offset + position,
        title,
        content,
        kind: kind === null || kind.length === 0 ? null : kind,
        status: "PENDING" as const,
      },
    ];
  });

  if (values.length === 0) return { inserted: 0 };

  const inserted = await db
    .insert(knowledgeCandidates)
    .values(values)
    .onConflictDoNothing({ target: [knowledgeCandidates.runId, knowledgeCandidates.position] })
    .returning({ id: knowledgeCandidates.id });

  return { inserted: inserted.length };
}

export interface KnowledgeCandidateFilters {
  projectId?: string | undefined;
  status?: KnowledgeCandidateStatus | undefined;
  taskId?: string | undefined;
  runId?: string | undefined;
}

export interface ListKnowledgeCandidatesInput extends PageInput {
  userId: string;
  filters?: KnowledgeCandidateFilters;
}

/** A listagem, do candidato mais recente para o mais antigo. */
export async function listKnowledgeCandidates(
  db: DatabaseExecutor,
  input: ListKnowledgeCandidatesInput,
): Promise<PageResult<KnowledgeCandidate>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(knowledgeCandidates.userId, input.userId)];
  if (filters.projectId !== undefined) {
    conditions.push(eq(knowledgeCandidates.projectId, filters.projectId));
  }
  if (filters.status !== undefined) conditions.push(eq(knowledgeCandidates.status, filters.status));
  if (filters.taskId !== undefined) conditions.push(eq(knowledgeCandidates.taskId, filters.taskId));
  if (filters.runId !== undefined) conditions.push(eq(knowledgeCandidates.runId, filters.runId));

  const where = and(...conditions);

  const rows = await db
    .select()
    .from(knowledgeCandidates)
    .where(where)
    .orderBy(desc(knowledgeCandidates.createdAt), desc(knowledgeCandidates.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(knowledgeCandidates).where(where);

  return { items: rows.map(toKnowledgeCandidate), total: counted?.total ?? 0 };
}
