import type { DistillationTrigger, UsageSummary } from "@dungeon-master/contracts";
import { z } from "zod";

import { applyRuleFilter, recallPools, resolveDecisions } from "./dedup.js";
import {
  buildForgePrompt,
  detectNotableResult,
  ForgeOutputSchema,
  isForgeAllowed,
  toForgedAchievementInput,
} from "./forge.js";
import { filterHarnessNoise, tailOf } from "./l0-noise-filter.js";
import type { KnowledgeLogger } from "./logger.js";
import type {
  KnowledgeAgentRuntime,
  KnowledgeClock,
  KnowledgeStore,
  LockedProjectStore,
} from "./ports.js";
import { systemKnowledgeClock } from "./ports.js";
import { buildDistillPrompt, DistillOutputSchema } from "./prompts/extract-candidates.js";
import {
  buildProjectSummaryPrompt,
  ProjectSummaryOutputSchema,
  SUMMARY_CONTENT_MAX_LENGTH,
  SUMMARY_TITLE_MAX_LENGTH,
} from "./prompts/project-summary.js";
import { sanitizeLlmText } from "./sanitize.js";
import { shouldRegenerateSummary } from "./summary-trigger.js";
import type { DistillSettings, LlmProvenance, RunTranscript } from "./types.js";

/**
 * O Distiller: um lote por Project, dentro do advisory lock, com **uma**
 * chamada ao modelo para os candidatos e, quando o gatilho manda, uma para
 * o resumo e uma para a forja.
 *
 * ## Por que uma chamada para classificar e julgar duplicata
 *
 * O TencentDB faz duas (extração, depois conflito) porque a entrada dele é
 * uma conversa crua. Aqui os candidatos já são átomos escritos pelo agente
 * do Run — título, conteúdo, `kind` —, então "extrair" é normalizar e
 * classificar, e o julgamento de duplicata precisa exatamente do mesmo
 * texto. Uma chamada por lote atravessa uma CLI de harness uma vez em vez
 * de duas (cada uma é um processo, com preflight e dezenas de segundos), e
 * dá ao modelo o pool inteiro para julgar duplicata entre candidatos do
 * mesmo lote.
 *
 * ## O contrato de falha
 *
 * - O modelo falha, o parse falha, o banco falha **antes** das decisões
 *   gravadas: a transação do lock desfaz tudo, os candidatos ficam
 *   `PENDING`, e o `DistillationRun` termina `FAILED` com o erro.
 * - O resumo ou a forja falham **depois** das decisões gravadas: as
 *   decisões ficam (a transação commita), e o lote termina `FAILED` com o
 *   erro dizendo qual etapa foi. O gatilho do resumo dispara de novo no
 *   lote seguinte.
 * - Nada aqui lança para quem chama por causa do modelo; só uma porta que
 *   quebrou antes de o lote existir propaga, e aí o Worker loga.
 */

export const DEFAULT_DISTILL_BATCH_SIZE = 20;
export const DEFAULT_TRANSCRIPT_MAX_LENGTH = 1_500;
export const DEFAULT_SUMMARY_ITEM_LIMIT = 200;

export interface DistillerPorts {
  readonly store: KnowledgeStore;
  readonly runtime: KnowledgeAgentRuntime;
  readonly clock?: KnowledgeClock;
  readonly logger?: KnowledgeLogger;
}

export interface DistillProjectInput {
  readonly projectId: string;
  readonly trigger: DistillationTrigger;
  readonly settings: DistillSettings;
  /** O Loadout do Escriba, para a proveniência do lote. Nulo quando não há um. */
  readonly loadoutId: string | null;
  /** Candidatos por lote. Padrão: 20. */
  readonly batchSize?: number;
  /** O usuário pediu a regeneração do resumo neste lote. */
  readonly regenerateSummary?: boolean;
  /** Teto do trecho de L0 por Run no prompt. Padrão: 1500 caracteres. */
  readonly transcriptMaxLength?: number;
}

export type DistillProjectOutcome =
  | { readonly kind: "locked" }
  | { readonly kind: "empty" }
  | {
      readonly kind: "finished";
      readonly distillationRunId: string;
      readonly status: "SUCCEEDED" | "FAILED";
      readonly error: string | null;
      readonly candidateCount: number;
      readonly promoted: number;
      readonly rejected: number;
      readonly merged: number;
      readonly summaryRegenerated: boolean;
      readonly forgedAchievementId: string | null;
      /** O lote bateu no teto e deixou candidatos `PENDING`. */
      readonly pendingLeft: boolean;
    };

