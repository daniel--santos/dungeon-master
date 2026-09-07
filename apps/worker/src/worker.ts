import { RUN_CANCEL_CHANNEL, RUN_QUEUE_CHANNEL } from "@dungeon-master/contracts";
import {
  claimNextQueuedRun,
  createPgNotifier,
  listCancelRequestedRunIds,
  type ClaimedRun,
  type Database,
} from "@dungeon-master/database";
import { PgNotifyListener } from "@dungeon-master/events";
import { CapacityLock } from "@dungeon-master/runs";
import {
  createAgentRuntime,
  createHarnessRegistry,
  createWorkspaceManager,
  createWorkspaceResolver,
  type AgentRuntime,
  type HarnessAdapter,
  type WorkspaceManager,
} from "@dungeon-master/runtime";
import type { Pool } from "pg";

import { executeRun } from "./execute-run.js";
import { startIdleLoop, type IdleLoop } from "./idle-loop.js";
import type { Logger } from "./logger.js";
import { runBootPreflight, type PreflightOutcome } from "./preflight.js";
import { reconcileOrphanRuns, type ReconciledRun } from "./reconcile.js";

/**
 * O laço do Worker: a fila, a capacidade, o cancelamento e o desligamento.
 *
 * A API coordena, o Worker executa (documento técnico, seção 9). Uma chamada
 * HTTP não pode possuir o ciclo de vida de uma execução de quarenta minutos, e
 * é essa separação que dá retry, cancelamento e isolamento de falha.
 *
 * ## Duas travas, de propósito
 *
 * A `CapacityLock` (em memória) e a `workspace_lock` (no PostgreSQL) coexistem
 * porque respondem a perguntas diferentes. A do banco sobrevive a um restart e
 * coordena processos diferentes; a de memória ordena o que já está dentro deste
 * Worker sem custar uma ida ao banco por tentativa. A chave da de memória é o
 * **caminho de checkout**, e é isso que faz dois Runs com `GIT_WORKTREE` no
 * mesmo repositório rodarem em paralelo — caminhos diferentes — enquanto dois
 * Runs com `CURRENT` no mesmo repositório se enfileiram — mesmo caminho.
 *
 * ## Nunca reclamar mais do que se pode rodar
 *
 * Reclamar leva o Run a `PREPARING` e a Task a `RUNNING`, e não existe volta
 * para `QUEUED`. Por isso o laço só reclama enquanto houver folga: um Run
 * reclamado e enfileirado em memória por muito tempo apareceria "Preparando"
 * na tela sem nada acontecendo.
 */

export interface WorkerRuntimeConfig {
  readonly workerId: string;
  readonly tickIntervalMs: number;
  readonly maxConcurrentRuns: number;
  readonly shutdownTimeoutMs: number;
  readonly runIdleTimeoutMs: number;
  readonly runCompletionTimeoutMs: number;
  readonly worktreesRoot?: string | undefined;
}

export interface CreateWorkerOptions {
  readonly db: Database;
  readonly userId: string;
  readonly config: WorkerRuntimeConfig;
  readonly adapters: readonly HarnessAdapter[];
  readonly logger?: Logger;
  /**
   * Pool para o `LISTEN`. Sem ele o Worker funciona só pelo tique: a
   * notificação é latência, não correção.
   */
  readonly pool?: Pool;
  /** Injetáveis para teste; o padrão monta os de produção. */
  readonly runtime?: AgentRuntime;
  readonly workspace?: WorkspaceManager;
}

export interface WorkerBootReport {
  readonly preflight: readonly PreflightOutcome[];
  readonly reconciled: readonly ReconciledRun[];
}

export interface Worker {
  readonly workerId: string;
  /** Preflight, reconciliação e `LISTEN`. Não liga o laço. */
  boot(): Promise<WorkerBootReport>;
  /** Liga o laço de claim. */
  start(): void;
  /** Uma passada de claim, para teste e para o `NOTIFY`. */
  pump(): Promise<void>;
  /** Runs em execução ou esperando neste processo. */
  readonly inFlight: number;
  /** Cancela o que está em voo, espera o prazo e desliga. Idempotente. */
  stop(reason: string): Promise<void>;
}

