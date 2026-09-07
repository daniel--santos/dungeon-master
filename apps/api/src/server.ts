import "dotenv/config";

import type { Server as HttpServer } from "node:http";

import { createAdaptorServer } from "@hono/node-server";
import { createDatabase, LOCAL_USER_ID, pingDatabase } from "@dungeon-master/database";

import { createApp } from "./app.js";
import {
  createEventsRuntime,
  createExecutionPort,
  createRunEventsRuntime,
  createSettingsPort,
  createWorkPort,
  loadAchievementCatalog,
} from "./composition.js";
import { API_BASE_PATH, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, pretty: config.isDevelopment });

const database = createDatabase({
  url: config.databaseUrl,
  applicationName: "dungeon-master-api",
});

// Um conjunto de transporte, poller e ouvinte de NOTIFY por processo: a conexão
// do `LISTEN` é dedicada e não volta ao pool.
const events = await createEventsRuntime({
  db: database.db,
  pool: database.pool,
  userId: LOCAL_USER_ID,
  logger,
  fallbackIntervalMs: config.sse.fallbackIntervalMs,
  heartbeatIntervalMs: config.sse.heartbeatIntervalMs,
});

// Os streams por Run. O `LISTEN` de `run_event` é um só, e ele acorda o drain
// de todos os Runs que alguém estiver olhando; transporte e poller nascem por
// Run, sob demanda, e morrem quando a última aba fecha.
const runEvents = createRunEventsRuntime({
  db: database.db,
  pool: database.pool,
  userId: LOCAL_USER_ID,
  logger,
  fallbackIntervalMs: config.sse.fallbackIntervalMs,
  heartbeatIntervalMs: config.sse.heartbeatIntervalMs,
});

// Uma leitura de disco só, no boot: o catálogo é arquivo versionado, e reler a
// cada abertura do Hall seria I/O por um dado que não muda em execução.
const achievements = loadAchievementCatalog({ logger });

const app = createApp({
  probeDatabase: () => pingDatabase(database.db),
  events: events.port,
  settings: createSettingsPort({ db: database.db, userId: LOCAL_USER_ID }),
  work: createWorkPort({ db: database.db, userId: LOCAL_USER_ID }),
  execution: createExecutionPort({ db: database.db, userId: LOCAL_USER_ID, runEvents }),
  achievements,
  logger,
  pingEnabled: config.nodeEnv !== "production",
});

await events.start();
await runEvents.start();

// `createAdaptorServer` tipa o retorno como a união HTTP/HTTPS/HTTP2. Sem
// `createServer` customizado o adapter usa `node:http`, e só o `http.Server`
// expõe as três propriedades de timeout ajustadas logo abaixo.
const server = createAdaptorServer({ fetch: app.fetch }) as HttpServer;

// Timeouts explícitos, ajustados para SSE (planejamento v0.4, seção 3.3).
// `requestTimeout = 0` remove o teto de 5 minutos que o Node aplica por padrão
// e que cortaria o streaming de uma Expedição longa. `headersTimeout` fica
// acima de `keepAliveTimeout` para não derrubar conexão em reuso.
server.requestTimeout = config.timeouts.requestTimeoutMs;
server.headersTimeout = config.timeouts.headersTimeoutMs;
server.keepAliveTimeout = config.timeouts.keepAliveTimeoutMs;

server.listen(config.port, config.host, () => {
  logger.info(
    {
      host: config.host,
      port: config.port,
      env: config.nodeEnv,
      timeouts: config.timeouts,
      sse: config.sse,
      achievements: {
        definitions: achievements.definitions.length,
        templates: achievements.templates.length,
        invalid: achievements.invalid.length,
      },
      health: `http://${config.host}:${config.port}${API_BASE_PATH}/health`,
      events: `http://${config.host}:${config.port}${API_BASE_PATH}/events/stream`,
      runs: `http://${config.host}:${config.port}${API_BASE_PATH}/runs`,
      openapi: `http://${config.host}:${config.port}${API_BASE_PATH}/openapi.json`,
      docs: `http://${config.host}:${config.port}${API_BASE_PATH}/docs`,
    },
    "API no ar",
  );
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "encerrando a API");

  // Os streams SSE primeiro: `server.close()` espera as conexões terminarem, e
  // uma conexão SSE não termina sozinha — o processo ficaria pendurado.
  await events.stop();
  await runEvents.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.close();

  logger.info("API encerrada");
  process.exit(0);
}

// SIGBREAK existe no Windows: é o que Ctrl+Break entrega ao processo.
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
  process.on(signal, () => void shutdown(signal));
}
