import { resolveDatabaseUrl } from "@dungeon-master/database";

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} precisa ser um inteiro não negativo; recebi ${JSON.stringify(raw)}.`);
  }
  return parsed;
}

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly nodeEnv: string;
  readonly isDevelopment: boolean;
  readonly logLevel: string;
  /**
   * Timeouts do servidor HTTP do Node, todos em milissegundos.
   *
   * Existem explicitamente por causa do SSE (planejamento v0.4, seção 3.3 e
   * documento técnico, seção 8.2): sem eles, uma conexão de Expedição longa é
   * derrubada pelos padrões do Node.
   */
  readonly timeouts: {
    /** Duração máxima de uma requisição. `0` desliga o limite; é o que o SSE precisa. */
    readonly requestTimeoutMs: number;
    /** Espera pelos headers. Precisa ser maior que `keepAliveTimeoutMs`. */
    readonly headersTimeoutMs: number;
    /** Ociosidade tolerada entre requisições na mesma conexão. */
    readonly keepAliveTimeoutMs: number;
  };
  readonly sse: {
    /**
     * Intervalo do comentário de heartbeat. `0` desliga.
     *
     * Precisa ficar bem abaixo do timeout de qualquer proxy no caminho, senão
     * uma conexão sem eventos por alguns minutos é cortada e o browser
     * reconecta sem necessidade.
     */
    readonly heartbeatIntervalMs: number;
    /**
     * Tique de segurança do drain.
     *
     * O caminho normal é o `NOTIFY` acordando o drain na hora; este intervalo
     * cobre o caso de uma notificação perdida, por exemplo durante a reconexão
     * da conexão dedicada do `LISTEN`.
     */
    readonly fallbackIntervalMs: number;
  };
}

export function loadConfig(): ApiConfig {
  const nodeEnv = process.env["NODE_ENV"]?.trim() || "development";
  const headersTimeoutMs = readInt("API_HEADERS_TIMEOUT_MS", 65_000);
  const keepAliveTimeoutMs = readInt("API_KEEP_ALIVE_TIMEOUT_MS", 61_000);

  if (headersTimeoutMs !== 0 && headersTimeoutMs <= keepAliveTimeoutMs) {
    throw new Error(
      "API_HEADERS_TIMEOUT_MS precisa ser maior que API_KEEP_ALIVE_TIMEOUT_MS, " +
        "senão o Node derruba conexões que ainda estão sendo reaproveitadas.",
    );
  }

  return {
    // Só loopback. Expor a API na rede é decisão explícita, não default.
    host: process.env["API_HOST"]?.trim() || "127.0.0.1",
    port: readInt("API_PORT", 3333),
    databaseUrl: resolveDatabaseUrl(),
    nodeEnv,
    isDevelopment: nodeEnv === "development",
    logLevel: process.env["LOG_LEVEL"]?.trim() || "info",
    timeouts: {
      requestTimeoutMs: readInt("API_REQUEST_TIMEOUT_MS", 0),
      headersTimeoutMs,
      keepAliveTimeoutMs,
    },
    sse: {
      heartbeatIntervalMs: readInt("API_SSE_HEARTBEAT_MS", 15_000),
      fallbackIntervalMs: readInt("API_SSE_FALLBACK_INTERVAL_MS", 5_000),
    },
  };
}

/** Prefixo de toda rota da API. A versão faz parte do caminho, não de um header. */
export const API_BASE_PATH = "/api/v1" as const;

export const API_VERSION = "0.0.0" as const;
