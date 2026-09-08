import type {
  KnowledgeItem,
  KnowledgeItemStatus,
  KnowledgeItemType,
  KnowledgeReviewFilter,
  ProjectSummary,
} from "@dungeon-master/contracts";
import { escapeXmlTags } from "@dungeon-master/context";
import { sanitizeCredentials } from "@dungeon-master/events";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { findProjectRow } from "./project.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import {
  KNOWLEDGE_FTS_CONFIG,
  type KnowledgeItemRow,
  knowledgeItems,
} from "./schema/knowledge-item.js";

/**
 * KnowledgeItem: o Grimório visto pela API (planejamento v0.4, Fase 6).
 *
 * O que **escreve** itens a partir de candidatos é o Distiller, por
 * `knowledge-distiller.ts`, dentro do lock do Project. Aqui mora o que o
 * usuário faz com eles: ler, buscar, editar, arquivar e revisar. A revisão é
 * um CAS sobre `status = 'PENDING_REVIEW'`, como o do ApprovalGate e o da
 * ProposedTask: quem perde a corrida recebe o item como ficou, e nada é
 * sobrescrito.
 */

export function toKnowledgeItem(row: KnowledgeItemRow): KnowledgeItem {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    status: row.status,
    title: row.title,
    content: row.content,
    provenance: row.provenance,
    version: row.version,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type KnowledgeItemWriteFailure =
  | {
      /** O CAS perdeu: o item já foi revisado. `item` é o estado atual. */
      readonly code: "KNOWLEDGE_ITEM_ALREADY_REVIEWED";
      readonly item: KnowledgeItem;
    }
  | {
      /** Arquivar exige `ACTIVE`; desarquivar exige `ARCHIVED`. */
      readonly code: "KNOWLEDGE_ITEM_ARCHIVE_NOT_ALLOWED";
      readonly status: KnowledgeItemStatus;
    }
  | {
      /** O resumo não troca de tipo: é regenerado pelo Distiller. */
      readonly code: "KNOWLEDGE_SUMMARY_TYPE_LOCKED";
    };

// --------------------------------------------------------------------------
// Leitura
// --------------------------------------------------------------------------

export async function findKnowledgeItemRow(
  db: DatabaseExecutor,
  input: { userId: string; knowledgeItemId: string },
): Promise<KnowledgeItemRow | null> {
  const [row] = await db
    .select()
    .from(knowledgeItems)
    .where(
      and(eq(knowledgeItems.id, input.knowledgeItemId), eq(knowledgeItems.userId, input.userId)),
    );

  return row ?? null;
}

async function lockKnowledgeItemRow(
  db: DatabaseExecutor,
  input: { userId: string; knowledgeItemId: string },
): Promise<KnowledgeItemRow | null> {
  const [row] = await db
    .select()
    .from(knowledgeItems)
    .where(
      and(eq(knowledgeItems.id, input.knowledgeItemId), eq(knowledgeItems.userId, input.userId)),
    )
    .for("update");

  return row ?? null;
}

export async function getKnowledgeItem(
  db: DatabaseExecutor,
  input: { userId: string; knowledgeItemId: string },
): Promise<KnowledgeItem | null> {
  const row = await findKnowledgeItemRow(db, input);
  return row === null ? null : toKnowledgeItem(row);
}

export interface KnowledgeItemFilters {
  projectId?: string | undefined;
  type?: KnowledgeItemType | undefined;
  status?: KnowledgeItemStatus | undefined;
  review?: KnowledgeReviewFilter | undefined;
  /** Busca textual, FTS do PostgreSQL. */
  q?: string | undefined;
}

export interface ListKnowledgeItemsInput extends PageInput {
  userId: string;
  filters?: KnowledgeItemFilters;
}

/**
 * O instante da última regeneração do resumo, **lido pelo banco**.
 *
 * Uma subconsulta, e não o `Date` da linha já carregada: `timestamptz` tem
 * microssegundos e o `Date` do JavaScript só chega a milissegundo, então o
 * instante devolvido ao banco chegaria truncado e todo item criado no mesmo
 * milissegundo do resumo contaria como posterior a ele. É a mesma lição do
 * cursor do projetor de Conquistas.
 */
export function summaryUpdatedAt(summaryId: string) {
  return sql`(select ki.updated_at from knowledge_item ki where ki.id = ${summaryId})`;
}

/** A consulta de busca: `plainto_tsquery`, que tolera qualquer texto do usuário. */
function searchQuery(q: string): SQL {
  return sql`plainto_tsquery(${KNOWLEDGE_FTS_CONFIG}, ${q})`;
}

/**
 * A listagem do Grimório.
 *
 * Do item mais recente para o mais antigo; com `q`, por relevância do FTS e
 * depois por data. O desempate por `id` é obrigatório: o id é UUIDv7, então
 * dentro do mesmo instante ele é a ordem de inserção.
 */
export async function listKnowledgeItems(
  db: DatabaseExecutor,
  input: ListKnowledgeItemsInput,
): Promise<PageResult<KnowledgeItem>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(knowledgeItems.userId, input.userId)];
  if (filters.projectId !== undefined)
    conditions.push(eq(knowledgeItems.projectId, filters.projectId));
  if (filters.type !== undefined) conditions.push(eq(knowledgeItems.type, filters.type));
  if (filters.status !== undefined) conditions.push(eq(knowledgeItems.status, filters.status));
  if (filters.review === "pending") conditions.push(eq(knowledgeItems.status, "PENDING_REVIEW"));
  if (filters.review === "reviewed") conditions.push(isNotNull(knowledgeItems.reviewedAt));

  const q = filters.q?.trim();
  const busca = q === undefined || q.length === 0 ? null : q;
  if (busca !== null) conditions.push(sql`${knowledgeItems.search} @@ ${searchQuery(busca)}`);

  const where = and(...conditions);

  const ordem =
    busca === null
      ? [desc(knowledgeItems.createdAt), desc(knowledgeItems.id)]
      : [
          sql`ts_rank(${knowledgeItems.search}, ${searchQuery(busca)}) desc`,
          desc(knowledgeItems.createdAt),
          desc(knowledgeItems.id),
        ];

  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(where)
    .orderBy(...ordem)
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(knowledgeItems).where(where);

  return { items: rows.map(toKnowledgeItem), total: counted?.total ?? 0 };
}

