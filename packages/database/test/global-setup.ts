import { startTestPostgres } from "../src/testing/index.js";

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

interface GlobalSetupContext {
  provide: <K extends "databaseUrl">(key: K, value: string) => void;
}

/**
 * Sobe um PostgreSQL embutido (via `pg_ctl`), aplica as migrações, semeia o
 * usuário local e publica a URL para os testes via `inject("databaseUrl")`.
 * Os detalhes, e os motivos de usar `pg_ctl`, estão em
 * `src/testing/embedded-postgres.ts`.
 */
export default async function setup({ provide }: GlobalSetupContext) {
  const postgres = await startTestPostgres({ prefix: "dm-pgdata-" });
  provide("databaseUrl", postgres.databaseUrl);
  return async () => {
    await postgres.stop();
  };
}
