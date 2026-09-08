import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type DistillationTrigger,
  KNOWLEDGE_CANDIDATE_CHANNEL,
  KNOWLEDGE_DISTILL_CHANNEL,
  type UserSettings,
} from "@dungeon-master/contracts";
import {
  buildLoadoutSnapshot,
  createDatabaseKnowledgeStore,
  createPgNotifier,
  type Database,
  findAgentRow,
  findHarnessRow,
  findKnowledgeScribeLoadout,
  listProjectsWithPendingCandidates,
  newId,
  readUserSettings,
  reconcileStaleDistillationRuns,
} from "@dungeon-master/database";
import { PgNotifyListener } from "@dungeon-master/events";
import {
  DistillerScheduler,
  distillProject,
  type DistillProjectOutcome,
  type KnowledgeAgentRequest,
  type KnowledgeAgentResult,
  type KnowledgeAgentRuntime,
  type KnowledgeStore,
} from "@dungeon-master/knowledge";
import {
  type AgentRuntime,
  collectExecutionResult,
  type ExecutionRequest,
} from "@dungeon-master/runtime";
import type { Pool } from "pg";

import { buildPrompt } from "./execute-run.js";
import { startIdleLoop, type IdleLoop } from "./idle-loop.js";
import type { Logger } from "./logger.js";

/**
 * O Distiller dentro do Worker (planejamento v0.4, Fase 6).
 *
 * O que decide o destino de cada candidato mora em `@dungeon-master/knowledge`;
 * o que grava mora em `@dungeon-master/database`. O que mora aqui é a fiação
 * e o **quando**:
 *
 * - **Um laço próprio**, separado do laço de Runs: um lote do Escriba pode
 *   levar minutos numa CLI, e o claim da fila não pode esperar por ele. Os
 *   dois laços partilham só o pool e o `LISTEN`.
 * - **Três gatilhos**: o timer de `knowledge.distillEveryMinutes`, a
 *   ociosidade depois do último candidato, e o `NOTIFY` do trigger de
 *   `knowledge_candidate` — mais o canal de pedido explícito, que a API e a
 *   CLI usam. Um pedido perdido custa esperar o timer; nunca um candidato.
 * - **O Escriba entra pelo `AgentRuntime`**, com o Loadout de
 *   `knowledge.loadoutId` ou o semeado: mesma CLI, mesmo Harness, mesma
 *   política de permissão — só que sem comando liberado, num diretório
 *   temporário vazio, com resultado estruturado por JSON Schema e timeouts
 *   curtos. Sem chave de API à parte.
 * - **Nunca síncrono ao Run.** O desfecho de um Run grava os candidatos e
 *   segue; o lote acontece aqui, depois, sob o advisory lock do Project.
 */

export interface DistillerConfig {
  /** Espera depois do último candidato antes do lote. */
  readonly idleMs: number;
  /** Tique do laço. */
  readonly tickIntervalMs: number;
  /** Varredura de segurança por candidatos pendentes, para um NOTIFY perdido. */
  readonly sweepIntervalMs: number;
  /** Silêncio máximo do Escriba antes de `RunTimedOut`. */
  readonly llmIdleTimeoutMs: number;
  /** Teto absoluto de uma chamada ao Escriba. */
  readonly llmCompletionTimeoutMs: number;
  /** Candidatos por lote. */
  readonly batchSize: number;
}

export const DEFAULT_DISTILLER_CONFIG: DistillerConfig = {
  idleMs: 60_000,
  tickIntervalMs: 1_000,
  sweepIntervalMs: 30_000,
  llmIdleTimeoutMs: 180_000,
  llmCompletionTimeoutMs: 600_000,
  batchSize: 20,
};

export interface CreateKnowledgeDistillerOptions {
  readonly db: Database;
  readonly userId: string;
  readonly config?: Partial<DistillerConfig>;
  readonly logger?: Logger;
  /** Pool para o `LISTEN`. Sem ele o Distiller funciona só pelo tique e pela varredura. */
  readonly pool?: Pool;
  /**
   * O runtime que executa o Escriba. Em produção é o `AgentRuntime` do
   * Worker, traduzido por `createScribeRuntime`; em teste, um roteirizado.
   */
  readonly runtime: KnowledgeAgentRuntime;
  /** Injetável para teste; o padrão é o store de banco. */
  readonly store?: KnowledgeStore;
  readonly now?: () => number;
}