/**
 * O resumo corrente do Project e o quanto ele está atrasado.
 *
 * `promotedSinceSummary` conta os itens que ficaram ativos depois da última
 * regeneração — o instante de ativação é `reviewed_at` com revisão e
 * `created_at` sem ela —, que é o mesmo número que o gatilho olha.
 */
export async function getProjectSummary(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<ProjectSummary | null> {
  const project = await findProjectRow(db, input);
  if (project === null) return null;

  const [summary] = await db
    .select()
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.userId, input.userId),
        eq(knowledgeItems.projectId, input.projectId),
        eq(knowledgeItems.type, "SUMMARY"),
        ne(knowledgeItems.status, "ARCHIVED"),
      ),
    )
    .orderBy(desc(knowledgeItems.createdAt))
    .limit(1);

  const ativos = and(
    eq(knowledgeItems.userId, input.userId),
    eq(knowledgeItems.projectId, input.projectId),
    ne(knowledgeItems.type, "SUMMARY"),
    eq(knowledgeItems.status, "ACTIVE"),
  );

  const [total] = await db.select({ total: count() }).from(knowledgeItems).where(ativos);

  const [novos] =
    summary === undefined
      ? [total]
      : await db
          .select({ total: count() })
          .from(knowledgeItems)
          .where(
            and(
              ativos,
              sql`coalesce(${knowledgeItems.reviewedAt}, ${knowledgeItems.createdAt}) > ${summaryUpdatedAt(summary.id)}`,
            ),
          );

  return {
    projectId: input.projectId,
    item: summary === undefined ? null : toKnowledgeItem(summary),
    activeItemCount: total?.total ?? 0,
    promotedSinceSummary: novos?.total ?? 0,
  };
}

export interface ListProjectDecisionsInput extends PageInput {
  userId: string;
  projectId: string;
  status?: KnowledgeItemStatus | undefined;
}

