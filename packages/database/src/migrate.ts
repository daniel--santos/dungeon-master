import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "./client.js";

/**
 * Pasta das migrações geradas por `drizzle-kit generate`.
 *
 * Resolvida a partir deste módulo, e não do diretório de trabalho, para que
 * `pnpm db:migrate` funcione da raiz do monorepo, de dentro do pacote e do
 * `globalSetup` do Vitest. `src/` e `dist/` estão ambos um nível abaixo da
 * raiz do pacote, então o caminho relativo é o mesmo nos dois casos.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export interface RunMigrationsResult {
  readonly databaseUrl: string;
  readonly migrationsFolder: string;
  readonly durationMs: number;
}

/** Aplica todas as migrações pendentes e fecha a conexão. */
export async function runMigrations(url?: string): Promise<RunMigrationsResult> {
  const handle = createDatabase({ url, max: 1, applicationName: "dungeon-master-migrate" });
  const startedAt = Date.now();

  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }

  return {
    databaseUrl: url ?? "DATABASE_URL",
    migrationsFolder: MIGRATIONS_FOLDER,
    durationMs: Date.now() - startedAt,
  };
}