export interface DistillOnceInput {
  readonly projectId: string;
  readonly trigger: DistillationTrigger;
  readonly regenerateSummary?: boolean;
}

export interface KnowledgeDistiller {
  /** Reconcilia lotes órfãos, agenda os pendentes e liga o `LISTEN`. Não liga o laço. */
  boot(): Promise<{ reconciled: string[]; pendingProjects: number }>;
  start(): void;
  /** Um lote agora, fora da agenda. Para a CLI e para teste. */
  distillOnce(input: DistillOnceInput): Promise<DistillProjectOutcome>;
  /** Uma passada do laço, para teste. */
  tick(): Promise<void>;
  /** Espera o lote em andamento e desliga. Idempotente. */
  stop(): Promise<void>;
}

/** Quanto tempo as configurações lidas valem antes de o tique relê-las. */
const SETTINGS_TTL_MS = 10_000;

export function createKnowledgeDistiller(
  options: CreateKnowledgeDistillerOptions,
): KnowledgeDistiller {
  const { db, userId, logger } = options;
  const config: DistillerConfig = { ...DEFAULT_DISTILLER_CONFIG, ...options.config };
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? createDatabaseKnowledgeStore({ db, userId, logger });

  const scheduler = new DistillerScheduler({ idleMs: config.idleMs, everyMs: 10 * 60_000 });

  let loop: IdleLoop | undefined;
  let stopping = false;
  let candidateListener: PgNotifyListener | undefined;
  let requestListener: PgNotifyListener | undefined;
  let emAndamento: Promise<void> | undefined;
  let settingsCache: { at: number; value: UserSettings } | undefined;
  let lastSweepAt = 0;

  const settings = async (): Promise<UserSettings> => {
    const at = now();
    if (settingsCache !== undefined && at - settingsCache.at < SETTINGS_TTL_MS) {
      return settingsCache.value;
    }
    const value = await readUserSettings(db, { userId });
    settingsCache = { at, value };
    scheduler.setEveryMs(value["knowledge.distillEveryMinutes"] * 60_000, at);
    return value;
  };

  /** Os Projects com candidatos pendentes entram na agenda (ou avançam para agora). */
  const varrer = async (mode: "notify" | "request"): Promise<number> => {
    const pendentes = await listProjectsWithPendingCandidates(db, { userId });
    const at = now();
    for (const pendente of pendentes) {
      if (mode === "request") scheduler.requestNow(pendente.projectId, at);
      else scheduler.notifyCandidate(pendente.projectId, at);
    }
    lastSweepAt = at;
    return pendentes.length;
  };

  const lote = async (input: DistillOnceInput): Promise<DistillProjectOutcome> => {
    const atual = await settings();
    const loadout = await findKnowledgeScribeLoadout(db, {
      userId,
      loadoutId: atual["knowledge.loadoutId"],
    });

    const outcome = await distillProject(
      { store, runtime: options.runtime, ...(logger === undefined ? {} : { logger }) },
      {
        projectId: input.projectId,
        trigger: input.trigger,
        settings: {
          humanReview: atual["knowledge.humanReview"],
          forgeEveryNRuns: atual["achievements.forgeEveryNRuns"],
        },
        loadoutId: loadout?.id ?? null,
        batchSize: config.batchSize,
        ...(input.regenerateSummary === undefined
          ? {}
          : { regenerateSummary: input.regenerateSummary }),
      },
    );

    if (outcome.kind === "finished") {
      logger?.[outcome.status === "SUCCEEDED" ? "info" : "warn"](
        {
          projectId: input.projectId,
          distillationRunId: outcome.distillationRunId,
          trigger: input.trigger,
          status: outcome.status,
          candidates: outcome.candidateCount,
          promoted: outcome.promoted,
          rejected: outcome.rejected,
          merged: outcome.merged,
          summaryRegenerated: outcome.summaryRegenerated,
          forged: outcome.forgedAchievementId,
          error: outcome.error,
        },
        outcome.status === "SUCCEEDED" ? "lote do Distiller concluído" : "lote do Distiller falhou",
      );
    } else if (outcome.kind === "locked") {
      logger?.info({ projectId: input.projectId }, "Project já em lote; este pedido foi pulado");
    }

    return outcome;
  };

  /** Os Projects vencidos, um lote por vez. Nunca lança: o tique seguinte continua. */
  const passada = async (): Promise<void> => {
    if (stopping) return;
    const at = now();

    if (at - lastSweepAt >= config.sweepIntervalMs) {
      await varrer("notify");
    }
    await settings();

    for (const due of scheduler.due(now())) {
      if (stopping) return;
      scheduler.markStarted(due.projectId);
      let pendingLeft = false;
      try {
        const outcome = await lote({ projectId: due.projectId, trigger: due.trigger });
        pendingLeft = outcome.kind === "finished" && outcome.pendingLeft;
      } catch (error) {
        logger?.error({ err: error, projectId: due.projectId }, "o lote do Distiller lançou");
      } finally {
        scheduler.markFinished(due.projectId, { pendingLeft }, now());
      }
    }
  };

  const tick = async (): Promise<void> => {
    if (emAndamento !== undefined) return;
    emAndamento = passada().finally(() => {
      emAndamento = undefined;
    });
    await emAndamento;
  };

  return {
    boot: async () => {
      const { reconciled } = await reconcileStaleDistillationRuns(db, { userId });
      if (reconciled.length > 0) {
        logger?.warn(
          { runs: reconciled },
          "lotes do Distiller órfãos de uma partida anterior fechados como FAILED",
        );
      }

      await settings();
      const pendingProjects = await varrer("notify");

      if (options.pool !== undefined) {
        const notifier = createPgNotifier(options.pool);
        candidateListener = new PgNotifyListener({
          notifier,
          drainable: {
            drainNow: async () => {
              await varrer("notify");
            },
          },
          channel: KNOWLEDGE_CANDIDATE_CHANNEL,
          ...(logger === undefined ? {} : { logger }),
        });
        requestListener = new PgNotifyListener({
          notifier,
          drainable: {
            drainNow: async () => {
              await varrer("request");
              await tick();
            },
          },
          channel: KNOWLEDGE_DISTILL_CHANNEL,
          ...(logger === undefined ? {} : { logger }),
        });
        // Não é fatal: sem o `LISTEN` o Distiller continua pelo tique e pela varredura.
        await candidateListener.start();
        await requestListener.start();
      }

      return { reconciled, pendingProjects };
    },

    start: () => {
      if (loop !== undefined) return;
      loop = startIdleLoop({
        intervalMs: config.tickIntervalMs,
        onTick: tick,
        onError: (error, tickNumber) => {
          logger?.error(
            { err: error, tick: tickNumber },
            "erro no tique do Distiller; o laço continua",
          );
        },
      });
    },

    distillOnce: (input) => lote(input),

    tick,

    stop: async () => {
      if (stopping) return;
      stopping = true;
      candidateListener?.stop();
      requestListener?.stop();
      await loop?.stop();
      await emAndamento;
    },
  };
}

