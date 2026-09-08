import type {
  DistillationRunStatus,
  KnowledgeCandidateStatus,
  KnowledgeItemStatus,
  KnowledgeItemType,
} from "@dungeon-master/contracts";

import { useGlossary } from "@/lib/glossary";
import {
  DISTILLATION_STATUS,
  KNOWLEDGE_CANDIDATE_STATUS,
  KNOWLEDGE_STATUS,
  KNOWLEDGE_TYPE,
} from "@/lib/knowledge-domain";
import { cn } from "@/lib/utils";

/**
 * Os sinais que o Grimório repete: tipo, estado do item, estado do candidato
 * e estado do lote. Mesma anatomia dos chips de Task e de Run: o texto vem do
 * glossário ativo, o ícone e a cor não.
 */

const CHIP =
  "border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap";

export function KnowledgeTypeChip({
  type,
  className,
}: {
  type: KnowledgeItemType;
  className?: string;
}) {
  const { t } = useGlossary();
  const { label, icon: Icon } = KNOWLEDGE_TYPE[type];

  return (
    <span className={cn(CHIP, className)} data-knowledge-type={type}>
      <Icon aria-hidden className="text-muted-foreground size-3" />
      <span>{t(label)}</span>
    </span>
  );
}

export function KnowledgeStatusChip({
  status,
  className,
}: {
  status: KnowledgeItemStatus;
  className?: string;
}) {
  const { t } = useGlossary();
  const { label, dot, pulse, dim } = KNOWLEDGE_STATUS[status];

  return (
    <span
      className={cn(CHIP, dim && "text-muted-foreground", className)}
      data-knowledge-status={status}
    >
      <span
        aria-hidden
        className={cn("size-1.5 flex-none rounded-full", pulse && "animate-pulse")}
        style={{ backgroundColor: dot }}
      />
      <span>{t(label)}</span>
    </span>
  );
}

export function CandidateStatusChip({
  status,
  className,
}: {
  status: KnowledgeCandidateStatus;
  className?: string;
}) {
  const { t } = useGlossary();
  const { label, dot, pulse } = KNOWLEDGE_CANDIDATE_STATUS[status];

  return (
    <span className={cn(CHIP, className)} data-candidate-status={status}>
      <span
        aria-hidden
        className={cn("size-1.5 flex-none rounded-full", pulse && "animate-pulse")}
        style={{ backgroundColor: dot }}
      />
      <span>{t(label)}</span>
    </span>
  );
}

export function BatchStatusChip({
  status,
  className,
}: {
  status: DistillationRunStatus;
  className?: string;
}) {
  const { t } = useGlossary();
  const { label, dot, pulse } = DISTILLATION_STATUS[status];

  return (
    <span className={cn(CHIP, className)} data-batch-status={status}>
      <span
        aria-hidden
        className={cn("size-1.5 flex-none rounded-full", pulse && "animate-pulse")}
        style={{ backgroundColor: dot }}
      />
      <span>{t(label)}</span>
    </span>
  );
}
