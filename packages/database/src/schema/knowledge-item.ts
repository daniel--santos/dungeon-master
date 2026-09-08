import {
  KNOWLEDGE_ITEM_STATUS_VALUES,
  KNOWLEDGE_ITEM_TYPE_VALUES,
  type KnowledgeItemProvenance,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { projects } from "./project.js";
import { users } from "./user.js";

export const knowledgeItemType = pgEnum("knowledge_item_type", KNOWLEDGE_ITEM_TYPE_VALUES);
export const knowledgeItemStatus = pgEnum("knowledge_item_status", KNOWLEDGE_ITEM_STATUS_VALUES);

/**
 * `tsvector` não existe em `drizzle-orm/pg-core`; o tipo customizado declara
 * só o nome do tipo no PostgreSQL, e a coluna é gerada pelo próprio banco.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * A configuração de busca textual do Grimório.
 *
 * `simple`, e não `portuguese`: o conteúdo é escrito por agentes em português
 * e em inglês misturados, e um stemmer de uma língua só erraria na outra. O
 * recall do dedup é fail-open, então uma busca mais literal custa no máximo
 * um candidato a duplicata que o modelo não viu — nunca um item perdido.
 */
export const KNOWLEDGE_FTS_CONFIG = "simple" as const;

/**
 * KnowledgeItem: uma página do Grimório (planejamento v0.4, Fase 6).
 *
 * Escrita só pelo Distiller — promoção de candidato, mescla e regeneração do
 * `SUMMARY` — e pela revisão humana (aprovar, recusar, editar, arquivar). A
 * coluna `search` é gerada pelo banco a partir de título e conteúdo, e o
 * índice GIN sobre ela é o recall de candidatos a duplicata e a busca `q` da
 * API. Um índice único parcial para "um `SUMMARY` corrente por Project" foi
 * evitado de propósito, pelo mesmo motivo de `natural_key` nas Conquistas: o
 * `drizzle-kit` não round-tripa predicados de índice, e o `db:check` ficaria
 * vermelho para sempre. A regra vive na regeneração, que atualiza o resumo
 * corrente em vez de inserir outro.
 *
 * O `CHECK` fecha o que a máquina de estados da revisão promete: só um item
 * revisado tem `reviewed_at`, e só um arquivado tem `archived_at`.
 */
export const knowledgeItems = pgTable(
  "knowledge_item",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: knowledgeItemType("type").notNull(),
    status: knowledgeItemStatus("status").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    provenance: jsonb("provenance").$type<KnowledgeItemProvenance>().notNull(),
    version: integer("version").notNull().default(1),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    reviewNote: text("review_note"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // A lista do Grimório filtra por Project e estado; o resumo corrente é
    // "o SUMMARY não arquivado deste Project".
    index("knowledge_item_project_status_idx").on(table.projectId, table.status, table.createdAt),
    index("knowledge_item_project_type_idx").on(table.projectId, table.type),
    index("knowledge_item_search_idx").using("gin", table.search),
    check(
      "knowledge_item_reviewed_ck",
      sql`("status" in ('ACTIVE', 'REJECTED', 'ARCHIVED') or "reviewed_at" is null)`,
    ),
    check("knowledge_item_archived_ck", sql`("status" = 'ARCHIVED') = ("archived_at" is not null)`),
    check("knowledge_item_version_positive_ck", sql`"version" >= 1`),
  ],
);

export type KnowledgeItemRow = typeof knowledgeItems.$inferSelect;
export type NewKnowledgeItemRow = typeof knowledgeItems.$inferInsert;
