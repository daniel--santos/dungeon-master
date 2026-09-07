import { PROJECT_STATUS_VALUES } from "@dungeon-master/contracts";
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./user.js";

/**
 * Os valores vêm de `@dungeon-master/contracts` em vez de repetidos aqui: o
 * tipo do PostgreSQL, o enum Zod e a máquina de estados do domínio precisam
 * concordar, e a única forma de garantir isso sem disciplina é usar o mesmo
 * array nos três lugares.
 */
export const projectStatus = pgEnum("project_status", PROJECT_STATUS_VALUES);

/**
 * Project é a unidade persistente de contexto (documento técnico, seção 3).
 *
 * Arquivar não apaga: `status` vira `ARCHIVED` e `archived_at` guarda quando.
 * Um Project arquivado continua legível e não aceita Task nova.
 */
export const projects = pgTable(
  "project",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: projectStatus("status").notNull().default("ACTIVE"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // A listagem é sempre "os Projects do usuário, opcionalmente filtrados por
    // status, do último editado para o mais antigo".
    index("project_user_status_idx").on(table.userId, table.status, table.updatedAt),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
