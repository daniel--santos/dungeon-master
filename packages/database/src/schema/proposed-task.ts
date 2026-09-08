import { PROPOSED_TASK_STATUS_VALUES } from "@dungeon-master/contracts";
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

import { projects } from "./project.js";
import { runs } from "./run.js";
import { tasks } from "./task.js";
import { users } from "./user.js";

export const proposedTaskStatus = pgEnum("proposed_task_status", PROPOSED_TASK_STATUS_VALUES);

/**
 * ProposedTask: trabalho que o resultado de um Run propôs (planejamento
 * v0.4, Fase 5).
 *
 * Gravada na **mesma transação** que `run.result` e o status terminal do Run,
 * pela porta `writeRunTerminalStatus`. `UNIQUE (origin_run_id, position)` é
 * a idempotência: reprocessar o mesmo resultado insere com `ON CONFLICT DO
 * NOTHING` e não duplica proposta.
 *
 * A decisão é um CAS (`UPDATE ... WHERE status = 'PROPOSED' AND decided_at IS
 * NULL`), e o `CHECK` fecha a metade estrutural: uma proposta `PROPOSED` com
 * `decided_at` preenchido, ou decidida sem instante, seria um estado que a
 * consulta condicional nunca esperaria. `created_task_id` só existe numa
 * aprovação, e o segundo `CHECK` diz isso.
 *
 * `set null` em `created_task_id`: apagar a Task criada não apaga a história
 * de que ela foi aprovada. Já a Task e o Run de origem levam a proposta junto
 * (`cascade`): sem eles ela não tem de onde ter vindo.
 */
export const proposedTasks = pgTable(
  "proposed_task",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    originTaskId: uuid("origin_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    originRunId: uuid("origin_run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** Posição em `discoveredTasks` do resultado. É a chave de idempotência com o Run. */
    position: integer("position").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    rationale: text("rationale"),
    status: proposedTaskStatus("status").notNull().default("PROPOSED"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    note: text("note"),
    createdTaskId: uuid("created_task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("proposed_task_run_position_uq").on(table.originRunId, table.position),
    // A caixa de entrada de propostas: por usuário, por estado, da mais recente.
    index("proposed_task_user_status_idx").on(table.userId, table.status, table.createdAt),
    // Os filtros da lista e a contagem de abertas por Project.
    index("proposed_task_project_status_idx").on(table.projectId, table.status),
    // "Esta Task tem propostas abertas?" é a pergunta do detalhe e do grafo.
    index("proposed_task_origin_task_status_idx").on(table.originTaskId, table.status),
    check("proposed_task_position_nonnegative_ck", sql`"position" >= 0`),
    check("proposed_task_decided_ck", sql`("status" = 'PROPOSED') = ("decided_at" is null)`),
    check("proposed_task_created_task_ck", sql`"created_task_id" is null or "status" = 'APPROVED'`),
  ],
);

export type ProposedTaskRow = typeof proposedTasks.$inferSelect;
export type NewProposedTaskRow = typeof proposedTasks.$inferInsert;
