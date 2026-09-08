import { Link } from "@tanstack/react-router";
import { Feather, ScrollText } from "lucide-react";
import { useState } from "react";

import { DistillButton } from "@/components/knowledge/distill-button";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useProjectSummary } from "@/lib/knowledge";
import { KNOWLEDGE_COLOR, KNOWLEDGE_PENDING_COLOR } from "@/lib/knowledge-domain";
import { cn } from "@/lib/utils";

export interface SummaryPanelProps {
  readonly projectId: string;
}

/**
 * O resumo corrente do Project em destaque (Fase 6B).
 *
 * O `SUMMARY` é o item que o Distiller reescreve a partir dos itens ativos, e
 * é o primeiro contexto que a Fase 7 vai entregar ao agente. Por isso ele
 * abre a tela: é o que o Grimório diz quando alguém pergunta "o que este
 * projeto já sabe". `promotedSinceSummary` diz o quanto ele está atrasado,
 * com o mesmo número que o gatilho de regeneração olha.
 *
 * Sem resumo, o estado vazio traz o botão que pede um lote: é o caminho mais
 * curto entre "ainda não existe" e "existe".
 */
export function SummaryPanel({ projectId }: SummaryPanelProps) {
  const { t, format, theme } = useGlossary();
  const summary = useProjectSummary(projectId);
  const [expanded, setExpanded] = useState(false);

  if (summary.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (summary.isError) {
    return <p className="text-destructive text-sm">{summary.error.message}</p>;
  }

  const data = summary.data;
  const item = data.item;

  if (item === null) {
    return (
      <Panel data-knowledge-summary="none">
        <EmptyState
          action={<DistillButton className="mt-1" projectId={projectId} />}
          icon={ScrollText}
          title={t("knowledge.summary.title")}
        >
          {t("knowledge.summary.empty")}
        </EmptyState>
      </Panel>
    );
  }

  const stale = data.promotedSinceSummary > 0;
  const long = item.content.length > 900;

  return (
    <Panel className="flex flex-col gap-3 px-5 py-4" data-knowledge-summary={item.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Feather aria-hidden className="size-3.75" style={{ color: KNOWLEDGE_COLOR }} />
        <span className="text-sm font-medium">{t("knowledge.summary.title")}</span>
        <span className="text-muted-foreground text-[11px]">
          {format("versão {n} · {when}", { n: item.version, when: formatDateTime(item.updatedAt) })}
        </span>
        <span className="flex-1" />
        <span
          className="text-[11.5px]"
          data-knowledge-summary-stale={data.promotedSinceSummary}
          style={{ color: stale ? KNOWLEDGE_PENDING_COLOR : "var(--muted-foreground)" }}
        >
          {stale
            ? format(t("knowledge.summary.stale"), { n: data.promotedSinceSummary })
            : t("knowledge.summary.fresh")}
        </span>
      </div>

      <h2
        className={cn(
          "text-[17px] leading-6 font-semibold",
          theme === "dnd" && "font-display tracking-[0.01em]",
        )}
      >
        {item.title}
      </h2>

      {/* Texto escrito por um modelo: renderizado como texto, nunca como HTML. */}
      <p
        className={cn(
          "m-0 text-[13px] leading-5.5 whitespace-pre-wrap",
          long && !expanded && "line-clamp-6",
        )}
      >
        {item.content}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {long && (
          <Button
            onClick={() => {
              setExpanded((current) => !current);
            }}
            size="xs"
            variant="ghost"
          >
            {expanded ? "Mostrar menos" : "Mostrar tudo"}
          </Button>
        )}
        <Button asChild size="xs" variant="outline">
          <Link
            params={{ id: projectId }}
            from="/projects/$id/knowledge"
            search={(previous) => ({ ...previous, item: item.id })}
            to="/projects/$id/knowledge"
          >
            {t("knowledge.detail.open")}
          </Link>
        </Button>
        <span className="flex-1" />
        <span className="text-muted-foreground text-[11.5px]">
          {format(t("knowledge.count.active"), { n: data.activeItemCount })}
        </span>
      </div>
    </Panel>
  );
}
