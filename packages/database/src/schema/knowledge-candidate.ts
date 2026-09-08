import {
  KNOWLEDGE_CANDIDATE_DECISION_VALUES,
  KNOWLEDGE_CANDIDATE_STATUS_VALUES,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { distillationRuns } from "./distillation.js";
import { knowledgeItems } from "./knowledge-item.js";
import { projects } from "./project.js";
import { runs } from "./run.js";
import { tasks } from "./task.js";
import { users } from "./user.js";

export const knowledgeCandidateStatus = pgEnum(
  "knowledge_candidate_status",
  KNOWLEDGE_CANDIDATE_STATUS_VALUES,
);

export const knowledgeCandidateDecision = pgEnum(
  "knowledge_candidate_decision",
  KNOWLEDGE_CANDIDATE_DECISION_VALUES,
);

/**
 * KnowledgeCandidate: o que um Run aprendeu, à espera da destilação
 * (documento técnico, seções 21 e 35; planejamento v0.4, modelo das Fases
 * 4–6: "gravado na transação do resultado").
 *
 * Gravado pela mesma porta e na mesma transação que `proposed_task`, com a
 * mesma idempotência por `(run_id, position)`. As `decisions` do resultado
 * entram pela mesma porta, com `kind` = `decision`, numa faixa de posição
 * própria para não colidir com os `knowledgeCandidates`.
 *
 * O Distiller da Fase 6 consome daqui, sob advisory lock por Project, e é ele
 * quem move `status` para `PROMOTED`, `REJECTED` ou `MERGED`, gravando ao mesmo
 * tempo a decisão, o motivo, o item e o lote. O `CHECK` fecha a metade
 * estrutural: um candidato `PENDING` com decisão, ou decidido sem instante,
 * seria um estado que a consulta condicional do lote nunca esperaria.
 *
 * `kind` é texto livre, como no `KnowledgeCandidateInput` que o agente
 * escreve: o vocabulário fechado (`FACT`, `DECISION`, ...) é decisão do
 * Distiller, na promoção, e não uma restrição a impor a quem só está sugerindo.
 */
export const knowledgeCandidates = pgTable(
  "knowledge_candidate",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** Posição no resultado. É a chave de idempotência com o Run. */
    position: integer("position").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    kind: text("kind"),
    status: knowledgeCandidateStatus("status").notNull().default("PENDING"),
    decision: knowledgeCandidateDecision("decision"),
    reason: text("reason"),
    /** `set null`: apagar o item não apaga a história de que o candidato virou um. */
    knowledgeItemId: uuid("knowledge_item_id").references(() => knowledgeItems.id, {
      onDelete: "set null",
    }),
    distillationRunId: uuid("distillation_run_id").references(() => distillationRuns.id, {
      onDelete: "set null",
    }),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("knowledge_candidate_run_position_uq").on(table.runId, table.position),
    // O Distiller lê "os PENDING deste Project"; a lista filtra pelos dois.
    index("knowledge_candidate_project_status_idx").on(table.projectId, table.status),
    index("knowledge_candidate_task_idx").on(table.taskId),
    index("knowledge_candidate_item_idx").on(table.knowledgeItemId),
    check("knowledge_candidate_position_nonnegative_ck", sql`"position" >= 0`),
    check(
      "knowledge_candidate_processed_ck",
      sql`("status" = 'PENDING') = ("processed_at" is null) and ("status" = 'PENDING') = ("decision" is null)`,
    ),
  ],
);

export type KnowledgeCandidateRow = typeof knowledgeCandidates.$inferSelect;
export type NewKnowledgeCandidateRow = typeof knowledgeCandidates.$inferInsert;
