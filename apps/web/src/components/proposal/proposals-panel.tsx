import { Link } from "@tanstack/react-router";
import { ArrowRight, Footprints } from "lucide-react";
import { useState } from "react";

import { Panel, PanelHeader } from "@/components/panel";
import { ApproveProposalDialog } from "@/components/proposal/approve-proposal-dialog";
import { RejectProposalDialog } from "@/components/proposal/reject-proposal-dialog";
import { Button } from "@/components/ui/button";
import type { ProposedTaskListItemRecord } from "@/lib/api-types";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { PROPOSAL_COLOR, PROPOSAL_DECISION, type ProposalDecision } from "@/lib/proposal-domain";
import { useProposedTasks } from "@/lib/proposals";

function tint(percent: number): string {
  return `color-mix(in oklch, ${PROPOSAL_COLOR} ${String(percent)}%, transparent)`;
}

export interface ProposalsPanelProps {
  /** As abertas deste Project. */
  readonly projectId?: string;
  /** As abertas cuja Task de origem é esta. */
  readonly taskId?: string;
  /** Mostra a Task de origem em cada linha; fora quando o painel já vive nela. */
  readonly showOriginTask?: boolean;
}

/**
 * As propostas abertas de um Project ou de uma Task (Fase 5B).
 *
 * É a caixa de entrada de trabalho descoberto: cada linha diz o que o agente
 * encontrou, por que acha que precisa existir e em qual Expedição encontrou,
 * com o atalho para o cockpit. As duas decisões acontecem daqui: aprovar abre
 * o formulário que escolhe mãe e dependências; recusar pede confirmação.
 */
export function ProposalsPanel({ projectId, taskId, showOriginTask = true }: ProposalsPanelProps) {
  const { t, format } = useGlossary();
  const proposals = useProposedTasks({
    status: "PROPOSED",
    ...(projectId === undefined ? {} : { projectId }),
    ...(taskId === undefined ? {} : { taskId }),
  });
  const items = proposals.data?.items ?? [];

  const [approving, setApproving] = useState<ProposedTaskListItemRecord | null>(null);
  const [rejecting, setRejecting] = useState<ProposedTaskListItemRecord | null>(null);

  return (
    <>
      <Panel className="overflow-hidden" data-proposals={items.length}>
        <PanelHeader
          title={
            <span className="flex items-center gap-2">
              <Footprints aria-hidden className="size-3.75" style={{ color: PROPOSAL_COLOR }} />
              <span>{t("proposal.open.title")}</span>
            </span>
          }
          aside={
            proposals.data === undefined
              ? undefined
              : format("{n} em aberto", { n: proposals.data.total })
          }
        />

        {proposals.isError && (
          <p className="text-destructive px-5 py-4 text-sm">{proposals.error.message}</p>
        )}

        {!proposals.isError && items.length === 0 && (
          <p className="text-muted-foreground px-5 py-3.5 text-[12.5px] leading-4.5">
            {proposals.isPending ? "Lendo…" : t("proposal.open.empty")}
          </p>
        )}

        {items.length > 0 && (
          <ul className="m-0 flex list-none flex-col p-0">
            {items.map((proposal) => (
              <ProposalRow
                key={proposal.id}
                onDecide={(decision) => {
                  if (decision === "approve") setApproving(proposal);
                  else setRejecting(proposal);
                }}
                proposal={proposal}
                showOriginTask={showOriginTask}
              />
            ))}
          </ul>
        )}
      </Panel>

      <ApproveProposalDialog
        onOpenChange={(open) => {
          if (!open) setApproving(null);
        }}
        proposal={approving}
      />
      <RejectProposalDialog
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
        proposal={rejecting}
      />
    </>
  );
}

function ProposalRow({
  proposal,
  showOriginTask,
  onDecide,
}: {
  proposal: ProposedTaskListItemRecord;
  showOriginTask: boolean;
  onDecide: (decision: ProposalDecision) => void;
}) {
  const { t, format } = useGlossary();

  return (
    <li
      className="border-border flex flex-col gap-2.5 border-b px-5 py-3.5 last:border-b-0"
      data-proposal={proposal.id}
    >
      <div className="flex items-start gap-3.5">
        <span
          className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full border"
          style={{ borderColor: tint(40), backgroundColor: tint(12), color: PROPOSAL_COLOR }}
        >
          <Footprints aria-hidden className="size-3.5" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[13.5px] leading-4.5 font-medium">{proposal.title}</span>

          {proposal.description !== null && proposal.description !== "" && (
            <p className="text-muted-foreground m-0 text-[12.5px] leading-4.5 whitespace-pre-wrap">
              {proposal.description}
            </p>
          )}

          {proposal.rationale !== null && proposal.rationale !== "" && (
            <div
              className="flex flex-col gap-0.5 rounded-md border px-2.5 py-2"
              data-proposal-rationale
              style={{ borderColor: tint(30), backgroundColor: tint(6) }}
            >
              <span className="text-muted-foreground text-[10.5px] tracking-[0.06em] uppercase">
                {t("proposal.rationale")}
              </span>
              <span className="text-[12.5px] leading-4.5 whitespace-pre-wrap">
                {proposal.rationale}
              </span>
            </div>
          )}

          <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px]">
            {showOriginTask && (
              <>
                <span className="flex-none">{t("entity.task")}:</span>
                <Link
                  className="hover:text-foreground truncate underline-offset-2 hover:underline"
                  data-proposal-origin-task={proposal.originTaskId}
                  params={{ id: proposal.originTaskId }}
                  to="/tasks/$id"
                >
                  {proposal.originTaskTitle}
                </Link>
                <span aria-hidden>·</span>
              </>
            )}
            <span className="flex-none">{t("proposal.origin.run")}:</span>
            <Link
              className="hover:text-foreground truncate underline-offset-2 hover:underline"
              data-proposal-origin-run={proposal.originRunId}
              params={{ id: proposal.originRunId }}
              to="/runs/$id"
            >
              {format("Abrir o {cockpit}", { cockpit: t("run.cockpit") })}
            </Link>
            <span aria-hidden>·</span>
            <span>{format("trazida {when}", { when: relativeTime(proposal.createdAt) })}</span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-10.5">
        <DecisionButton
          decision="approve"
          onClick={() => {
            onDecide("approve");
          }}
        />
        <DecisionButton
          decision="reject"
          onClick={() => {
            onDecide("reject");
          }}
        />
        <span className="flex-1" />
        <Link
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
          params={{ id: proposal.projectId }}
          to="/projects/$id/graph"
        >
          <span>{t("entity.taskGraph")}</span>
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>
    </li>
  );
}

function DecisionButton({
  decision,
  onClick,
}: {
  decision: ProposalDecision;
  onClick: () => void;
}) {
  const { t } = useGlossary();
  const { icon: Icon, label, color } = PROPOSAL_DECISION[decision];

  return (
    <Button
      className="border"
      data-proposal-decision={decision}
      onClick={onClick}
      size="xs"
      style={{
        borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
        color,
      }}
      variant="ghost"
    >
      <Icon aria-hidden />
      <span>{t(label)}</span>
    </Button>
  );
}