/** O que um lote acumula enquanto roda, para o `DistillationRun` no fim. */
interface BatchTally {
  candidateCount: number;
  promoted: number;
  rejected: number;
  merged: number;
  summaryRegenerated: boolean;
  forgedAchievementId: string | null;
  harnessSessionId: string | null;
  usage: UsageSummary | null;
  /** Erros das etapas opcionais, que não desfazem as decisões. */
  stepErrors: string[];
}

class DistillerFailure extends Error {
  constructor(
    message: string,
    readonly provenance: LlmProvenance | null,
  ) {
    super(message);
    this.name = "DistillerFailure";
  }
}

function somarUsage(a: UsageSummary | null, b: UsageSummary | null): UsageSummary | null {
  if (a === null) return b;
  if (b === null) return a;
  const soma: UsageSummary = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
  const custo = (a.costUsd ?? 0) + (b.costUsd ?? 0);
  return a.costUsd === undefined && b.costUsd === undefined ? soma : { ...soma, costUsd: custo };
}

function descreverErro(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeLlmText(message, { maxLength: 2_000 });
}

export async function distillProject(
  ports: DistillerPorts,
  input: DistillProjectInput,
): Promise<DistillProjectOutcome> {
  const { store, runtime, logger } = ports;
  const clock = ports.clock ?? systemKnowledgeClock;
  const batchSize = Math.max(1, input.batchSize ?? DEFAULT_DISTILL_BATCH_SIZE);
  const transcriptMax = input.transcriptMaxLength ?? DEFAULT_TRANSCRIPT_MAX_LENGTH;

  let distillationRunId: string | null = null;
  const tally: BatchTally = {
    candidateCount: 0,
    promoted: 0,
    rejected: 0,
    merged: 0,
    summaryRegenerated: false,
    forgedAchievementId: null,
    harnessSessionId: null,
    usage: null,
    stepErrors: [],
  };

  const anotarProvenance = (provenance: LlmProvenance | null): void => {
    if (provenance === null) return;
    if (provenance.harnessSessionId !== null) tally.harnessSessionId = provenance.harnessSessionId;
    tally.usage = somarUsage(tally.usage, provenance.usage);
  };

  let outcome: { acquired: false } | { acquired: true; value: "empty" | { pendingLeft: boolean } };

  try {
    outcome = await store.withProjectLock(input.projectId, async (locked) => {
      const lidos = await locked.listPendingCandidates(batchSize + 1);
      if (lidos.length === 0) return "empty" as const;
      const pendingLeft = lidos.length > batchSize;
      const candidates = lidos.slice(0, batchSize);
      tally.candidateCount = candidates.length;

      // O lote existe a partir daqui, fora da transação: uma falha adiante
      // precisa de um lugar para ficar registrada.
      const run = await store.createDistillationRun({
        projectId: input.projectId,
        trigger: input.trigger,
        loadoutId: input.loadoutId,
      });
      distillationRunId = run.id;

      const project = await locked.loadProject();
      if (project === null) {
        throw new DistillerFailure(`O Project ${input.projectId} não existe mais.`, null);
      }

      // ------------------------------------------------------- candidatos
      const { kept, ruled } = applyRuleFilter(candidates);
      let decided = [...ruled];

      if (kept.length > 0) {
        const transcripts = await carregarTranscritos(
          locked,
          kept.map((c) => c.runId),
          transcriptMax,
        );
        const pools = await recallPools(kept, (text, limit) =>
          locked.recallSimilarItems(text, limit),
        );
        const prompt = buildDistillPrompt({ project, pools, transcripts });

        logger?.debug?.(
          { projectId: input.projectId, distillationRunId, candidates: kept.length },
          "distiller_llm_call",
        );

        const result = await runtime.execute({
          purpose: "distill",
          prompt: prompt.prompt,
          schema: DistillOutputSchema,
          jsonSchema: z.toJSONSchema(DistillOutputSchema),
        });
        anotarProvenance(result.provenance);

        if (!result.ok) {
          throw new DistillerFailure(`modelo (destilação): ${result.error}`, result.provenance);
        }

        decided = [
          ...ruled,
          ...resolveDecisions(result.output, pools, {
            itemIdByKey: prompt.itemIdByKey,
            candidateIdByKey: prompt.candidateIdByKey,
          }),
        ];
      }

      const applied = await locked.applyDecisions({
        distillationRunId: run.id,
        decisions: decided,
        humanReview: input.settings.humanReview,
        provenance: { harnessSessionId: tally.harnessSessionId, usage: tally.usage },
      });
      tally.promoted = applied.promoted;
      tally.rejected = applied.rejected;
      tally.merged = applied.merged;

      // ----------------------------------------------------------- resumo
      try {
        await regenerarResumo(locked, ports, input, run.id, tally, anotarProvenance, project);
      } catch (error) {
        tally.stepErrors.push(`resumo: ${descreverErro(error)}`);
        logger?.warn?.({ err: error, distillationRunId }, "distiller_summary_failed");
      }

      // ------------------------------------------------------------ forja
      try {
        await forjar(locked, ports, input, run.id, tally, anotarProvenance);
      } catch (error) {
        tally.stepErrors.push(`forja: ${descreverErro(error)}`);
        logger?.warn?.({ err: error, distillationRunId }, "distiller_forge_failed");
      }

      return { pendingLeft };
    });
  } catch (error) {
    if (distillationRunId === null) throw error;

    if (error instanceof DistillerFailure) anotarProvenance(error.provenance);
    const message = descreverErro(error);
    logger?.error?.(
      { err: error, projectId: input.projectId, distillationRunId },
      "distiller_failed",
    );

    await store.finishDistillationRun({
      id: distillationRunId,
      status: "FAILED",
      error: message,
      candidateCount: tally.candidateCount,
      promoted: 0,
      rejected: 0,
      merged: 0,
      summaryRegenerated: false,
      forgedAchievementId: null,
      harnessSessionId: tally.harnessSessionId,
      usage: tally.usage,
    });

    return {
      kind: "finished",
      distillationRunId,
      status: "FAILED",
      error: message,
      candidateCount: tally.candidateCount,
      promoted: 0,
      rejected: 0,
      merged: 0,
      summaryRegenerated: false,
      forgedAchievementId: null,
      pendingLeft: false,
    };
  }

  if (!outcome.acquired) return { kind: "locked" };
  if (outcome.value === "empty") return { kind: "empty" };

  if (distillationRunId === null) {
    // O callback devolveu um lote sem ter criado o registro: defeito de porta.
    throw new Error("O lote terminou sem DistillationRun.");
  }

  const status = tally.stepErrors.length === 0 ? "SUCCEEDED" : "FAILED";
  const error = tally.stepErrors.length === 0 ? null : tally.stepErrors.join(" | ");

  await store.finishDistillationRun({
    id: distillationRunId,
    status,
    error,
    candidateCount: tally.candidateCount,
    promoted: tally.promoted,
    rejected: tally.rejected,
    merged: tally.merged,
    summaryRegenerated: tally.summaryRegenerated,
    forgedAchievementId: tally.forgedAchievementId,
    harnessSessionId: tally.harnessSessionId,
    usage: tally.usage,
  });

  logger?.info?.(
    {
      projectId: input.projectId,
      distillationRunId,
      status,
      candidates: tally.candidateCount,
      promoted: tally.promoted,
      rejected: tally.rejected,
      merged: tally.merged,
      summaryRegenerated: tally.summaryRegenerated,
      forged: tally.forgedAchievementId,
      finishedAt: clock.now().toISOString(),
    },
    "distiller_batch_finished",
  );

  return {
    kind: "finished",
    distillationRunId,
    status,
    error,
    candidateCount: tally.candidateCount,
    promoted: tally.promoted,
    rejected: tally.rejected,
    merged: tally.merged,
    summaryRegenerated: tally.summaryRegenerated,
    forgedAchievementId: tally.forgedAchievementId,
    pendingLeft: outcome.value.pendingLeft,
  };
}