/**
 * As decisões do Project, em ordem cronológica.
 *
 * Da mais antiga para a mais nova, ao contrário das outras listas: um diário
 * de decisões se lê na ordem em que as escolhas foram feitas. Sem `status`,
 * entram as ativas e as em revisão — o que já vale e o que está por valer;
 * recusadas e arquivadas só quando pedidas.
 */
export async function listProjectDecisions(
  db: DatabaseExecutor,
  input: ListProjectDecisionsInput,
): Promise<PageResult<KnowledgeItem> | null> {
  const project = await findProjectRow(db, input);
  if (project === null) return null;

  const where = and(
    eq(knowledgeItems.userId, input.userId),
    eq(knowledgeItems.projectId, input.projectId),
    eq(knowledgeItems.type, "DECISION"),
    input.status === undefined
      ? inArray(knowledgeItems.status, ["ACTIVE", "PENDING_REVIEW"])
      : eq(knowledgeItems.status, input.status),
  );

  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(where)
    .orderBy(asc(knowledgeItems.createdAt), asc(knowledgeItems.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(knowledgeItems).where(where);

  return { items: rows.map(toKnowledgeItem), total: counted?.total ?? 0 };
}

// --------------------------------------------------------------------------
// Escrita pelo usuário
// --------------------------------------------------------------------------

function normalizarTexto(text: string): string {
  return escapeXmlTags(sanitizeCredentials(text)).trim();
}

function normalizarNota(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const limpo = normalizarTexto(note);
  return limpo.length === 0 ? null : limpo;
}

export interface UpdateKnowledgeItemInput {
  userId: string;
  knowledgeItemId: string;
  patch: {
    title?: string | undefined;
    content?: string | undefined;
    type?: Exclude<KnowledgeItemType, "SUMMARY"> | undefined;
    archived?: boolean | undefined;
  };
}

/**
 * Edita um item.
 *
 * Título, conteúdo e tipo sobem a `version` quando mudam de fato; o texto do
 * usuário passa pela mesma sanitização que o do modelo, porque também vai
 * viver num prompt na Fase 7. `archived` só sai de `ACTIVE` e só volta de
 * `ARCHIVED`: arquivar um item em revisão seria decidir por ele sem dizer.
 */
export async function updateKnowledgeItem(
  db: Database,
  input: UpdateKnowledgeItemInput,
): Promise<Result<KnowledgeItem, KnowledgeItemWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await lockKnowledgeItemRow(tx, input);
    if (current === null) return null;

    const { patch } = input;

    if (patch.type !== undefined && current.type === "SUMMARY") {
      return failed<KnowledgeItemWriteFailure>({ code: "KNOWLEDGE_SUMMARY_TYPE_LOCKED" });
    }

    const values: Partial<KnowledgeItemRow> = {};
    let versao = false;

    if (patch.title !== undefined) {
      const title = normalizarTexto(patch.title);
      if (title.length > 0 && title !== current.title) {
        values.title = title;
        versao = true;
      }
    }
    if (patch.content !== undefined) {
      const content = normalizarTexto(patch.content);
      if (content.length > 0 && content !== current.content) {
        values.content = content;
        versao = true;
      }
    }
    if (patch.type !== undefined && patch.type !== current.type) {
      values.type = patch.type;
      versao = true;
    }

    if (patch.archived === true && current.status !== "ARCHIVED") {
      if (current.status !== "ACTIVE") {
        return failed<KnowledgeItemWriteFailure>({
          code: "KNOWLEDGE_ITEM_ARCHIVE_NOT_ALLOWED",
          status: current.status,
        });
      }
      values.status = "ARCHIVED";
      values.archivedAt = new Date();
    } else if (patch.archived === false && current.status === "ARCHIVED") {
      values.status = "ACTIVE";
      values.archivedAt = null;
    } else if (patch.archived === false && current.status !== "ACTIVE") {
      return failed<KnowledgeItemWriteFailure>({
        code: "KNOWLEDGE_ITEM_ARCHIVE_NOT_ALLOWED",
        status: current.status,
      });
    }

    if (Object.keys(values).length === 0) return ok(toKnowledgeItem(current));

    const [row] = await tx
      .update(knowledgeItems)
      .set({ ...values, ...(versao ? { version: sql`${knowledgeItems.version} + 1` } : {}) })
      .where(and(eq(knowledgeItems.id, current.id), eq(knowledgeItems.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de knowledge_item não devolveu linha.");
    return ok(toKnowledgeItem(row));
  });
}

export interface ReviewKnowledgeItemInput {
  userId: string;
  knowledgeItemId: string;
  note?: string | null | undefined;
}

/**
 * Aprova um item em revisão: vira `ACTIVE`.
 *
 * O CAS é `status = 'PENDING_REVIEW'`. Na mesma transação saem
 * `knowledge.item.reviewed`, para a tela, e `knowledge_item.promoted`, que é
 * o fato que o projetor de Conquistas consome — o item só conta como
 * "escrito no Grimório" quando fica ativo, e com a revisão ligada é aqui que
 * isso acontece.
 */
export async function approveKnowledgeItem(
  db: Database,
  input: ReviewKnowledgeItemInput,
): Promise<Result<KnowledgeItem, KnowledgeItemWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await lockKnowledgeItemRow(tx, input);
    if (current === null) return null;

    if (current.status !== "PENDING_REVIEW") {
      return failed<KnowledgeItemWriteFailure>({
        code: "KNOWLEDGE_ITEM_ALREADY_REVIEWED",
        item: toKnowledgeItem(current),
      });
    }

    const [row] = await tx
      .update(knowledgeItems)
      .set({ status: "ACTIVE", reviewedAt: new Date(), reviewNote: normalizarNota(input.note) })
      .where(
        and(
          eq(knowledgeItems.id, current.id),
          eq(knowledgeItems.userId, input.userId),
          eq(knowledgeItems.status, "PENDING_REVIEW"),
          isNull(knowledgeItems.reviewedAt),
        ),
      )
      .returning();

    if (row === undefined) {
      const atual = await findKnowledgeItemRow(tx, input);
      return failed<KnowledgeItemWriteFailure>({
        code: "KNOWLEDGE_ITEM_ALREADY_REVIEWED",
        item: toKnowledgeItem(atual ?? current),
      });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "knowledge.item.reviewed",
      payload: {
        knowledgeItemId: row.id,
        projectId: row.projectId,
        decision: "approve",
        status: row.status,
        type: row.type,
        title: row.title,
      },
    });

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "knowledge_item.promoted",
      payload: {
        knowledgeItemId: row.id,
        projectId: row.projectId,
        type: row.type,
        runId: row.provenance.runId,
        taskId: row.provenance.taskId,
      },
    });

    return ok(toKnowledgeItem(row));
  });
}

