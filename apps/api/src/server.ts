import "dotenv/config";

import type { Server as HttpServer } from "node:http";

import { createAdaptorServer } from "@hono/node-server";
import { createDatabase, pingDatabase } from "@dungeon-master/database";

import { createApp } from "./app.js";
import { API_BASE_PATH, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, pretty: config.isDevelopment });

const database = createDatabase({
  url: config.databaseUrl,
  applicationName: "dungeon-master-api",
});

const app = createApp({
  probeDatabase: () => pingDatabase(database.db),
  logger,
});

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
      health: `http://${config.host}:${config.port}${API_BASE_PATH}/health`,
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

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.close();

  logger.info("API encerrada");
  process.exit(0);
}

// SIGBREAK existe no Windows: é o que Ctrl+Break entrega ao processo.
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
  process.on(signal, () => void shutdown(signal));
}
