/**
 * `@dungeon-master/database` — Drizzle ORM, schema e migrações versionadas.
 *
 * Disciplina obrigatória (planejamento v0.4, seção 3.4): toda mudança de
 * schema gera migração versionada com `pnpm db:generate`, e `pnpm db:check`
 * falha no CI se o schema e as migrações divergirem.
 */

export * from "./client.js";
export * from "./env.js";
export * from "./health.js";
export * from "./ids.js";
export * from "./migrate.js";
export * from "./schema/index.js";
export * from "./seed.js";
