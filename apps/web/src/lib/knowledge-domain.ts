import type {
  DistillationRunStatus,
  DistillationTrigger,
  KnowledgeCandidateStatus,
  KnowledgeItemStatus,
  KnowledgeItemType,
  KnowledgeReviewFilter,
} from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";
import {
  BookMarked,
  Compass,
  Gavel,
  ListOrdered,
  ScrollText,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

/**
 * A ponte entre os enums do Grimório e o que a tela mostra (Fase 6B).
 *
 * Mesma disciplina de `lib/proposal-domain.ts`: nenhum label escrito, só
 * **chaves** de glossário resolvidas no ponto de render, e todo mapa é um
 * `Record<Enum, …>` para que um valor novo no contrato vire erro de compilação.
 */

const ACCENT_BLUE = "oklch(0.72 0.13 250)";
const ACCENT_VIOLET = "oklch(0.72 0.13 305)";
const ACCENT_AMBER = "oklch(0.72 0.13 75)";
const ACCENT_GREEN = "oklch(0.72 0.13 150)";

/** A cor do Grimório em toda a interface: o violeta do que foi escrito e guardado. */
export const KNOWLEDGE_COLOR = ACCENT_VIOLET;

/** A cor da revisão pendente: o mesmo âmbar de "espera uma decisão" das propostas. */
export const KNOWLEDGE_PENDING_COLOR = ACCENT_AMBER;

/* ---------------------------------------------------------- knowledge.type */

export const KNOWLEDGE_TYPES: readonly KnowledgeItemType[] = [
  "FACT",
  "DECISION",
  "DISCOVERY",
  "CONSTRAINT",
  "PROCEDURE",
  "SUMMARY",
];

/** Os tipos que o usuário pode dar a um item; o `SUMMARY` é do Distiller. */
export const EDITABLE_KNOWLEDGE_TYPES: readonly Exclude<KnowledgeItemType, "SUMMARY">[] = [
  "FACT",
  "DECISION",
  "DISCOVERY",
  "CONSTRAINT",
  "PROCEDURE",
];

interface KnowledgeTypePresentation {
  readonly label: GlossaryKey;
  readonly icon: LucideIcon;
}

export const KNOWLEDGE_TYPE: Record<KnowledgeItemType, KnowledgeTypePresentation> = {
  FACT: { label: "knowledge.type.fact", icon: BookMarked },
  DECISION: { label: "knowledge.type.decision", icon: Gavel },
  DISCOVERY: { label: "knowledge.type.discovery", icon: Compass },
  CONSTRAINT: { label: "knowledge.type.constraint", icon: ShieldAlert },
  PROCEDURE: { label: "knowledge.type.procedure", icon: ListOrdered },
  SUMMARY: { label: "knowledge.type.summary", icon: ScrollText },
};

/* -------------------------------------------------------- knowledge.status */

export const KNOWLEDGE_STATUSES: readonly KnowledgeItemStatus[] = [
  "PENDING_REVIEW",
  "ACTIVE",
  "REJECTED",
  "ARCHIVED",
];

interface KnowledgeStatusPresentation {
  readonly label: GlossaryKey;
  readonly dot: string;
  readonly pulse: boolean;
  /** Já saiu do Grimório, ou nunca entrou: o texto vai em `muted-foreground`. */
  readonly dim: boolean;
}

export const KNOWLEDGE_STATUS: Record<KnowledgeItemStatus, KnowledgeStatusPresentation> = {
  PENDING_REVIEW: {
    label: "knowledge.status.pendingReview",
    dot: ACCENT_AMBER,
    pulse: true,
    dim: false,
  },
  ACTIVE: { label: "knowledge.status.active", dot: ACCENT_GREEN, pulse: false, dim: false },
  REJECTED: {
    label: "knowledge.status.rejected",
    dot: "var(--destructive)",
    pulse: false,
    dim: true,
  },
  ARCHIVED: {
    label: "knowledge.status.archived",
    dot: "var(--muted-foreground)",
    pulse: false,
    dim: true,
  },
};

/* -------------------------------------------------------- knowledge.review */

export const KNOWLEDGE_REVIEW_FILTERS: readonly KnowledgeReviewFilter[] = ["pending", "reviewed"];

export const KNOWLEDGE_REVIEW_FILTER: Record<KnowledgeReviewFilter, GlossaryKey> = {
  pending: "knowledge.review.pending",
  reviewed: "knowledge.review.reviewed",
};

/* ----------------------------------------------------- candidate.status */

interface CandidateStatusPresentation {
  readonly label: GlossaryKey;
  readonly dot: string;
  readonly pulse: boolean;
}

export const KNOWLEDGE_CANDIDATE_STATUS: Record<
  KnowledgeCandidateStatus,
  CandidateStatusPresentation
> = {
  PENDING: { label: "knowledge.candidate.status.pending", dot: ACCENT_AMBER, pulse: true },
  PROMOTED: { label: "knowledge.candidate.status.promoted", dot: ACCENT_GREEN, pulse: false },
  REJECTED: {
    label: "knowledge.candidate.status.rejected",
    dot: "var(--destructive)",
    pulse: false,
  },
  MERGED: { label: "knowledge.candidate.status.merged", dot: ACCENT_BLUE, pulse: false },
};

/* ----------------------------------------------------------- batch.status */

interface BatchStatusPresentation {
  readonly label: GlossaryKey;
  readonly dot: string;
  readonly pulse: boolean;
}

export const DISTILLATION_STATUS: Record<DistillationRunStatus, BatchStatusPresentation> = {
  RUNNING: { label: "knowledge.batch.status.running", dot: ACCENT_BLUE, pulse: true },
  SUCCEEDED: { label: "knowledge.batch.status.succeeded", dot: ACCENT_GREEN, pulse: false },
  FAILED: { label: "knowledge.batch.status.failed", dot: "var(--destructive)", pulse: false },
};

export const DISTILLATION_TRIGGER: Record<DistillationTrigger, GlossaryKey> = {
  TIMER: "knowledge.batch.trigger.timer",
  IDLE: "knowledge.batch.trigger.idle",
  NOTIFY: "knowledge.batch.trigger.notify",
  MANUAL: "knowledge.batch.trigger.manual",
};

/**
 * A duração de um lote, em texto curto.
 *
 * Um lote em andamento não tem fim: quem chama passa `now` e a duração
 * corre. Abaixo de um minuto, segundos; acima, minutos e segundos.
 */
export function batchDuration(startedAt: string, finishedAt: string | null, now: number): string {
  const start = new Date(startedAt).getTime();
  const end = finishedAt === null ? now : new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";

  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(rest)} s`;
}
