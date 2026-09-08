import type {
  ContextItem,
  ContextPolicy,
  ContextSectionKind,
  ContextSettingsSnapshot,
  KnowledgeItemType,
  KnowledgePolicy,
  TaskKind,
  TaskStatus,
} from "@dungeon-master/contracts";

/**
 * Os dados que atravessam as portas do montador.
 *
 * Tudo aqui é dado congelado, sem handle de banco: o que o Worker lê das
 * tabelas vira estes objetos, e o que o montador decide sai como `RunContext`.
 * Nenhum texto aqui é confiável — passa por `sanitizeForContext` antes de
 * virar trecho do bloco.
 */

/** O `SUMMARY` corrente do Project, `ACTIVE`. */
export interface ProjectSummarySource {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly version: number;
}

/** Uma página `ACTIVE` do Grimório. */
export interface KnowledgeItemSource {
  readonly id: string;
  readonly type: KnowledgeItemType;
  readonly title: string;
  readonly content: string;
  /** ISO 8601, em UTC. Desempata a ordem e vira a data da decisão no texto. */
  readonly createdAt: string;
}

/** Uma página vinda da busca textual, com o `ts_rank`. */
export interface RankedKnowledgeItemSource extends KnowledgeItemSource {
  readonly score: number;
}

/** Uma Task relacionada: a mãe ou uma dependência. */
export interface TaskContextSource {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly kind: TaskKind;
  /** O `summary` do resultado do último Run `SUCCEEDED` dela, quando há. */
  readonly latestResultSummary: string | null;
}

export interface TaskLineageSource {
  readonly parent: TaskContextSource | null;
  /** As Tasks das quais esta depende, da mais antiga para a mais nova. */
  readonly dependencies: readonly TaskContextSource[];
}

/** Um artefato declarado no resultado de um Run anterior. */
export interface ArtifactSource {
  readonly runId: string;
  readonly taskId: string;
  /** Posição no `artifacts[]` do resultado; com o Run, identifica o item. */
  readonly position: number;
  readonly path: string;
  readonly kind: string | null;
  readonly summary: string | null;
}

/** O que a montagem recebe do Worker. */
export interface AssembleRunContextInput {
  readonly run: { readonly id: string };
  readonly task: {
    readonly id: string;
    readonly projectId: string;
    readonly title: string;
    readonly description: string | null;
    readonly parentTaskId: string | null;
  };
  readonly loadout: {
    readonly id: string;
    readonly version: number;
    readonly skills: readonly string[];
    readonly knowledgePolicy: KnowledgePolicy;
    readonly contextPolicy: ContextPolicy;
  };
  readonly settings: ContextSettingsSnapshot;
  /** Instante da montagem. Entra no registro, nunca no texto. */
  readonly now: Date;
}

/**
 * Um trecho candidato ao bloco, antes do orçamento.
 *
 * `prefix` e `suffix` são a moldura fixa do trecho (as tags e o título); só
 * `content` é cortado quando o trecho é `truncatable`. `text` é sempre a
 * concatenação dos três, e `item.tokens` a estimativa dele.
 */
export interface EntryDraft {
  readonly item: ContextItem;
  readonly prefix: string;
  readonly content: string;
  readonly suffix: string;
  readonly truncatable: boolean;
}

/** Uma seção antes do orçamento: os trechos na ordem de prioridade. */
export interface SectionDraft {
  readonly kind: ContextSectionKind;
  readonly title: string;
  /** A tag que envolve os trechos, ou nula quando o trecho já é o elemento. */
  readonly tag: string | null;
  readonly entries: readonly EntryDraft[];
}
