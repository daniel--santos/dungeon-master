import {
  type Database,
  type DispatchOutcome,
  dispatchTask,
  listDispatchableTasks,
} from "@dungeon-master/database";

import type { Logger } from "./logger.js";

/**
 * O laço de auto-despacho (planejamento v0.4, Fase 9B): a cada passada do
 * laço ocioso, as Tasks que uma política criou num Project de nível ≥ 3 e
 * que ainda não têm Run ganham um — uma por Project, pelas sugestões de
 * roteamento e pelas mesmas recusas de `POST /runs`.
 *
 * O que decide mora em `@dungeon-master/database` (`dispatchTask`); o que
 * mora aqui é o **quando** e a memória curta do processo:
 *
 * - uma passada por tique, serializada, e nunca em paralelo com ela mesma;
 * - uma Task pulada não é reavaliada a cada tique: a recusa (sem Loadout,
 *   política que exige revisão, orçamento, disjuntor) costuma durar, e
 *   `dispatchTask` grava um `dispatch.skipped` por tentativa. O
 *   adiamento é em memória e por processo: um Worker que reinicia
 *   reavalia tudo, e `autonomy.changed` para baixo faz a Task sumir da
 *   lista elegível sem precisar de aviso.
 */

export interface DispatchLoopOptions {
  readonly db: Database;
  readonly userId: string;
  readonly logger?: Logger | undefined;
  /** Quanto esperar antes de reavaliar uma Task pulada. Padrão: 60 s. */
  readonly retryAfterMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}

export interface DispatchPassReport {
  readonly created: readonly { taskId: string; runId: string }[];
  readonly skipped: readonly { taskId: string; code: string }[];
  /** Tasks elegíveis que ainda esperam o adiamento de uma recusa anterior. */
  readonly deferred: number;
}

export interface DispatchLoop {
  /** Uma passada. Nunca lança: uma Task que estoura é logada e a passada segue. */
  pass(): Promise<DispatchPassReport>;
}

export const DEFAULT_DISPATCH_RETRY_AFTER_MS = 60_000;

export function createDispatchLoop(options: DispatchLoopOptions): DispatchLoop {
  const { db, userId, logger } = options;
  const now = options.now ?? (() => Date.now());
  const retryAfterMs = options.retryAfterMs ?? DEFAULT_DISPATCH_RETRY_AFTER_MS;
  /** Task pulada → instante a partir do qual ela volta a ser tentada. */
  const adiadas = new Map<string, number>();
  let emAndamento: Promise<DispatchPassReport> | undefined;

  const passada = async (): Promise<DispatchPassReport> => {
    const created: { taskId: string; runId: string }[] = [];
    const skipped: { taskId: string; code: string }[] = [];
    let deferred = 0;

    let elegiveis: Awaited<ReturnType<typeof listDispatchableTasks>>;
    try {
      elegiveis = await listDispatchableTasks(db, { userId });
    } catch (error) {
      logger?.error({ err: error }, "auto-despacho: não consegui listar as Tasks elegíveis");
      return { created, skipped, deferred };
    }

    const agora = now();
    for (const [taskId, ate] of adiadas) {
      if (ate <= agora || !elegiveis.some((task) => task.taskId === taskId)) adiadas.delete(taskId);
    }

    for (const task of elegiveis) {
      if (adiadas.has(task.taskId)) {
        deferred += 1;
        continue;
      }
      let outcome: DispatchOutcome;
      try {
        outcome = await dispatchTask(db, { userId, taskId: task.taskId, now: new Date(now()) });
      } catch (error) {
        logger?.error(
          { err: error, taskId: task.taskId, projectId: task.projectId },
          "auto-despacho: a Task lançou; adiada",
        );
        adiadas.set(task.taskId, now() + retryAfterMs);
        continue;
      }
      if (outcome.kind === "created") {
        created.push({ taskId: task.taskId, runId: outcome.run.id });
        logger?.info(
          {
            taskId: task.taskId,
            projectId: task.projectId,
            runId: outcome.run.id,
            loadout: outcome.loadout.decidedBy,
            workflow: outcome.workflow.decidedBy,
          },
          "auto-despacho: Run enfileirado para a Task criada por política",
        );
        continue;
      }
      skipped.push({ taskId: task.taskId, code: outcome.code });
      adiadas.set(task.taskId, now() + retryAfterMs);
      logger?.info(
        {
          taskId: task.taskId,
          projectId: task.projectId,
          code: outcome.code,
          reason: outcome.reason,
        },
        "auto-despacho: Task pulada",
      );
    }

    return { created, skipped, deferred };
  };

  return {
    pass: async () => {
      if (emAndamento !== undefined) return await emAndamento;
      emAndamento = passada().finally(() => {
        emAndamento = undefined;
      });
      return await emAndamento;
    },
  };
}