/** O L0 de cada Run, filtrado do ruído e cortado pela cauda. */
async function carregarTranscritos(
  locked: LockedProjectStore,
  runIds: readonly string[],
  maxLength: number,
): Promise<Map<string, RunTranscript>> {
  const unicos = [...new Set(runIds)];
  const transcripts = new Map<string, RunTranscript>();
  let lidos: RunTranscript[];
  try {
    lidos = await locked.loadRunTranscripts(unicos);
  } catch {
    // Contexto é ajuda, não requisito: sem ele o candidato ainda é julgado.
    return transcripts;
  }
  for (const transcript of lidos) {
    const limpo = tailOf(filterHarnessNoise(transcript.transcript), maxLength);
    const summary =
      transcript.summary === null ? null : filterHarnessNoise(transcript.summary).slice(0, 1_000);
    transcripts.set(transcript.runId, { ...transcript, transcript: limpo, summary });
  }
  return transcripts;
}

async function regenerarResumo(
  locked: LockedProjectStore,
  ports: DistillerPorts,
  input: DistillProjectInput,
  distillationRunId: string,
  tally: BatchTally,
  anotarProvenance: (provenance: LlmProvenance | null) => void,
  project: { id: string; title: string; description: string | null },
): Promise<void> {
  const facts = await locked.summaryFacts();
  const trigger = shouldRegenerateSummary(
    { ...facts, requested: facts.requested || input.regenerateSummary === true },
    input.settings.summaryEveryNItems === undefined
      ? {}
      : { everyNItems: input.settings.summaryEveryNItems },
  );
  if (!trigger.should) return;

  ports.logger?.info?.(
    { projectId: input.projectId, distillationRunId, reason: trigger.reason },
    "distiller_summary_triggered",
  );

  const items = await locked.listItemsForSummary(DEFAULT_SUMMARY_ITEM_LIMIT);
  if (items.length === 0) return;
  const currentSummary = await locked.currentSummary();
  const prompt = buildProjectSummaryPrompt({ project, currentSummary, items });

  const result = await ports.runtime.execute({
    purpose: "summary",
    prompt: prompt.prompt,
    schema: ProjectSummaryOutputSchema,
    jsonSchema: z.toJSONSchema(ProjectSummaryOutputSchema),
  });
  anotarProvenance(result.provenance);
  if (!result.ok) throw new Error(`modelo (resumo): ${result.error}`);

  const title = sanitizeLlmText(result.output.title, { maxLength: SUMMARY_TITLE_MAX_LENGTH });
  const content = sanitizeLlmText(result.output.content, { maxLength: SUMMARY_CONTENT_MAX_LENGTH });
  if (content.length === 0) throw new Error("o modelo devolveu um resumo vazio");

  const coveredItemIds = [
    ...new Set(
      result.output.coveredItems
        .map((key) => prompt.itemIdByKey.get(key.trim().toUpperCase()))
        .filter((id): id is string => id !== undefined),
    ),
  ];

  await locked.upsertSummary({
    distillationRunId,
    title: title.length === 0 ? `Resumo do projeto ${project.title}` : title,
    content,
    coveredItemIds: coveredItemIds.length === 0 ? items.map((item) => item.id) : coveredItemIds,
    provenance: {
      harnessSessionId: result.provenance.harnessSessionId,
      usage: result.provenance.usage,
    },
  });
  tally.summaryRegenerated = true;
}

