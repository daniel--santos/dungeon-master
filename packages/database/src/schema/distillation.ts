import {
  DISTILLATION_RUN_STATUS_VALUES,
  DISTILLATION_TRIGGER_VALUES,
  type UsageSummary,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { achievementDefinitions } from "./achievement.js";
import { loadouts } from "./execution.js";
import { projects } from "./project.js";
import { users } from "./user.js";

export const distillationRunStatus = pgEnum(
  "distillation_run_status",
  DISTILLATION_RUN_STATUS_VALUES,
);

export const distillationTrigger = pgEnum("distillation_trigger", DISTILLATION_TRIGGER_VALUES);

/**
 * DistillationRun: um lote do Distiller sobre um Project (planejamento v0.4,
 * Fase 6).
 *
 * A linha nasce `RUNNING` **antes** da primeira chamada ao modelo e termina
 * `SUCCEEDED` ou `FAILED` com o erro: é o registro que impede o retry morto do
 * TencentDB (documento técnico, seção 20.1) — uma falha nunca some, e os
 * candidatos do lote continuam `PENDING` para a próxima tentativa.
 *
 * `set null` nas duas referências opcionais: apagar o Loadout do Escriba ou
 * descartar a forjada não apaga a história do lote.
 */
export const distillationRuns = pgTable(
  "distillation_run",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: distillationRunStatus("status").notNull().default("RUNNING"),
    trigger: distillationTrigger("trigger").notNull(),
    loadoutId: uuid("loadout_id").references(() => loadouts.id, { onDelete: "set null" }),
    harnessSessionId: text("harness_session_id"),
    usage: jsonb("usage").$type<UsageSummary>(),
    candidateCount: integer("candidate_count").notNull().default(0),
    promoted: integer("promoted").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
    merged: integer("merged").notNull().default(0),
    summaryRegenerated: boolean("summary_regenerated").notNull().default(false),
    forgedAchievementId: uuid("forged_achievement_id").references(() => achievementDefinitions.id, {
      onDelete: "set null",
    }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // A lista é "os lotes deste Project, do mais recente para o mais antigo".
    index("distillation_run_project_started_idx").on(table.projectId, table.startedAt),
    index("distillation_run_user_status_idx").on(table.userId, table.status),
    check("distillation_run_finished_ck", sql`("status" = 'RUNNING') = ("finished_at" is null)`),
    check("distillation_run_error_ck", sql`("error" is null) or ("status" = 'FAILED')`),
  ],
);

export type DistillationRunRow = typeof distillationRuns.$inferSelect;
export type NewDistillationRunRow = typeof distillationRuns.$inferInsert;
