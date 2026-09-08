import {
  type ContextBudget,
  type ContextExclusion,
  type ContextSection,
  type ContextUsage,
  RUN_CONTEXT_STATUS_VALUES,
  type RunContextPolicy,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
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

export const runContextStatus = pgEnum("run_context_status", RUN_CONTEXT_STATUS_VALUES);

/**
 * RunContext: o contexto montado para um Run (planejamento v0.4, Fase 7).
 *
 * **Um por Run**, e é o `UNIQUE (run_id)` que garante: o Worker grava a linha
 * quando reclama o Run, antes da primeira chamada ao agente, e todo passo e
 * toda retomada releem daqui em vez de montar de novo — é o que mantém o
 * texto idêntico ao longo do Run e preserva o cache de prompt (documento
 * técnico, seção 20.1). Uma corrida entre dois claims do mesmo Run termina com
 * o primeiro texto gravado valendo para os dois, pelo `ON CONFLICT DO NOTHING`
 * do repositório.
 *
 * `text` é o bloco exato que foi ao prompt; as colunas JSON são o registro do
 * que a montagem decidiu. `inherited_from_run_id` aponta para o Run cuja
 * sessão este retomou e de quem copiou o texto: a conversa que continua
 * recebe o contexto que já tinha. Os dois `CHECK`s fecham o que o contrato
 * promete: só `FAILED` tem erro, e só `ASSEMBLED` tem texto.
 */
export const runContexts = pgTable(
  "run_context",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: runContextStatus("status").notNull(),
    text: text("text").notNull(),
    query: text("query"),
    sections: jsonb("sections").$type<ContextSection[]>().notNull(),
    excluded: jsonb("excluded").$type<ContextExclusion[]>().notNull(),
    budget: jsonb("budget").$type<ContextBudget>().notNull(),
    usage: jsonb("usage").$type<ContextUsage>().notNull(),
    policy: jsonb("policy").$type<RunContextPolicy>().notNull(),
    inheritedFromRunId: uuid("inherited_from_run_id").references(() => runs.id, {
      onDelete: "set null",
    }),
    error: text("error"),
    assembledAt: timestamp("assembled_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("run_context_run_uq").on(table.runId),
    // "O que os Runs desta Task receberam?" é a leitura da tela da Task.
    index("run_context_task_idx").on(table.taskId, table.createdAt),
    check("run_context_error_ck", sql`("error" is null) or ("status" = 'FAILED')`),
    check("run_context_text_ck", sql`("status" = 'ASSEMBLED') = ("text" <> '')`),
  ],
);

export type RunContextRow = typeof runContexts.$inferSelect;
export type NewRunContextRow = typeof runContexts.$inferInsert;
