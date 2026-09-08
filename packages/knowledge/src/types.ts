import type {
  DistillationTrigger,
  KnowledgeCandidateDecision,
  KnowledgeItemStatus,
  KnowledgeItemType,
  UsageSummary,
} from "@dungeon-master/contracts";

/**
 * Os dados que atravessam as portas do Distiller.
 *
 * Tudo aqui é dado congelado, sem handle de banco: o que o Worker lê das
 * tabelas vira estes objetos, e o que o Distiller decide volta por eles.
 */

/** Um candidato `PENDING`, como o lote o recebe. */
export interface DistillCandidate {
  readonly id: string;
  readonly runId: string;
  readonly taskId: string;
  readonly title: string;
  readonly content: string;
  readonly kind: string | null;
  readonly createdAt: string;
}

/** O que o L0 de um Run diz, já filtrado do ruído de harness. */
export interface RunTranscript {
  readonly runId: string;
  readonly taskTitle: string;
  /** O `summary` do resultado do Run, escrito pelo agente. */
  readonly summary: string | null;
  /** O texto do agente ao longo do Run, com teto e sem ruído. */
  readonly transcript: string;
}

/** Um item do Grimório que já existe, como candidato a duplicata. */
export interface ExistingKnowledgeItem {
  readonly id: string;
  readonly type: KnowledgeItemType;
  readonly status: KnowledgeItemStatus;
  readonly title: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface ProjectContext {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
}

/** As configurações do usuário que o lote respeita. */
export interface DistillSettings {
  /** Itens promovidos nascem em `PENDING_REVIEW` (`true`) ou `ACTIVE` (`false`). */
  readonly humanReview: boolean;
  /** Rate limit das forjadas: uma a cada N Expedições terminadas. */
  readonly forgeEveryNRuns: number;
  /** Itens ativos novos que disparam a regeneração do resumo. Padrão: 5. */
  readonly summaryEveryNItems?: number;
}

/**
 * Uma decisão final sobre um candidato, já normalizada e sanitizada.
 *
 * `decidedBy` diz se foi o modelo ou a regra: um candidato vazio depois do
 * filtro de ruído é rejeitado sem gastar uma chamada, e a proveniência
 * precisa dizer isso.
 */
export interface ResolvedDecision {
  readonly candidateId: string;
  readonly decision: KnowledgeCandidateDecision;
  readonly decidedBy: "LLM" | "RULE";
  readonly reason: string;
  /** Presente em `PROMOTE`: o item a criar. */
  readonly item?: {
    readonly type: Exclude<KnowledgeItemType, "SUMMARY">;
    readonly title: string;
    readonly content: string;
  };
  /** Presente em `MERGE` para um item que já existe: o item que absorve o candidato. */
  readonly mergeIntoItemId?: string;
  /**
   * Presente em `MERGE` para outro candidato do mesmo lote: quem grava
   * resolve para o item que aquele candidato virou. Se ele não virou item
   * (foi rejeitado, ou mesclado noutro), o candidato é promovido: duplicar
   * antes de perder.
   */
  readonly mergeIntoCandidateId?: string;
}

export interface LlmProvenance {
  readonly harnessSessionId: string | null;
  readonly usage: UsageSummary | null;
}

export interface ApplyDecisionsInput {
  readonly distillationRunId: string;
  readonly decisions: readonly ResolvedDecision[];
  readonly humanReview: boolean;
  readonly provenance: LlmProvenance;
}

export interface ApplyDecisionsResult {
  readonly promoted: number;
  readonly rejected: number;
  readonly merged: number;
  /** Os itens criados, na ordem das decisões. */
  readonly createdItemIds: readonly string[];
}

export interface UpsertSummaryInput {
  readonly distillationRunId: string;
  readonly title: string;
  readonly content: string;
  readonly coveredItemIds: readonly string[];
  readonly provenance: LlmProvenance;
}

/** O que a etapa opcional da forja grava. */
export interface ForgedAchievementInput {
  readonly distillationRunId: string;
  readonly kind:
    "NEMESIS_DEFEATED" | "VICTORY_STREAK" | "FIRST_HARNESS_VICTORY" | "DURATION_RECORD";
  readonly detail: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly name: string;
  readonly description: string;
  readonly flavor: string;
  readonly plainName: string;
  readonly plainDescription: string;
  readonly icon: string;
  readonly rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
  /** A condição do vocabulário fechado das Conquistas, para a reconstrução reproduzir o desbloqueio. */
  readonly condition: unknown;
  readonly provenance: LlmProvenance;
}

export interface DistillationRunStart {
  readonly projectId: string;
  readonly trigger: DistillationTrigger;
  readonly loadoutId: string | null;
}

export interface DistillationRunFinish {
  readonly id: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly error: string | null;
  readonly candidateCount: number;
  readonly promoted: number;
  readonly rejected: number;
  readonly merged: number;
  readonly summaryRegenerated: boolean;
  readonly forgedAchievementId: string | null;
  readonly harnessSessionId: string | null;
  readonly usage: UsageSummary | null;
}
