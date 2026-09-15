import { Link } from "@tanstack/react-router";
import { Telescope } from "lucide-react";

import { MoneyList } from "@/components/metrics/money-value";
import { Panel, PanelHeader } from "@/components/panel";
import { useGlossary } from "@/lib/glossary";
import { useMetricsOverview } from "@/lib/metrics";
import { formatCompact, formatCount, formatDuration, formatPercent } from "@/lib/metrics-domain";

/**
 * O bloco de medidas na tela de uma Campanha (planejamento v0.4, Fase 10B).
 *
 * Um recorte curto do overview, com o link para a tela inteira já filtrada.
 * A janela é fixa em 30 dias aqui de propósito: esta é a tela do trabalho, e um
 * segundo seletor de janela competindo com o da Torre de Vigia daria dois
 * lugares para ajustar a mesma coisa.
 *
 * O aviso sobre assinatura não é decoração. Com filtro de Project a API não
 * rateia mensalidade — `metric_daily` não tem dimensão cruzada Project ×
 * Provider, e atribuir a fatia do Provider inteiro a um Project seria um número
 * que não é de ninguém. Os Runs de assinatura entram em "sem custo medido", e
 * quem lê precisa saber disso antes de comparar duas Campanhas.
 */

export interface ProjectMetricsProps {
  readonly projectId: string;
}

export function ProjectMetrics({ projectId }: ProjectMetricsProps) {
  const { t, format } = useGlossary();
  const overview = useMetricsOverview({ window: "30d", projectId });

  const data = overview.data;

  return (
    <Panel data-project-metrics={projectId}>
      <PanelHeader
        title={t("metrics.project.title")}
        aside={
          data === undefined
            ? undefined
            : format(t("metrics.range"), { from: data.from, to: data.to })
        }
      />

      <div className="flex flex-col gap-3.5 px-5 py-4">
        {overview.isError && <p className="text-destructive text-sm">{overview.error.message}</p>}
        {overview.isPending && <p className="text-muted-foreground text-sm">Lendo…</p>}

        {data !== undefined && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Stat
                label={t("metrics.tile.runs")}
                note={format("{done} / {total}", {
                  done: data.runs.succeeded,
                  total: data.runs.total,
                })}
                value={formatCount(data.runs.total)}
              />
              <Stat
                label={t("metrics.tile.successRate")}
                value={data.runs.successRate === null ? "—" : formatPercent(data.runs.successRate)}
              />
              <Stat
                label={t("metrics.tile.tokens")}
                note={format(t("metrics.tokens.measured"), {
                  known: data.tokens.knownRuns,
                  total: data.tokens.knownRuns + data.tokens.unknownRuns,
                })}
                value={formatCompact(data.tokens.total)}
              />
              <Stat
                label={t("metrics.tile.duration")}
                note={format(t("metrics.duration.measured"), { n: data.duration.measuredRuns })}
                value={formatDuration(data.duration.averageMs) ?? "—"}
              />
            </div>

            <div className="border-border flex flex-wrap items-end justify-between gap-4 border-t pt-3">
              <MoneyList costs={data.costs} notMeasuredRuns={data.notMeasuredRuns} size="md" />
              <Link
                className="flex items-center gap-1.5 text-[12.5px] underline underline-offset-2"
                search={{ window: "30d", metric: "runs", dimension: "ALL", projectId }}
                to="/observability"
              >
                <Telescope aria-hidden className="size-3.5" />
                <span>{t("metrics.project.open")}</span>
              </Link>
            </div>

            <p className="text-muted-foreground m-0 text-[11.5px] leading-4">
              {t("metrics.project.subscriptionNote")}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">{label}</span>
      <span className="text-lg leading-6 font-semibold">{value}</span>
      {note !== undefined && (
        <span className="text-muted-foreground text-[11px] leading-4">{note}</span>
      )}
    </div>
  );
}
