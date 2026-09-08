import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Gavel } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { KnowledgeStatusChip } from "@/components/knowledge/knowledge-chips";
import { Panel, PanelHeader } from "@/components/panel";
import { Button } from "@/components/ui/button";
import type { KnowledgeItemRecord } from "@/lib/api-types";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { KNOWLEDGE_PAGE_SIZE, useProjectDecisions } from "@/lib/knowledge";
import { KNOWLEDGE_COLOR } from "@/lib/knowledge-domain";

export interface DecisionsTimelineProps {
  readonly projectId: string;
}

/**
 * A linha do tempo de decisões do Project (Fase 6B): os itens `DECISION`, da
 * mais antiga para a mais recente, como a API os ordena.
 *
 * É uma seção do Grimório, e não uma tela própria: uma decisão **é** uma
 * Página do Grimório com tipo próprio, e a tela dela é a mesma gaveta. O que
 * esta aba acrescenta é a ordem: cronológica, porque uma decisão só faz
 * sentido diante das que vieram antes. Sem `status`, a API lista as ativas e
 * as em revisão; as recusadas e arquivadas ficam na lista filtrada.
 */
export function DecisionsTimeline({ projectId }: DecisionsTimelineProps) {
  const { t, format } = useGlossary();
  const [page, setPage] = useState(1);
  const decisions = useProjectDecisions(projectId, page, KNOWLEDGE_PAGE_SIZE);

  const items = decisions.data?.items ?? [];
  const total = decisions.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / KNOWLEDGE_PAGE_SIZE));

  if (decisions.isError) {
    return <p className="text-destructive text-sm">{decisions.error.message}</p>;
  }

  if (decisions.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (items.length === 0) {
    return (
      <Panel data-decisions={0}>
        <EmptyState icon={Gavel} title={t("entity.decision.plural")}>
          {t("knowledge.decisions.empty")}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel className="overflow-hidden" data-decisions={items.length}>
      <PanelHeader
        aside={format("{count} no total · da mais antiga para a mais recente", { count: total })}
        title={t("entity.decision.plural")}
      />

      <ol className="m-0 flex list-none flex-col p-0">
        {items.map((decision, index) => (
          <DecisionRow
            decision={decision}
            key={decision.id}
            last={index === items.length - 1 && page >= pages}
            projectId={projectId}
          />
        ))}
      </ol>

      {pages > 1 && (
        <div className="border-border text-muted-foreground flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs">
          <span>{format("Página {page} de {pages}", { page, pages })}</span>
          <span className="flex items-center gap-1">
            <Button
              disabled={page <= 1}
              onClick={() => {
                setPage((current) => current - 1);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              disabled={page >= pages}
              onClick={() => {
                setPage((current) => current + 1);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <ChevronRight aria-hidden />
            </Button>
          </span>
        </div>
      )}
    </Panel>
  );
}

function DecisionRow({
  decision,
  projectId,
  last,
}: {
  decision: KnowledgeItemRecord;
  projectId: string;
  last: boolean;
}) {
  const { t, format } = useGlossary();
  const runId = decision.provenance.runId;

  return (
    <li className="relative flex gap-4 px-5 py-3.5" data-decision={decision.id}>
      <div className="flex w-24 flex-none flex-col items-end gap-0.5 pt-0.5 text-right">
        <span className="text-[12px] font-medium" title={formatDateTime(decision.createdAt)}>
          {formatDate(decision.createdAt)}
        </span>
        <span className="text-muted-foreground text-[10.5px]">
          {formatDateTime(decision.createdAt).slice(-5)}
        </span>
      </div>

      <div className="relative flex flex-none flex-col items-center">
        <span
          aria-hidden
          className="mt-1.5 size-2.5 rounded-full border-2"
          style={{ borderColor: KNOWLEDGE_COLOR, backgroundColor: "var(--card)" }}
        />
        {!last && (
          <span
            aria-hidden
            className="bg-border absolute top-4 bottom-[-14px] w-px"
            style={{ left: "calc(50% - 0.5px)" }}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="text-[13.5px] leading-4.5 font-medium underline-offset-2 hover:underline"
            data-decision-open
            params={{ id: projectId }}
            from="/projects/$id/knowledge"
            search={(previous) => ({ ...previous, item: decision.id })}
            to="/projects/$id/knowledge"
          >
            {decision.title}
          </Link>
          <KnowledgeStatusChip status={decision.status} />
        </div>
        {/* Texto escrito por um modelo: renderizado como texto, nunca como HTML. */}
        <p className="text-muted-foreground m-0 line-clamp-3 text-[12.5px] leading-4.5 whitespace-pre-wrap">
          {decision.content}
        </p>
        {runId !== null && (
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-[11.5px]">
            <span>{t("knowledge.decisions.from")}:</span>
            <Link
              className="hover:text-foreground underline-offset-2 hover:underline"
              data-decision-run={runId}
              params={{ id: runId }}
              to="/runs/$id"
            >
              {format("Abrir o {cockpit}", { cockpit: t("run.cockpit") })}
            </Link>
          </span>
        )}
      </div>
    </li>
  );
}
