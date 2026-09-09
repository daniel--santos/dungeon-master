import type { JsonValue } from "@dungeon-master/contracts";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { projects } from "./project.js";
import { tasks } from "./task.js";
import { users } from "./user.js";

/**
 * O diário append-only de um Project.
 *
 * Não tem `updated_at` de propósito: uma linha aqui é o registro de que algo
 * aconteceu, e um registro que pode ser editado depois não serve de registro.
 * Cada linha é gravada na mesma transação da mudança que descreve.
 *
 * `type` é `text`, e não o enum do PostgreSQL: o vocabulário cresce a cada fase
 * e um `ALTER TYPE` por evento novo seria só cerimônia. O fechamento vale no
 * lado de quem escreve, pelo tipo `ActivityType` do contrato.
 */
export const activities = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<JsonValue>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // A leitura é sempre "o diário deste Project, do mais recente para o mais
    // antigo": é exatamente esta ordem de colunas.
    index("activity_project_created_idx").on(table.projectId, table.createdAt),
    index("activity_task_created_idx").on(table.taskId, table.createdAt),
    // O drain do projetor de Conquistas lê "do usuário X, na ordem em que
    // aconteceu, depois deste par": é exatamente esta ordem de colunas. Sem o
    // índice, cada tique de 1 s do Worker vira um seq scan mais um sort da
    // tabela inteira, e o passe que não acha nada custa o mesmo que o cheio.
    // É o mesmo motivo de `dashboard_event_user_sequence_idx`.
    index("activity_user_created_idx").on(table.userId, table.createdAt, table.id),
  ],
);

export type ActivityRow = typeof activities.$inferSelect;
export type NewActivityRow = typeof activities.$inferInsert;
