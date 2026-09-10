import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import type { ProposedTaskRecord } from "@/lib/api-types";
import { formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { PROPOSAL_STATUS } from "@/lib/proposal-domain";
import { cn } from "@/lib/utils";

/** O chip de estado de uma proposta. */
export function ProposalStatusChip({
  status,
  className,
}: {
  status: ProposedTaskRecord["status"];
  className?: string;
}) {
  const { t } = useGlossary();
  const { label, dot, pulse } = PROPOSAL_STATUS[status];

  return (
    <span
      className={cn(
        "border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap",
        className,
      )}
      data-proposal-status={status}
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

export interface ProposalConflictBoxProps {
  /** A proposta como o `409` a trouxe: a verdade do instante da recusa. */
  readonly proposedTask: ProposedTaskRecord;
  readonly onDismiss: () => void;
}

/**
 * O aviso de decisão perdida (CAS): outra decisão chegou antes.
 *
 * Mostra a proposta como ela ficou, com a nota e o instante, e o link para a
 * Task criada quando a decisão foi uma aprovação. Nada é sobrescrito, e o
 * botão só fecha o aviso.
 */
export function ProposalConflictBox({ proposedTask, onDismiss }: ProposalConflictBoxProps) {
  const { t, format } = useGlossary();

  return (
    <div
      className="border-destructive/40 bg-destructive/8 flex flex-col gap-2 rounded-lg border px-3 py-2.5"
      data-proposal-conflict={proposedTask.status}
    >
      <span className="text-[12.5px] leading-4.5 font-medium">
        {format(t("proposal.conflict"), {
          status: t(PROPOSAL_STATUS[proposedTask.status].label).toLowerCase(),
        })}
      </span>
      {proposedTask.note !== null && proposedTask.note !== "" && (
        <span className="text-muted-foreground text-[12px] leading-4.5">{proposedTask.note}</span>
      )}
      <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[11px]">
        <span>
          {proposedTask.decidedAt === null
            ? "—"
            : format("Decidido em {when}", { when: formatDateTime(proposedTask.decidedAt) })}
        </span>
        {proposedTask.createdTaskId !== null && (
          <Link
            className="hover:text-foreground underline-offset-2 hover:underline"
            params={{ id: proposedTask.createdTaskId }}
            to="/tasks/$id"
          >
            {format("Abrir a {task} criada", { task: t("entity.task") })}
          </Link>
        )}
      </span>
      <Button className="w-fit" onClick={onDismiss} size="xs" variant="outline">
        Entendi
      </Button>
    </div>
  );
}
