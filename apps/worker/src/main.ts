import "dotenv/config";

import { createDatabase, LOCAL_USER_ID, pingDatabase } from "@dungeon-master/database";
import {
  createAgentRuntime,
  createHarnessRegistry,
  createWorkspaceManager,
  createWorkspaceResolver,
} from "@dungeon-master/runtime";
import { antigravityHostAdapters } from "@dungeon-master/runtime-antigravity";
import { dockerAdapters, hostAdapters } from "@dungeon-master/runtime-sandcastle";

import { createAchievementProjector } from "./achievements.js";
import { loadConfig } from "./config.js";
import { createKnowledgeDistiller, createScribeRuntime } from "./distiller.js";
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

const achievements = createAchievementProjector({
  db: database.db,
  userId: LOCAL_USER_ID,
  logger,
});

// O primeiro passe sincroniza o catálogo e instancia os templates das entidades
// que já existem, mesmo sem nenhum fato novo para processar. Os passes do laço
// adiam isso para o primeiro lote com fatos, para um Worker parado não
// reescrever as definições a cada tique.
const projecao = await achievements.run("always");

logger.info(
  { processed: projecao.processed, unlocked: projecao.unlocked, error: projecao.error },
  projecao.ok
    ? "catálogo de Conquistas sincronizado e projeção em dia"
    : "projetor de Conquistas falhou no boot; o Worker sobe assim mesmo",
);

const worker = createWorker({
  db: database.db,
  pool: database.pool,
  userId: LOCAL_USER_ID,
  config,
  // Os dois modos no mesmo registry: a chave é o par `(harness, modo)`, e quem
  // escolhe entre `claude-code@host` e `claude-code@docker` é o
  // `ExecutionProfile.mode` do Run. Registrar os adapters de container não custa
  // nada quando não há Docker: o preflight deles é que falha, com a mensagem que
  // diz o que instalar ou construir.
  // O Antigravity entra pelo pacote dele, e não por `hostAdapters()`: ele não
  // é um provider do Sandcastle, é uma CLI que o projeto fala direto
  // (planejamento v0.4, Fase 3B).
  adapters: [...hostAdapters(), ...antigravityHostAdapters(), ...dockerAdapters()],
  achievements,
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

// O Distiller (Fase 6): um laço próprio, ao lado do laço de Runs. O Escriba
// entra pelo mesmo tipo de runtime das Expedições, com os adapters de host —
// o lote roda nesta máquina, num diretório temporário, e não num container.
const distiller = config.distiller.enabled
  ? createKnowledgeDistiller({
      db: database.db,
      pool: database.pool,
      userId: LOCAL_USER_ID,
      logger,
      config: config.distiller,
      runtime: createScribeRuntime({
        db: database.db,
        userId: LOCAL_USER_ID,
        logger,
        timeouts: {
          idleMs: config.distiller.llmIdleTimeoutMs,
          completionMs: config.distiller.llmCompletionTimeoutMs,
        },
        runtime: createAgentRuntime({
          registry: createHarnessRegistry([...hostAdapters(), ...antigravityHostAdapters()]),
          workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
        }),
      }),
    })
  : undefined;

if (distiller === undefined) {
  logger.warn(
    "laço do Distiller desligado (WORKER_DISTILLER_ENABLED=false); candidatos ficam PENDING",
  );
} else {
  const partida = await distiller.boot();
  distiller.start();
  logger.info(
    {
      idleMs: config.distiller.idleMs,
      tickIntervalMs: config.distiller.tickIntervalMs,
      batchSize: config.distiller.batchSize,
      pendingProjects: partida.pendingProjects,
      reconciled: partida.reconciled.length,
    },
    "laço do Distiller no ar; destilando candidatos por ociosidade, timer e NOTIFY",
  );
}

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
    // O Distiller primeiro: um lote em andamento termina antes de o pool fechar.
    await distiller?.stop();
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