export function createWorker(options: CreateWorkerOptions): Worker {
  const { db, userId, config, logger } = options;

  const workspace =
    options.workspace ??
    createWorkspaceManager(
      config.worktreesRoot === undefined ? {} : { worktreesRoot: config.worktreesRoot },
    );

  const runtime =
    options.runtime ??
    createAgentRuntime({
      registry: createHarnessRegistry([...options.adapters]),
      // O resolver recebe o mesmo manager, mas nunca cria nada: o Worker sempre
      // manda `checkoutPath` preenchido, e o contrato do resolver é não tocar
      // no disco quando ele vem. Dois criadores do mesmo worktree acabariam com
      // um removendo o do outro.
      workspace: createWorkspaceResolver({ manager: workspace }),
      defaultTimeouts: {
        idleMs: config.runIdleTimeoutMs,
        completionMs: config.runCompletionTimeoutMs,
      },
    });

  const capacity = new CapacityLock({
    maxConcurrent: config.maxConcurrentRuns,
    ...(logger === undefined ? {} : { logger }),
  });

  /** Runs reclamados e ainda não terminados. É o teto do claim e a lista do observador. */
  const emVoo = new Map<string, ClaimedRun>();
  /** Runs para os quais o cancelamento já foi disparado. Evita matar duas vezes. */
  const cancelados = new Set<string>();
  /** Por que o Worker cancelou. Lido por `executeRun` ao escrever o desfecho. */
  const cancelReasons = new Map<string, string>();

  let loop: IdleLoop | undefined;
  let stopping = false;
  let queueListener: PgNotifyListener | undefined;
  let cancelListener: PgNotifyListener | undefined;

  const cancelar = (runId: string, reason: string): void => {
    if (cancelados.has(runId)) return;
    cancelados.add(runId);
    cancelReasons.set(runId, reason);

    logger?.info({ runId, reason }, "cancelando run em voo");

    // `runtime.cancel` espera a árvore de processos ser tratada. Esperar isso
    // dentro do tique seguraria o laço inteiro por um kill que no Windows
    // confirma por polling; o desfecho continua vindo pelo `RunCancelled`, que
    // é quem escreve `CANCELLED`.
    void runtime.cancel(runId).catch((error: unknown) => {
      logger?.error({ err: error, runId }, "falha ao cancelar a árvore de processos do run");
    });
  };

  /** Observa `cancel_requested_at` dos Runs deste Worker. */
  const checarCancelamentos = async (): Promise<void> => {
    const ids = [...emVoo.keys()].filter((id) => !cancelados.has(id));
    if (ids.length === 0) return;

    const pedidos = await listCancelRequestedRunIds(db, { userId, runIds: ids });
    for (const runId of pedidos) cancelar(runId, "user_request");
  };

  const executar = async (claimed: ClaimedRun): Promise<void> => {
    try {
      await executeRun(
        {
          db,
          userId,
          runtime,
          workspace,
          timeouts: {
            idleMs: config.runIdleTimeoutMs,
            completionMs: config.runCompletionTimeoutMs,
          },
          cancelReasons,
          ...(logger === undefined ? {} : { logger }),
        },
        claimed,
      );
    } finally {
      emVoo.delete(claimed.run.id);
      cancelados.delete(claimed.run.id);
      cancelReasons.delete(claimed.run.id);
    }
  };

  const pump = async (): Promise<void> => {
    if (stopping) return;

    while (emVoo.size < config.maxConcurrentRuns && !stopping) {
      const claimed = await claimNextQueuedRun(db, { userId, claimedBy: config.workerId });
      if (claimed === null) break;

      const strategy = claimed.run.executionProfileSnapshot.workspaceStrategy;
      const repoPath = claimed.project.workspacePath ?? claimed.project.id;
      // A chave é o caminho de checkout: worktree por Run não colide, e
      // `CURRENT` no mesmo repositório colide sempre.
      const chave =
        strategy === "GIT_WORKTREE"
          ? workspace.worktreePathFor(repoPath, claimed.run.id)
          : repoPath;

      emVoo.set(claimed.run.id, claimed);

      const { status } = capacity.acquireLock(chave, () => executar(claimed));
      logger?.info(
        {
          runId: claimed.run.id,
          taskId: claimed.task.id,
          harness: claimed.run.harnessKey,
          attempt: claimed.run.attempt,
          capacity: status,
          key: chave,
        },
        "run reclamado da fila",
      );
    }

    await checarCancelamentos();
  };

  return {
    workerId: config.workerId,

    get inFlight() {
      return emVoo.size;
    },

    boot: async () => {
      const preflight = await runBootPreflight({
        db,
        userId,
        adapters: options.adapters,
        ...(logger === undefined ? {} : { logger }),
      });

      const reconciled = await reconcileOrphanRuns({
        db,
        userId,
        workerId: config.workerId,
        ...(logger === undefined ? {} : { logger }),
      });

      if (options.pool !== undefined) {
        const notifier = createPgNotifier(options.pool);

        queueListener = new PgNotifyListener({
          notifier,
          drainable: {
            drainNow: async () => {
              await pump();
            },
          },
          channel: RUN_QUEUE_CHANNEL,
          ...(logger === undefined ? {} : { logger }),
        });

        cancelListener = new PgNotifyListener({
          notifier,
          drainable: { drainNow: checarCancelamentos },
          channel: RUN_CANCEL_CHANNEL,
          ...(logger === undefined ? {} : { logger }),
        });

        // Não é fatal: sem o `LISTEN` o Worker continua funcionando pelo tique,
        // com a latência do intervalo em vez de instantânea.
        await queueListener.start();
        await cancelListener.start();
      }

      return { preflight, reconciled };
    },

    start: () => {
      if (loop !== undefined) return;
      loop = startIdleLoop({
        intervalMs: config.tickIntervalMs,
        onTick: pump,
        onError: (error, tick) => {
          logger?.error({ err: error, tick }, "erro no tique do worker; o laço continua");
        },
      });
    },

    pump,

    stop: async (reason: string) => {
      if (stopping) return;
      stopping = true;

      logger?.info({ reason, inFlight: emVoo.size }, "parando de reclamar da fila");

      queueListener?.stop();
      cancelListener?.stop();
      await loop?.stop();

      // Cancelar antes de esperar: o `drain` só termina quando os Runs em voo
      // acabarem, e um agente de quarenta minutos não acaba sozinho porque o
      // Worker pediu licença.
      for (const runId of emVoo.keys()) cancelar(runId, "worker_shutdown");

      if (emVoo.size === 0) return;

      const prazo = new Promise<"timeout">((resolve) => {
        const handle = setTimeout(() => resolve("timeout"), config.shutdownTimeoutMs);
        handle.unref?.();
      });

      const resultado = await Promise.race([
        capacity.drain().then(() => "drained" as const),
        prazo,
      ]);

      if (resultado === "timeout") {
        // Os Runs que sobraram ficam para a reconciliação da próxima partida:
        // forçar uma escrita terminal aqui gravaria um desfecho que ninguém
        // confirmou, que é justamente o que o contrato proíbe.
        logger?.error(
          { timeoutMs: config.shutdownTimeoutMs, remaining: [...emVoo.keys()] },
          "runs ainda em voo no fim do prazo de desligamento",
        );
      }
    },
  };
}
