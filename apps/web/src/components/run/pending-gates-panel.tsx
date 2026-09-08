import { Link } from "@tanstack/react-router";
import { ArrowRight, ShieldHalf } from "lucide-react";

import { Panel, PanelHeader } from "@/components/panel";
import { Button } from "@/components/ui/button";
import type { ApprovalGateListItemRecord } from "@/lib/api-types";
import { usePendingGates } from "@/lib/approvals";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";

const AMBER = "oklch(0.72 0.13 75)";

/**
 * Os Selos pendentes, no topo da lista de Expedições (Fase 4C).
 *
 * É a caixa de entrada de aprovações: cada linha diz o que está sendo pedido,
 * de qual Missão e por qual Ritual, com o atalho para o cockpit, onde a
 * decisão acontece. A decisão não é tomada daqui de propósito — a carta no
 * cockpit tem o contexto (o Diário, os passos anteriores) que uma lista não
 * tem.
 */
export function PendingGatesPanel() {
  const { t, format } = useGlossary();
  const pending = usePendingGates();
  const items = pending.data?.items ?? [];

  return (
    <Panel className="overflow-hidden" data-pending-gates={items.length}>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldHalf aria-hidden className="size-3.75" style={{ color: AMBER }} />
            <span>{t("approval.pending.title")}</span>
          </span>
        }
        aside={
          pending.data === undefined
            ? undefined
            : format(pending.data.total === 1 ? "{n} pendente" : "{n} pendentes", {
                n: pending.data.total,
              })
        }
      />

      {pending.isError && (
        <p className="text-destructive px-5 py-4 text-sm">{pending.error.message}</p>
      )}

      {!pending.isError && items.length === 0 && (
        <p className="text-muted-foreground px-5 py-3.5 text-[12.5px] leading-4.5">
          {pending.isPending ? "Lendo…" : t("approval.pending.empty")}
        </p>
      )}

      {items.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((gate) => (
            <PendingGateRow key={gate.id} gate={gate} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PendingGateRow({ gate }: { gate: ApprovalGateListItemRecord }) {
  const { t, format } = useGlossary();

  return (
    <li
      className="border-border flex items-center gap-4 border-b px-5 py-3 last:border-b-0"
      data-pending-gate={gate.id}
    >
      <span
        aria-hidden
        className="size-1.5 flex-none animate-pulse rounded-full"
        style={{ backgroundColor: AMBER }}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-0.75">
        <span className="truncate text-[13px] leading-4.5 font-medium">{gate.title}</span>
        <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px]">
          <span className="flex-none">{t("entity.task")}:</span>
          <Link
            className="hover:text-foreground truncate underline-offset-2 hover:underline"
            params={{ id: gate.taskId }}
            to="/tasks/$id"
          >
            {gate.taskTitle}
          </Link>
          <span aria-hidden>·</span>
          <span className="flex-none">{t("entity.workflow")}:</span>
          <WorkflowName gate={gate} />
          <span aria-hidden>·</span>
          <span>{format("pedido {when}", { when: relativeTime(gate.requestedAt) })}</span>
        </span>
      </div>

      <Button asChild size="sm" variant="outline">
        <Link params={{ id: gate.runId }} to="/runs/$id">
          <span>{format("Abrir o {cockpit}", { cockpit: t("run.cockpit") })}</span>
          <ArrowRight aria-hidden />
        </Link>
      </Button>
    </li>
  );
}

/**
 * O nome do Ritual de um gate, como a listagem já o traz.
 *
 * `GET /approval-gates` resolve o Workflow por junção, junto da Task; a linha
 * não faz leitura nenhuma por conta própria. Os quatro campos são anuláveis
 * juntos, então basta olhar um.
 */
function WorkflowName({ gate }: { gate: ApprovalGateListItemRecord }) {
  if (gate.workflowId === null || gate.workflowName === null) return <span>—</span>;

  return (
    <Link
      className="hover:text-foreground truncate underline-offset-2 hover:underline"
      data-pending-gate-workflow={gate.workflowId}
      params={{ id: gate.workflowId }}
      to="/workflows/$id"
    >
      {`${gate.workflowName} · v${String(gate.workflowVersion ?? 1)}`}
    </Link>
  );
}