/** Recusa um item em revisão. O mesmo CAS, sem o fato do projetor. */
export async function rejectKnowledgeItem(
  db: Database,
  input: ReviewKnowledgeItemInput,
): Promise<Result<KnowledgeItem, KnowledgeItemWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await lockKnowledgeItemRow(tx, input);
    if (current === null) return null;

    if (current.status !== "PENDING_REVIEW") {
      return failed<KnowledgeItemWriteFailure>({
        code: "KNOWLEDGE_ITEM_ALREADY_REVIEWED",
        item: toKnowledgeItem(current),
      });
    }

    const [row] = await tx
      .update(knowledgeItems)
      .set({ status: "REJECTED", reviewedAt: new Date(), reviewNote: normalizarNota(input.note) })
      .where(
        and(
          eq(knowledgeItems.id, current.id),
          eq(knowledgeItems.userId, input.userId),
          eq(knowledgeItems.status, "PENDING_REVIEW"),
          isNull(knowledgeItems.reviewedAt),
        ),
      )
      .returning();

    if (row === undefined) {
      const atual = await findKnowledgeItemRow(tx, input);
      return failed<KnowledgeItemWriteFailure>({
        code: "KNOWLEDGE_ITEM_ALREADY_REVIEWED",
        item: toKnowledgeItem(atual ?? current),
      });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "knowledge.item.reviewed",
      payload: {
        knowledgeItemId: row.id,
        projectId: row.projectId,
        decision: "reject",
        status: row.status,
        type: row.type,
        title: row.title,
      },
    });

    return ok(toKnowledgeItem(row));
  });
}
