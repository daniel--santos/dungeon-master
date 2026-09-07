import { resolveDatabaseUrl } from "@dungeon-master/database";

function readInt(name: string, fallback: number, minimum = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${name} precisa ser um inteiro >= ${minimum}; recebi ${JSON.stringify(raw)}.`);
  }
  return parsed;
}

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly nodeEnv: string;
  readonly isDevelopment: boolean;
  readonly logLevel: string;
  /** Intervalo do laço ocioso. Vira o polling da fila na Fase 2. */
  readonly tickIntervalMs: number;
  /** Teto de espera pelo trabalho em andamento durante o shutdown. */
  readonly shutdownTimeoutMs: number;
}

export function loadConfig(): WorkerConfig {
  const nodeEnv = process.env["NODE_ENV"]?.trim() || "development";

  return {
    databaseUrl: resolveDatabaseUrl(),
    nodeEnv,
    isDevelopment: nodeEnv === "development",
    logLevel: process.env["LOG_LEVEL"]?.trim() || "info",
    tickIntervalMs: readInt("WORKER_TICK_INTERVAL_MS", 15_000, 100),
    shutdownTimeoutMs: readInt("WORKER_SHUTDOWN_TIMEOUT_MS", 10_000, 100),
  };
}
