import { RUN_CANCEL_CHANNEL, RUN_QUEUE_CHANNEL } from "@dungeon-master/contracts";
import {
  cancelRunWaitingApproval,
  claimNextQueuedRun,
  createPgNotifier,
  listCancelRequestedRunIds,
  listRunsWaitingApprovalWithCancelRequested,
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

import type { AchievementProjector } from "./achievements.js";
import type { MeasureCapabilities } from "./capability-check.js";
import { executeRun } from "./execute-run.js";
import { startIdleLoop, type IdleLoop } from "./idle-loop.js";
import type { Logger } from "./logger.js";
import { runBootPreflight, type PreflightOutcome } from "./preflight.js";
import { reconcileOrphanRuns, type ReconciledRun } from "./reconcile.js";
import { toRunEventInput, workerRunCancelled } from "./run-events.js";
import { createRunOutcomeWriter } from "./run-writers.js";

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
  /**
   * O projetor de Conquistas. Sem ele o Worker roda igual, sem projetar.
   *
   * Entra por injeção, e não montado aqui, porque ele lê o catálogo do disco:
   * um teste de fila não deveria tocar arquivo, e a Fase 2.5 é cosmética.
   */
  readonly achievements?: AchievementProjector;
  /** Injetáveis para teste; o padrão monta os de produção. */
  readonly runtime?: AgentRuntime;
  readonly workspace?: WorkspaceManager;
  /**
   * A URL do banco, entregue ao servidor MCP do Grimório pelo ambiente do
   * harness (Fase 7). Sem ela o Grimório não é oferecido a nenhum Run, e o
   * boot avisa.
   */
  readonly databaseUrl?: string;
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

  /**
   * A matriz do adapter registrado para o par, para o capability matching da
   * reclamação (Fase 8B). É a mesma lista que o `HarnessRegistry` do runtime
   * recebeu, e a mesma que o preflight de boot grava no banco.
   */
  const measureCapabilities: MeasureCapabilities = (key, mode) =>
    options.adapters.find(
      (adapter) => adapter.key === key && (adapter.executionMode ?? "HOST") === mode,
    )?.capabilities;

  /** Runs reclamados e ainda não terminados. É o teto do claim e a lista do observador. */
  const emVoo = new Map<string, ClaimedRun>();
  /** Runs para os quais o cancelamento já foi disparado. Evita matar duas vezes. */
  const cancelados = new Set<string>();
  /** Por que o Worker cancelou. Lido por `executeRun` ao escrever o desfecho. */
  const cancelReasons = new Map<string, string>();
  /**
   * O sinal de cancelamento de cada Run em voo.
   *
   * `runtime.cancel` alcança o agente; o sinal alcança o resto — um Run com
   * Workflow entre dois passos, ou num step de comando, não tem agente para
   * o runtime matar.
   */
  const sinais = new Map<string, AbortController>();
  /**
   * Runs cuja execução de fato começou.
   *
   * Um Run reclamado pode estar em voo sem estar executando: a `CapacityLock`
   * o segura na fila até a chave do checkout ou o teto liberarem. A diferença
   * decide quem escreve o desfecho de um cancelamento — o runtime, que já tem
   * processo para matar, ou o próprio Worker, que fecha o Run sem subir nada.
   */
  const emExecucao = new Set<string>();
  /**
   * Runs já fechados como cancelados sem terem começado.
   *
   * O trabalho continua na fila da `CapacityLock`, que não sabe desenfileirar;
   * esta marca é o que faz o handler sair sem executar quando a trava liberar.
   */
  const descartados = new Set<string>();

  let loop: IdleLoop | undefined;
  let stopping = false;
  let queueListener: PgNotifyListener | undefined;
  let cancelListener: PgNotifyListener | undefined;
  /** O `pump` em andamento. Serializa o tique, o `NOTIFY` e o desligamento. */
  let bombeando: Promise<void> | undefined;
  /** Chegou pedido de `pump` enquanto o anterior corria. */
  let bombearDeNovo = false;

  /**
   * Dispara o projetor de Conquistas sem deixar nada escapar.
   *
   * O projetor já tem contrato de nunca lançar, mas quem chama não pode
   * depender disso: este disparo sai de dentro do tique e do `finally` que
   * solta um Run, e ali uma exceção viraria uma rejeição sem dono — que foi
   * exatamente o que aconteceu quando um projetor quebrado entrou em teste.
   * Uma Conquista é cosmética; a fila não é.
   */
  const projetar = (): void => {
    try {
      options.achievements?.trigger();
    } catch (error) {
      logger?.error({ err: error }, "projetor de Conquistas falhou ao ser disparado; o laço segue");
    }
  };

  const cancelar = (runId: string, reason: string): void => {
    if (cancelados.has(runId)) return;
    cancelados.add(runId);
    cancelReasons.set(runId, reason);

    logger?.info({ runId, reason }, "cancelando run em voo");

    sinais.get(runId)?.abort();

    // `runtime.cancel` espera a árvore de processos ser tratada. Esperar isso
    // dentro do tique seguraria o laço inteiro por um kill que no Windows
    // confirma por polling; o desfecho continua vindo pelo `RunCancelled`, que
    // é quem escreve `CANCELLED`.
    void runtime.cancel(runId).catch((error: unknown) => {
      logger?.error({ err: error, runId }, "falha ao cancelar a árvore de processos do run");
    });
  };

  /**
   * Fecha, aqui mesmo, o Run cancelado que nunca chegou a executar.
   *
   * Nada subiu: não há evento terminal vindo do runtime, e sem esta escrita o
   * Run ficaria em `PREPARING` até a reconciliação da próxima partida.
   * Devolve se o desfecho foi mesmo gravado.
   */
  const descartarCancelado = async (claimed: ClaimedRun): Promise<boolean> => {
    const runId = claimed.run.id;
    const motivo = cancelReasons.get(runId) ?? "user_request";
    const desligando = motivo === "worker_shutdown";

    const writer = createRunOutcomeWriter({
      db,
      userId,
      run: claimed.run,
      logger,
      startedAt: Date.now(),
    });

    await writer.diagnostic(
      "INFO",
      desligando
        ? "O Worker foi desligado enquanto este Run esperava na fila de capacidade; " +
            "nenhum processo de agente chegou a subir."
        : "O Run foi cancelado enquanto esperava na fila de capacidade; nenhum processo de " +
            "agente chegou a subir.",
    );

    await writer.writeTerminal({
      status: "CANCELLED",
      error: {
        code: desligando ? "WORKER_SHUTDOWN" : "CANCELLED",
        message: desligando
          ? "O Worker foi desligado antes de este Run começar a executar."
          : "O Run foi cancelado antes de começar a executar.",
        reason: motivo,
        // Trabalho interrompido pelo operador é retentável; desistência do
        // usuário não é. É a mesma regra do desfecho vindo do runtime.
        retryable: desligando,
        processTreeTerminated: true,
      },
      events: [
        toRunEventInput(workerRunCancelled({ harness: claimed.run.harnessKey, reason: motivo })),
      ],
    });

    return writer.terminalWritten;
  };

  /**
   * Fecha os Runs cancelados que ainda esperam na fila da `CapacityLock`.
   *
   * post-mortem #4 (08/09/2026): o `AbortController` nascia dentro de
   * `executar`, que a `CapacityLock` adia. Um Run já reclamado mas ainda
   * enfileirado não tinha sinal: `cancelar` gravava em `cancelados` de forma
   * definitiva, o `abort()` era no-op, o `runtime.cancel` voltava na hora
   * porque não havia execução, e `checarCancelamentos` nunca mais o revisitava.
   * Quando a trava liberava, o Run cancelado subia o agente, rodava até o fim e
   * era gravado `SUCCEEDED` — e no desligamento a `drain()` fazia a mesma coisa,
   * iniciando Runs em vez de encerrá-los. Agora o sinal nasce no `pump` e o
   * desfecho é escrito aqui, sem esperar a trava.
   *
   * A marca entra em `descartados` **antes** do `await`: é ela que impede o
   * handler enfileirado de fechar o mesmo Run duas vezes se a trava liberar no
   * meio desta escrita.
   */
  const descartarNaFila = async (): Promise<void> => {
    for (const [runId, claimed] of [...emVoo]) {
      if (!cancelados.has(runId) || emExecucao.has(runId) || descartados.has(runId)) continue;
      descartados.add(runId);

      const fechado = await descartarCancelado(claimed);
      if (!fechado) {
        logger?.error(
          { runId },
          "não consegui fechar o run cancelado que esperava na fila; ficará para a " +
            "reconciliação da próxima partida",
        );
      }
      emVoo.delete(runId);
    }
  };

  /** Observa `cancel_requested_at` dos Runs deste Worker. */
  const checarCancelamentos = async (): Promise<void> => {
    const ids = [...emVoo.keys()].filter((id) => !cancelados.has(id));
    if (ids.length > 0) {
      const pedidos = await listCancelRequestedRunIds(db, { userId, runIds: ids });
      for (const runId of pedidos) cancelar(runId, "user_request");
    }

    await descartarNaFila();
  };

  /**
   * Fecha os Runs parados em gate com cancelamento pedido.
   *
   * Em `WAITING_APPROVAL` ninguém está executando: o Run soltou o Worker ao
   * abrir o gate, e o pedido de cancelamento só marcou a coluna. Quem o leva a
   * `CANCELLED` — passo do gate cancelado, `RunCancelled` no diário, Task de
   * volta a `READY` — é este laço, na próxima passada.
   */
  const cancelarEmEspera = async (): Promise<void> => {
    const ids = await listRunsWaitingApprovalWithCancelRequested(db, { userId });
    for (const runId of ids) {
      try {
        const fechado = await cancelRunWaitingApproval(db, {
          userId,
          runId,
          reason: "user_request",
          ...(logger === undefined ? {} : { logger }),
        });
        if (fechado === null || !fechado.ok) {
          logger?.warn(
            { runId, failure: fechado === null ? "RUN_NOT_FOUND" : fechado.failure },
            "não consegui cancelar o run em espera de aprovação",
          );
          continue;
        }
        logger?.info({ runId }, "run em espera de aprovação cancelado");
      } catch (error) {
        // Escrita terminal que falhou: sem compensação pelo mesmo canal; a
        // próxima passada tenta de novo, porque a marca continua lá.
        logger?.error({ err: error, runId }, "falha ao cancelar o run em espera de aprovação");
      }
    }
  };

  const executar = async (claimed: ClaimedRun, controller: AbortController): Promise<void> => {
    const runId = claimed.run.id;
    try {
      // O trabalho pode ter esperado horas na fila da `CapacityLock`. Se o
      // cancelamento chegou nesse meio-tempo, nada sobe: ou o desfecho já foi
      // escrito pelo caminho ansioso, ou é escrito aqui.
      if (descartados.has(runId)) return;
      if (controller.signal.aborted || cancelados.has(runId)) {
        descartados.add(runId);
        if (!(await descartarCancelado(claimed))) {
          logger?.error(
            { runId },
            "não consegui fechar o run cancelado que saiu da fila; ficará para a " +
              "reconciliação da próxima partida",
          );
        }
        return;
      }

      emExecucao.add(runId);
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
          signal: controller.signal,
          measureCapabilities,
          ...(options.databaseUrl === undefined ? {} : { databaseUrl: options.databaseUrl }),
          ...(logger === undefined ? {} : { logger }),
        },
        claimed,
      );
    } finally {
      emVoo.delete(runId);
      cancelados.delete(runId);
      cancelReasons.delete(runId);
      sinais.delete(runId);
      emExecucao.delete(runId);
      descartados.delete(runId);
      // O desfecho acabou de ser gravado: projetar agora é o que faz o toast
      // chegar junto do fim da Expedição, e não no tique seguinte.
      projetar();
    }
  };

  const umaPassada = async (): Promise<void> => {
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

      // post-mortem #4 (08/09/2026): o sinal nasce aqui, junto do `emVoo.set` e
      // **antes** do `acquireLock`, e não mais dentro do handler que a trava
      // adia. Entre reclamar e começar a executar pode passar uma execução
      // inteira, e nesse intervalo o Run precisa ter como ser cancelado.
      const controller = new AbortController();
      sinais.set(claimed.run.id, controller);
      emVoo.set(claimed.run.id, claimed);

      // post-mortem #5 (08/09/2026): o `stopping` é lido de novo **depois** do
      // claim. A leitura do topo do laço vale para antes do `await`, e o
      // desligamento pode ter começado enquanto a transação estava em voo — era
      // por aí que um `NOTIFY` durante o `stop` fazia o Worker subir worktree e
      // processo de agente no meio do desligamento. O Run já saiu de `QUEUED` e
      // não volta: ele é fechado como cancelado, sem executar.
      if (stopping) {
        cancelar(claimed.run.id, "worker_shutdown");
        break;
      }

      const { status } = capacity.acquireLock(chave, () => executar(claimed, controller));
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
    await cancelarEmEspera();

    // Uma linha por tique: o projetor tem contrato de nunca lançar e volta na
    // hora, então nada aqui espera por ele. É a rede para todo fato que não
    // nasce de um Run terminando neste processo — um Project criado pela API,
    // um Run cancelado ainda na fila — e para o atraso de segurança do cursor,
    // que segura por um segundo o que acabou de ser commitado.
    projetar();
  };

  /**
   * Uma passada de claim, serializada.
   *
   * `pump` era reentrante: o `PgNotifyListener` dispara `void drainNow()` sem
   * serializar, e a leitura de `emVoo.size` e o `emVoo.set` estão separados
   * pelo `await` do claim. Com o teto em 1, o tique e um `NOTIFY` viam os dois
   * `0 < 1`, reclamavam linhas diferentes
   * (`FOR UPDATE SKIP LOCKED` garante que sejam diferentes) e o Worker ficava
   * com dois Runs em voo — o segundo em `PREPARING` no banco e parado na
   * memória, exatamente o "Preparando sem nada acontecendo" que o cabeçalho
   * deste arquivo proíbe, e sem volta para `QUEUED`. É a mesma guarda que o
   * Distiller já tinha (`apps/worker/src/distiller.ts`), com o bit de "chegou
   * pedido novo" para que um `NOTIFY` durante a passada não se perca.
   */
  const pump = async (): Promise<void> => {
    if (stopping) return;

    if (bombeando !== undefined) {
      bombearDeNovo = true;
      await bombeando;
      return;
    }

    bombeando = (async () => {
      try {
        do {
          bombearDeNovo = false;
          await umaPassada();
        } while (bombearDeNovo && !stopping);
      } finally {
        bombeando = undefined;
      }
    })();

    await bombeando;
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

      // A capability de servidores MCP por adapter, nos dois modos: é o que
      // diz, antes de qualquer Run, em quais harnesses o Grimório chega como
      // ferramenta e em quais ele vira só um aviso no diário.
      logger?.info(
        {
          knowledgeMcp: options.databaseUrl === undefined ? "desligado" : "ligado",
          harnesses: options.adapters.map((adapter) => ({
            adapter: adapter.id,
            mode: adapter.executionMode ?? "HOST",
            mcpServers: adapter.capabilities.mcpServers,
          })),
        },
        "servidores MCP por harness",
      );
      if (options.databaseUrl === undefined) {
        logger?.warn(
          "o Worker não recebeu a URL do banco; o servidor MCP do Grimório não será oferecido",
        );
      }

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
            // O `PgNotifyListener` dispara `void drainNow()`: uma rejeição que
            // saísse daqui viraria `unhandledRejection`, e o processo trata
            // isso como fatal.
            drainNow: async () => {
              try {
                await pump();
              } catch (error) {
                logger?.error({ err: error }, "erro no pump disparado pelo NOTIFY da fila");
              }
            },
          },
          channel: RUN_QUEUE_CHANNEL,
          ...(logger === undefined ? {} : { logger }),
        });

        cancelListener = new PgNotifyListener({
          notifier,
          drainable: {
            drainNow: async () => {
              try {
                await checarCancelamentos();
                await cancelarEmEspera();
              } catch (error) {
                logger?.error({ err: error }, "erro ao observar cancelamentos pelo NOTIFY");
              }
            },
          },
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

      // post-mortem #5 (08/09/2026): o desligamento **iniciava** Runs em vez de
      // encerrá-los. Um `pump` disparado pelo `NOTIFY` (`void drainNow()`, que
      // ninguém esperava) podia estar dentro do `await` do claim quando o laço
      // de `cancelar` percorria `emVoo`: o Run entrava depois, escapava do
      // cancelamento e começava a executar durante o desligamento. Esperar o
      // `pump` em voo é o que garante que `emVoo` esteja completo aqui.
      try {
        await bombeando;
      } catch (error) {
        logger?.error({ err: error }, "o pump em voo falhou durante o desligamento");
      }

      // O passe em andamento termina antes de o pool fechar; se ele não
      // terminar, o cursor não avança e o passe seguinte refaz o mesmo lote.
      try {
        await options.achievements?.drain();
      } catch (error) {
        logger?.error({ err: error }, "projetor de Conquistas falhou no desligamento");
      }

      // Cancelar antes de esperar: o `drain` só termina quando os Runs em voo
      // acabarem, e um agente de quarenta minutos não acaba sozinho porque o
      // Worker pediu licença.
      for (const runId of emVoo.keys()) cancelar(runId, "worker_shutdown");

      // E fechar aqui o que ainda não começou: a `capacity.drain()` espera a
      // fila **e a desenfileira**, então sem esta passagem o desligamento
      // subiria worktree e processo de agente para os Runs que só esperavam.
      try {
        await descartarNaFila();
      } catch (error) {
        logger?.error({ err: error }, "falha ao fechar os runs cancelados que esperavam na fila");
      }

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
