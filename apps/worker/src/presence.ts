import type { WorkerHarness } from "@dungeon-master/contracts";
import {
  heartbeatWorker,
  markStaleWorkers,
  registerWorker,
  staleAfterMs,
  stopWorker,
  type Database,
} from "@dungeon-master/database";

import type { Logger } from "./logger.js";
import type { PreflightOutcome } from "./preflight.js";

/**
 * A presença deste Worker (planejamento v0.4, Fase 10A).
 *
 * Grava a linha no boot, renova o batimento a cada intervalo e escreve
 * `stopped_at` no desligamento gracioso. A varredura de silenciosos roda no
 * mesmo tique: quem descobre que um colega parou de bater é quem está vivo, e é
 * por isso que a reconciliação deixa de ser coisa só de partida.
 *
 * ## Nada aqui pode derrubar a fila
 *
 * O batimento é observabilidade e coordenação, não execução. Um `UPDATE` que
 * falha vira log e o laço segue; o Worker continua reclamando e executando
 * Runs. O preço de uma falha prolongada é ser visto como `STALE` por um colega
 * — e é justamente por isso que o prazo é de três intervalos, e não de um.
 */

export interface WorkerPresenceOptions {
  readonly db: Database;
  readonly userId: string;
  readonly workerId: string;
  readonly hostname: string;
  readonly pid: number;
  readonly version: string;
  readonly nodeVersion: string;
  readonly capacity: number;
  readonly heartbeatIntervalMs: number;
  readonly logger?: Logger;
}

export interface WorkerPresence {
  /** Silêncio que torna um Worker `STALE`: três intervalos. */
  readonly staleAfterMs: number;
  /** Grava a linha e anuncia `worker.online`. */
  register(harnesses: readonly WorkerHarness[]): Promise<void>;
  /** Renova o batimento e varre os silenciosos. Nunca lança. */
  beat(): Promise<void>;
  /** Escreve `stopped_at` e anuncia `worker.offline`. Idempotente. */
  stop(): Promise<void>;
}

/** O resumo que o boot mediu, no formato que a linha de presença guarda. */
export function harnessSummary(outcomes: readonly PreflightOutcome[]): WorkerHarness[] {
  const porChave = new Map<string, WorkerHarness>();

  for (const outcome of outcomes) {
    // Um Harness pode ter mais de um adapter registrado (host e container). A
    // linha de presença descreve **esta máquina**, então vale o que o preflight
    // de host mediu — e o `runBootPreflight` já só devolve os de host.
    if (porChave.has(outcome.harnessKey)) continue;
    porChave.set(outcome.harnessKey, {
      key: outcome.harnessKey,
      version: outcome.version,
      authStatus: outcome.authStatus,
    });
  }

  return [...porChave.values()];
}

export function createWorkerPresence(options: WorkerPresenceOptions): WorkerPresence {
  const { db, userId, workerId, logger } = options;
  const limite = staleAfterMs(options.heartbeatIntervalMs);

  return {
    staleAfterMs: limite,

    register: async (harnesses) => {
      await registerWorker(db, {
        userId,
        workerId,
        hostname: options.hostname,
        pid: options.pid,
        version: options.version,
        nodeVersion: options.nodeVersion,
        capacity: options.capacity,
        harnesses,
      });
      logger?.info(
        {
          workerId,
          capacity: options.capacity,
          heartbeatIntervalMs: options.heartbeatIntervalMs,
          staleAfterMs: limite,
        },
        "presença do Worker registrada",
      );
    },

    beat: async () => {
      try {
        const voltou = await heartbeatWorker(db, { userId, workerId });
        if (voltou) {
          logger?.warn({ workerId }, "este Worker estava marcado como silencioso e voltou a bater");
        }
      } catch (error) {
        logger?.error({ err: error, workerId }, "falha ao renovar o batimento; o laço segue");
      }

      try {
        const silenciosos = await markStaleWorkers(db, { userId, staleAfterMs: limite });
        for (const worker of silenciosos) {
          logger?.warn(
            { workerId: worker.id, pid: worker.pid, lastHeartbeatAt: worker.lastHeartbeatAt },
            "worker sem batimento há mais de três intervalos; marcado como silencioso",
          );
        }
      } catch (error) {
        logger?.error({ err: error }, "falha na varredura de Workers silenciosos; o laço segue");
      }
    },

    stop: async () => {
      try {
        await stopWorker(db, { userId, workerId });
        logger?.info({ workerId }, "presença do Worker encerrada");
      } catch (error) {
        // O desligamento não pode falhar por causa disto. Sem `stopped_at`, o
        // colega sobrevivente ainda fecha os Runs deste Worker pelo silêncio —
        // só demora três intervalos a mais.
        logger?.error({ err: error, workerId }, "falha ao gravar o desligamento da presença");
      }
    },
  };
}
