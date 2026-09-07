import { startTestPostgres } from "@dungeon-master/database/testing";

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

interface GlobalSetupContext {
  provide: <K extends "databaseUrl">(key: K, value: string) => void;
}

/**
 * Mesmo `globalSetup` de `packages/database`, pelo subpath público de testes:
 * sobe um PostgreSQL embutido via `pg_ctl`, migra, semeia e publica a URL com
 * `provide("databaseUrl", ...)`.
 */
export default async function setup({ provide }: GlobalSetupContext) {
  const postgres = await startTestPostgres({ prefix: "dm-api-pgdata-" });
  provide("databaseUrl", postgres.databaseUrl);
  return async () => {
    await postgres.stop();
  };
}