// --------------------------------------------------------------------------
// O Escriba sobre o AgentRuntime
// --------------------------------------------------------------------------

export interface ScribeRuntimeOptions {
  readonly db: Database;
  readonly userId: string;
  readonly runtime: AgentRuntime;
  readonly logger?: Logger;
  readonly timeouts?: { readonly idleMs: number; readonly completionMs: number };
  /** Onde os diretórios temporários nascem. Padrão: o temp do sistema. */
  readonly tmpRoot?: string;
}

/**
 * Traduz um pedido do Distiller num `ExecutionRequest` e devolve o JSON.
 *
 * O Loadout é lido a cada chamada, e não uma vez: `knowledge.loadoutId` pode
 * mudar em Settings entre dois lotes, e o Escriba precisa seguir a escolha.
 * O workspace é um diretório temporário vazio com estratégia `CURRENT` —
 * nada a ler, nada a commitar —, apagado no fim; a política é `CONFIGURED`
 * sem escrita e sem comando, o que em qualquer harness com permissão nativa
 * vira "nenhuma ferramenta liberada". **Nunca lança**: toda falha volta em
 * `ok: false`, e é o Distiller quem a registra no lote.
 */
export function createScribeRuntime(options: ScribeRuntimeOptions): KnowledgeAgentRuntime {
  const { db, userId, runtime, logger } = options;
  const timeouts = options.timeouts ?? {
    idleMs: DEFAULT_DISTILLER_CONFIG.llmIdleTimeoutMs,
    completionMs: DEFAULT_DISTILLER_CONFIG.llmCompletionTimeoutMs,
  };

  return {
    async execute<T>(request: KnowledgeAgentRequest<T>): Promise<KnowledgeAgentResult<T>> {
      const falha = (error: string): KnowledgeAgentResult<T> => ({
        ok: false,
        error,
        provenance: { harnessSessionId: null, usage: null },
      });

      let workspace: string | undefined;
      try {
        const settings = await readUserSettings(db, { userId });
        const loadout = await findKnowledgeScribeLoadout(db, {
          userId,
          loadoutId: settings["knowledge.loadoutId"],
        });
        if (loadout === null) {
          return falha(
            "Nenhum Loadout para o Escriba: rode `pnpm db:seed` ou escolha um em knowledge.loadoutId.",
          );
        }
        const agent = await findAgentRow(db, { userId, agentId: loadout.agentId });
        const harness = await findHarnessRow(db, { userId, harnessId: loadout.harnessId });
        if (agent === null || harness === null) {
          return falha(
            `O Loadout ${loadout.id} do Escriba aponta para um Agent ou Harness que não existe.`,
          );
        }
        if (!harness.enabled) {
          return falha(`O Harness ${harness.key} do Escriba está desligado.`);
        }
        if (!harness.capabilities.structuredOutput) {
          return falha(`O Harness ${harness.key} do Escriba não produz resultado estruturado.`);
        }

        const snapshot = await buildLoadoutSnapshot(db, { loadout, agent, harness });
        workspace = await mkdtemp(join(options.tmpRoot ?? tmpdir(), "dm-escriba-"));

        const execution: ExecutionRequest<T> = {
          runId: `escriba-${request.purpose}-${newId()}`,
          taskId: `escriba-${request.purpose}`,
          workspace: { repoPath: workspace, checkoutPath: workspace },
          harness: { key: harness.key, id: harness.id },
          ...(snapshot.model === null
            ? {}
            : { model: { id: snapshot.model.key, name: snapshot.model.name } }),
          loadout: {
            id: loadout.id,
            name: loadout.name,
            harness: { key: harness.key, id: harness.id },
            ...(snapshot.model === null
              ? {}
              : { model: { id: snapshot.model.key, name: snapshot.model.name } }),
            systemPromptAppend: agent.instructions,
          },
          executionProfile: {
            id: loadout.executionProfileId,
            name: "Escriba do Grimório",
            mode: "HOST",
            workspaceStrategy: "CURRENT",
            permissionPolicy: {
              mode: "CONFIGURED",
              grant: {
                workspaceWrite: false,
                commandExecution: "NONE",
                allowedCommands: [],
                deniedCommands: [],
              },
            },
            environmentPolicy: { allowList: [], inheritEssential: true },
          },
          prompt: buildPrompt(agent.instructions, request.prompt),
          outputSchema: { schema: request.schema, jsonSchema: request.jsonSchema, maxRetries: 1 },
          timeouts,
        };

        const result = await collectExecutionResult<T>(runtime.execute(execution), {
          harness: execution.harness,
        });

        const provenance = {
          harnessSessionId: result.harnessSessionId ?? null,
          usage: result.usage ?? null,
        };

        if (result.status !== "SUCCEEDED" || result.output === undefined) {
          const motivo =
            result.error?.message ??
            (result.status === "SUCCEEDED"
              ? "o harness terminou sem o bloco de resultado"
              : `o harness terminou em ${result.status}`);
          logger?.warn(
            {
              purpose: request.purpose,
              status: result.status,
              harness: harness.key,
              error: motivo,
            },
            "o Escriba não devolveu o resultado",
          );
          return { ok: false, error: motivo, provenance };
        }

        return { ok: true, output: result.output, provenance };
      } catch (error) {
        return falha(error instanceof Error ? error.message : String(error));
      } finally {
        if (workspace !== undefined) {
          await rm(workspace, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          }).catch(() => undefined);
        }
      }
    },
  };
}
