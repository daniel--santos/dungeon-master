import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import EmbeddedPostgres from "embedded-postgres";

import { createDatabase } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";
import { seedLocalUser } from "../src/seed.js";

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

interface GlobalSetupContext {
  provide: <K extends "databaseUrl">(key: K, value: string) => void;
}

const TEST_DATABASE = "dungeon_master_test";
const TEST_USER = "dungeon";
const TEST_PASSWORD = "dungeon";

/** Pede uma porta livre ao sistema operacional em vez de chutar um número. */
async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Não foi possível descobrir uma porta livre."));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export default async function setup({ provide }: GlobalSetupContext) {
  const dataDir = mkdtempSync(join(tmpdir(), "dm-pgdata-"));
  const port = await findFreePort();

  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: TEST_USER,
    password: TEST_PASSWORD,
    port,
    persistent: false,
    // Sem estes flags o initdb herda a locale do sistema: WIN1252 e
    // `portuguese` no Windows, UTF8 e `en_US` no macOS. Ordenação e busca
    // textual passariam a depender da máquina.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onError: (message) => process.stderr.write(String(message)),
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(TEST_DATABASE);

  const databaseUrl = `postgresql://${TEST_USER}:${TEST_PASSWORD}@127.0.0.1:${port}/${TEST_DATABASE}`;

  await runMigrations(databaseUrl);

  const handle = createDatabase({ url: databaseUrl, max: 1, applicationName: "vitest-seed" });
  try {
    await seedLocalUser(handle.db);
  } finally {
    await handle.close();
  }

  provide("databaseUrl", databaseUrl);

  return async () => {
    await postgres.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}
