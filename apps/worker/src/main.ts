import "dotenv/config";

import { createDatabase, pingDatabase } from "@dungeon-master/database";

import { loadConfig } from "./config.js";
import { startIdleLoop } from "./idle-loop.js";
import { createLogger } from "./logger.js";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, pretty: config.isDevelopment });

logger.info(
  {
    env: config.nodeEnv,
    pid: process.pid,
    node: process.version,
    platform: process.platform,
    tickIntervalMs: config.tickIntervalMs,
  },
  "Worker iniciando",
);

const database = createDatabase({
  url: config.databaseUrl,
  max: 4,
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

const loop = startIdleLoop({
  intervalMs: config.tickIntervalMs,
  onTick: async (tick) => {
    // Fase 0: nenhuma fila ainda. O tick apenas confirma que o processo e a
    // conexão continuam vivos. Na Fase 2 este ponto vira o polling da fila.
    const ping = await pingDatabase(database.db);
    logger.debug({ tick, databaseOk: ping.ok, latencyMs: ping.latencyMs }, "tick ocioso");
  },
  onError: (error, tick) => {
    logger.error({ tick, err: error }, "erro no tick; o laço continua");
  },
});

logger.info("Worker no ar; aguardando trabalho");

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    logger.warn({ signal }, "shutdown já em andamento");
    return;
  }
  shuttingDown = true;

  logger.info({ signal }, "encerrando o Worker");

  const timeout = setTimeout(() => {
    logger.error(
      { timeoutMs: config.shutdownTimeoutMs },
      "shutdown excedeu o tempo; encerrando à força",
    );
    process.exit(1);
  }, config.shutdownTimeoutMs);
  timeout.unref();

  try {
    await loop.stop();
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
