import {
  type AutonomyLevel,
  DEFAULT_AUTONOMY_LEVEL,
  PROJECT_STATUS_VALUES,
  WORKSPACE_KIND_VALUES,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./user.js";

/**
 * Os valores vêm de `@dungeon-master/contracts` em vez de repetidos aqui: o
 * tipo do PostgreSQL, o enum Zod e a máquina de estados do domínio precisam
 * concordar, e a única forma de garantir isso sem disciplina é usar o mesmo
 * array nos três lugares.
 */
export const projectStatus = pgEnum("project_status", PROJECT_STATUS_VALUES);
export const workspaceKind = pgEnum("workspace_kind", WORKSPACE_KIND_VALUES);

/**
 * Project é a unidade persistente de contexto (documento técnico, seção 3).
 *
 * Arquivar não apaga: `status` vira `ARCHIVED` e `archived_at` guarda quando.
 * Um Project arquivado continua legível e não aceita Task nova.
 *
 * `workspace_path` é o diretório local em que os agentes deste Project
 * trabalham, e é anulável porque a Fase 1 entregou o gerenciador de tarefas
 * antes do runtime: um Project criado para organizar trabalho manual não
 * precisa de diretório. Um Project **sem** ele não pode ter Run — a regra é do
 * domínio (`checkRunCreation`), não do banco, porque ela também depende do
 * estado da Task e das dependências, que nenhum `CHECK` alcança.
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
    workspaceKind: workspaceKind("workspace_kind").notNull().default("GIT_REPO"),
    workspacePath: text("workspace_path"),
    /**
     * A escada de autonomia (Fase 9A; documento técnico, seção 40). Inteiro
     * com `CHECK`, e não enum, porque a escada é ordinal — "nível 3 ou acima"
     * é uma comparação, e `allowsAutomation` no domínio é a única fonte do que
     * cada degrau libera. Nasce em 2: propõe, o humano decide.
     */
    autonomyLevel: integer("autonomy_level")
      .$type<AutonomyLevel>()
      .notNull()
      .default(DEFAULT_AUTONOMY_LEVEL),
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
    check("project_autonomy_level_ck", sql`"autonomy_level" between 0 and 4`),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
