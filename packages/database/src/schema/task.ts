import {
  TASK_KIND_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { projects } from "./project.js";
import { users } from "./user.js";

export const taskStatus = pgEnum("task_status", TASK_STATUS_VALUES);
export const taskKind = pgEnum("task_kind", TASK_KIND_VALUES);
export const taskPriority = pgEnum("task_priority", TASK_PRIORITY_VALUES);

/**
 * Task é a única entidade de trabalho, e a Inbox são as Tasks em `INBOX`.
 *
 * `project_id` é anulável só por causa da Inbox: uma captura rápida precisa
 * custar um campo de texto, e escolher o Project é justamente o que "promover"
 * faz. O `CHECK` abaixo é o que impede essa brecha de virar uma Task órfã em
 * qualquer outro estado — é a mesma regra que
 * `taskStatusRequiresProject` aplica no domínio, escrita onde ninguém consegue
 * contornar.
 */
export const tasks = pgTable(
  "task",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    // A autorreferência precisa da anotação de tipo: sem ela o TypeScript entra
    // em recursão ao inferir o tipo da tabela a partir dela mesma.
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    kind: taskKind("kind").notNull().default("FEATURE"),
    status: taskStatus("status").notNull().default("READY"),
    priority: taskPriority("priority").notNull().default("MEDIUM"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("task_user_status_idx").on(table.userId, table.status, table.updatedAt),
    index("task_project_status_idx").on(table.projectId, table.status),
    index("task_parent_idx").on(table.parentTaskId),
    // Os nomes das colunas são escritos à mão, e não interpolados a partir do
    // objeto da tabela: a interpolação qualifica o identificador (`"task"."x"`)
    // e o PostgreSQL não aceita referência qualificada dentro de um CHECK.
    check("task_inbox_project_ck", sql`"status" = 'INBOX' or "project_id" is not null`),
  ],
);

/**
 * Aresta "esta Task espera aquela", com chave primária composta.
 *
 * A auto-dependência morre no `CHECK`; ciclo indireto não cabe em restrição de
 * tabela e é checado por `@dungeon-master/domain` dentro da transação que
 * insere a aresta.
 */
export const taskDependencies = pgTable(
  "task_dependency",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnTaskId], name: "task_dependency_pk" }),
    // O sentido inverso — "quem espera por esta Task" — aparece no detalhe de
    // toda Task, e sem este índice seria varredura da tabela inteira.
    index("task_dependency_depends_on_idx").on(table.dependsOnTaskId),
    check("task_dependency_no_self_ck", sql`"task_id" <> "depends_on_task_id"`),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type NewTaskDependencyRow = typeof taskDependencies.$inferInsert;
