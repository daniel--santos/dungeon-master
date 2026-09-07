import "dotenv/config";

import { createDatabase, LOCAL_USER_ID, pingDatabase } from "@dungeon-master/database";
import { hostAdapters } from "@dungeon-master/runtime-sandcastle";

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createWorker } from "./worker.js";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, pretty: config.isDevelopment });

logger.info(
  {
    env: config.nodeEnv,
    workerId: config.workerId,
    pid: process.pid,
    node: process.version,
    platform: process.platform,
    tickIntervalMs: config.tickIntervalMs,
    maxConcurrentRuns: config.maxConcurrentRuns,
  },
  "Worker iniciando",
);

const database = createDatabase({
  url: config.databaseUrl,
  // Uma conexão por Run concorrente, mais o laço, mais as duas dedicadas de
  // `LISTEN` — que saem do pool e não voltam.
  max: config.maxConcurrentRuns + 4,
  applicationName: "dungeon-master-worker",
});

// O Worker não sobe sem banco: sem ele não há fila, nem eventos, nem resultado.
const boot = await pingDatabase(database.db);

if (!boot.ok) {
  logger.error({ error: boot.error }, "Worker não conseguiu falar com o PostgreSQL");
  await database.close();
  process.exit(1);
}

logger.info({ latencyMs: boot.latencyMs }, "PostgreSQL respondeu ao SELECT 1");

const worker = createWorker({
  db: database.db,
  pool: database.pool,
  userId: LOCAL_USER_ID,
  config,
  adapters: hostAdapters(),
  logger,
});

const relatorio = await worker.boot();

if (relatorio.reconciled.length > 0) {
  logger.warn(
    { runs: relatorio.reconciled.map((run) => run.runId) },
    "runs órfãos de uma partida anterior foram encerrados como FAILED retentável",
  );
}

worker.start();

logger.info({ workerId: config.workerId }, "Worker no ar; consumindo a fila de Runs");

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    logger.warn({ signal }, "shutdown já em andamento");
    return;
  }
  shuttingDown = true;

  logger.info({ signal }, "encerrando o Worker");

  // A margem sobre o prazo do desligamento existe para o log final sair: sem
  // ela, a saída forçada dispararia junto com o fim do `drain` e o operador não
  // saberia se o Worker terminou limpo.
  const timeout = setTimeout(() => {
    logger.error(
      { timeoutMs: config.shutdownTimeoutMs },
      "shutdown excedeu o tempo; encerrando à força",
    );
    process.exit(1);
  }, config.shutdownTimeoutMs + 10_000);
  timeout.unref();

  try {
    await worker.stop(signal);
    await database.close();
    clearTimeout(timeout);
    logger.info("Worker encerrado com o trabalho em andamento concluído");
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    logger.error({ err: error }, "falha durante o shutdown");
    process.exit(1);
  }
}

// SIGBREAK só existe no Windows e é o que Ctrl+Break entrega ao processo;
// registrá-lo em outros sistemas é inofensivo.
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
  process.on(signal, () => void shutdown(signal));
}

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "exceção não capturada");
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "promessa rejeitada sem tratamento");
  void shutdown("unhandledRejection");
});
