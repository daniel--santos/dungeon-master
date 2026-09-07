import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { startTestPostgres } from "@dungeon-master/database/testing";

/**
 * Sobe o PostgreSQL de teste e roda o Playwright com `DATABASE_URL` no ambiente.
 *
 * Por que aqui e não no `globalSetup` do Playwright: os `webServer` da
 * configuração sobem **antes** do `globalSetup` (é a ordem de
 * `createGlobalSetupTasks` no runner), então a API já teria lido a
 * configuração sem a variável. Envolvendo a execução inteira, a URL do banco
 * existe antes do primeiro servidor e o desligamento acontece no `finally`,
 * mesmo quando a suíte falha.
 *
 * Nada de Docker: `startTestPostgres` usa `embedded-postgres` por `pg_ctl`,
 * que é o único caminho que funciona nos runners de Windows e macOS
 * (planejamento v0.4, princípio 3).
 */

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

const postgres = await startTestPostgres({ prefix: "dm-web-e2e-pgdata-" });

/** @type {import("node:child_process").ChildProcess | null} */
let child = null;
let stopping = false;

/** @param {string} signal */
function forward(signal) {
  stopping = true;
  child?.kill(signal === "SIGBREAK" ? "SIGTERM" : signal);
}

// SIGBREAK é o que o Ctrl+Break entrega no Windows; sem ele o banco ficaria de pé.
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, () => {
    forward(signal);
  });
}

/** @type {number} */
let exitCode;

try {
  exitCode = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: postgres.databaseUrl },
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal === null ? 0 : 1));
    });
  });
} finally {
  await postgres.stop();
}

const status = stopping && exitCode === 0 ? 1 : exitCode;

// Os dois: `exitCode` sobrevive a qualquer hook de saída instalado por
// dependência, e `exit` garante que um handle esquecido não segure o processo.
process.exitCode = status;
process.exit(status);
