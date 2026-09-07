import { hostname } from "node:os";

import { newId, resolveDatabaseUrl } from "@dungeon-master/database";

function readInt(name: string, fallback: number, minimum = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${name} precisa ser um inteiro >= ${minimum}; recebi ${JSON.stringify(raw)}.`);
  }
  return parsed;
}

/**
 * Identidade deste processo de Worker.
 *
 * Gravada em `run.claimed_by` a cada Run reclamado, e é o que a reconciliação
 * de partida usa para separar "meu" de "órfão". Precisa mudar a cada processo:
 * um id fixo por máquina faria o Worker novo adotar os Runs do Worker morto e
 * ficar esperando para sempre por processos de agente que não existem mais.
 *
 * O nome da máquina e o PID entram porque o id também vai para o log e para a
 * coluna, e "quem estava rodando isso" é a primeira pergunta de quem investiga.
 */
export function newWorkerId(): string {
  return `${hostname()}#${String(process.pid)}#${newId()}`;
}

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly nodeEnv: string;
  readonly isDevelopment: boolean;
  readonly logLevel: string;
  /** Identidade deste processo. Vai para `run.claimed_by`. */
  readonly workerId: string;
  /**
   * Intervalo entre tentativas de reclamar da fila.
   *
   * Um segundo, e não quinze: o caminho rápido é o `NOTIFY` do trigger de
   * `run`, e este tique é a rede de segurança para uma notificação perdida.
   * Curto o bastante para o cancelamento pedido pela interface ser observado
   * sem parecer travado, barato o bastante para não pesar — a consulta só toca
   * o índice de `status`.
   */
  readonly tickIntervalMs: number;
  /** Teto de Runs em execução ao mesmo tempo neste processo. */
  readonly maxConcurrentRuns: number;
  /**
   * Prazo do desligamento gracioso.
   *
   * É quanto o Worker espera pelos Runs em voo depois de mandar cancelar. Trinta
   * segundos porque o kill de árvore no Windows confirma por polling, e um
   * agente no meio de uma escrita em disco merece a chance de sair inteiro.
   */
  readonly shutdownTimeoutMs: number;
  /** Silêncio máximo de um agente antes do `RunTimedOut` do tipo `IDLE`. */
  readonly runIdleTimeoutMs: number;
  /** Teto absoluto de uma execução, do spawn ao evento terminal. */
  readonly runCompletionTimeoutMs: number;
  /**
   * Onde os worktrees de Run ficam. Vazio usa o padrão do `WorkspaceManager`:
   * `<pai do repositório>/.dm-worktrees/<nome do repositório>`.
   */
  readonly worktreesRoot: string | undefined;
}

export function loadConfig(): WorkerConfig {
  const nodeEnv = process.env["NODE_ENV"]?.trim() || "development";

  return {
    databaseUrl: resolveDatabaseUrl(),
    nodeEnv,
    isDevelopment: nodeEnv === "development",
    logLevel: process.env["LOG_LEVEL"]?.trim() || "info",
    workerId: newWorkerId(),
    tickIntervalMs: readInt("WORKER_TICK_INTERVAL_MS", 1_000, 50),
    maxConcurrentRuns: readInt("WORKER_MAX_CONCURRENT_RUNS", 2, 1),
    shutdownTimeoutMs: readInt("WORKER_SHUTDOWN_TIMEOUT_MS", 30_000, 100),
    runIdleTimeoutMs: readInt("WORKER_RUN_IDLE_TIMEOUT_MS", 600_000, 1_000),
    runCompletionTimeoutMs: readInt("WORKER_RUN_COMPLETION_TIMEOUT_MS", 3_600_000, 1_000),
    worktreesRoot: process.env["WORKER_WORKTREES_ROOT"]?.trim() || undefined,
  };
}
