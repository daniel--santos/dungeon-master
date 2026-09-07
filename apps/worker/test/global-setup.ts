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
 * O mesmo PostgreSQL embutido dos testes de `@dungeon-master/database`: `pg_ctl`,
 * migrações aplicadas e o usuário local mais os cadastros fechados semeados.
 * Os motivos de não usar Docker nem o `start()` do pacote estão em
 * `packages/database/src/testing/embedded-postgres.ts`.
 */
export default async function setup({ provide }: GlobalSetupContext) {
  const postgres = await startTestPostgres({ prefix: "dm-worker-pgdata-" });
  provide("databaseUrl", postgres.databaseUrl);
  return async () => {
    await postgres.stop();
  };
}