async function forjar(
  locked: LockedProjectStore,
  ports: DistillerPorts,
  input: DistillProjectInput,
  distillationRunId: string,
  tally: BatchTally,
  anotarProvenance: (provenance: LlmProvenance | null) => void,
): Promise<void> {
  const facts = await locked.notableFacts();
  const notable = detectNotableResult(facts);
  if (notable === null) return;

  if (!isForgeAllowed(facts, input.settings.forgeEveryNRuns)) {
    ports.logger?.info?.(
      {
        projectId: input.projectId,
        distillationRunId,
        kind: notable.kind,
        runsSinceLastForge: facts.runsSinceLastForge,
        forgeEveryNRuns: input.settings.forgeEveryNRuns,
      },
      "distiller_forge_rate_limited",
    );
    return;
  }

  const result = await ports.runtime.execute({
    purpose: "forge",
    prompt: buildForgePrompt(notable, facts),
    schema: ForgeOutputSchema,
    jsonSchema: z.toJSONSchema(ForgeOutputSchema),
  });
  anotarProvenance(result.provenance);
  if (!result.ok) throw new Error(`modelo (forja): ${result.error}`);

  const forged = toForgedAchievementInput(notable, result.output, {
    distillationRunId,
    projectId: input.projectId,
    provenance: {
      harnessSessionId: result.provenance.harnessSessionId,
      usage: result.provenance.usage,
    },
  });
  if (forged === null) throw new Error("o modelo devolveu uma carta com campo vazio");

  const created = await locked.createForgedAchievement(forged);
  tally.forgedAchievementId = created.id;
}
