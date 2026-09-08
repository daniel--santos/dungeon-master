/**
 * `@dungeon-master/database` — Drizzle ORM, schema e migrações versionadas.
 *
 * Disciplina obrigatória (planejamento v0.4, seção 3.4): toda mudança de
 * schema gera migração versionada com `pnpm db:generate`, e `pnpm db:check`
 * falha no CI se o schema e as migrações divergirem.
 */

export * from "./achievement.js";
export * from "./achievement-projector.js";
export * from "./activity.js";
export * from "./client.js";
export * from "./dashboard-event.js";
export * from "./demo.js";
export * from "./env.js";
export * from "./health.js";
export * from "./ids.js";
export * from "./inbox.js";
export * from "./migrate.js";
export * from "./notify.js";
export * from "./project.js";
export * from "./result.js";
export * from "./schema/index.js";
export * from "./seed.js";
export * from "./task.js";
export * from "./user-setting.js";
export * from "./agent.js";
export * from "./execution-profile.js";
export * from "./harness.js";
export * from "./loadout.js";
export * from "./registry.js";
export * from "./run.js";
export * from "./run-event.js";
export * from "./run-step.js";
export * from "./run-workflow.js";
export * from "./approval-gate.js";
export * from "./workflow.js";
export * from "./seed-workflow.js";
export * from "./seed-execution.js";
export * from "./workspace-lock.js";
