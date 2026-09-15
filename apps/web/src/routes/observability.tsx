import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Telescope } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { OverviewTiles } from "@/components/metrics/overview-tiles";
import { SeriesPanel } from "@/components/metrics/series-panel";
import { WorkerTable } from "@/components/metrics/worker-table";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MetricWindowRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useMetricSeries, useMetricsOverview, useWorkers } from "@/lib/metrics";
import { METRIC_WINDOW, METRIC_WINDOWS } from "@/lib/metrics-domain";
import { useProject } from "@/lib/projects";
import { observabilitySearchSchema } from "@/lib/search";

export const Route = createFileRoute("/observability")({
  validateSearch: observabilitySearchSchema,
  component: ObservabilityPage,
});

/**
 * A tela de observabilidade avançada (planejamento v0.4, Fase 10B).
 *
 * Tudo que ela mostra é projeção: `run_metric` e `metric_daily`, mantidos pelo
 * projetor do Worker e reconstruíveis do zero. A tela não soma nada por conta
 * própria — nem moedas, nem tokens de quem não reportou.
 *
 * ## O que esta tela se recusa a fazer
 *
 * Mostrar zero onde não houve medida. Um custo sem preço sai "não medido", uma
 * taxa de sucesso sem Run sai travessão, e a soma de tokens vem sempre com
 * "n de m Expedições com tokens medidos" embaixo. Um painel que arredonda
 * ausência para zero ensina o usuário a confiar num número que ninguém apurou.
 *
 * A janela, a medida e a dimensão vivem na URL, em valores canônicos: o link
 * reproduz a mesma tela, e o interruptor de tema não o altera.
 */
function ObservabilityPage() {
  const { t, format } = useGlossary();
  const navigate = useNavigate({ from: "/observability" });
  const search = Route.useSearch();

  const projectId = search.projectId ?? null;
  const project = useProject(projectId);

  const overview = useMetricsOverview({ window: search.window, projectId });
  const series = useMetricSeries({
    metric: search.metric,
    dimension: search.dimension,
    window: search.window,
    projectId,
  });
  const workers = useWorkers();

  // O vazio honesto: nenhuma Expedição terminal na janela. Não é erro nem
  // carregamento — é o estado de quem ainda não mandou ninguém partir, e a
  // frase diz isso em vez de desenhar um painel de zeros.
  const empty = overview.data !== undefined && overview.data.runs.total === 0;

  return (
    <>
      <PageHeader
        title={t("nav.observability")}
        description={t("metrics.description")}
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <Select
              onValueChange={(next) => {
                void navigate({
                  search: (previous) => ({ ...previous, window: next as MetricWindowRecord }),
                  replace: true,
                });
              }}
              value={search.window}
            >
              <SelectTrigger aria-label={t("metrics.window")} className="w-36" data-metrics-window>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRIC_WINDOWS.map((window) => (
                  <SelectItem key={window} value={window}>
                    {t(METRIC_WINDOW[window])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {overview.data !== undefined && (
              <span className="text-muted-foreground text-[11.5px]">
                {format(t("metrics.range"), { from: overview.data.from, to: overview.data.to })}
              </span>
            )}
          </div>
        }
      />

      {projectId !== null && (
        <Panel
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
          data-metrics-project={projectId}
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium">
              {`${t("entity.project")}: ${project.data?.title ?? "…"}`}
            </span>
            <span className="text-muted-foreground text-[11.5px]">
              {t("metrics.project.subscriptionNote")}
            </span>
          </span>
          <Link
            className="text-[12.5px] underline underline-offset-2"
            search={{ window: search.window, metric: search.metric, dimension: search.dimension }}
            to="/observability"
          >
            {t("nav.observability")}
          </Link>
        </Panel>
      )}

      {overview.isError && <p className="text-destructive text-sm">{overview.error.message}</p>}
      {overview.isPending && <p className="text-muted-foreground text-sm">Lendo…</p>}

      {overview.data !== undefined && <OverviewTiles overview={overview.data} />}

      {empty && (
        <Panel>
          <EmptyState icon={Telescope} title={t("metrics.empty.title")}>
            {t("metrics.empty.description")}
          </EmptyState>
        </Panel>
      )}

      {series.data !== undefined && (
        <SeriesPanel
          dimension={search.dimension}
          isPending={series.isFetching}
          metric={search.metric}
          onDimensionChange={(dimension) => {
            void navigate({ search: (previous) => ({ ...previous, dimension }), replace: true });
          }}
          onMetricChange={(metric) => {
            void navigate({ search: (previous) => ({ ...previous, metric }), replace: true });
          }}
          series={series.data}
        />
      )}
      {series.isError && <p className="text-destructive text-sm">{series.error.message}</p>}

      <WorkerTable error={workers.error} isPending={workers.isPending} workers={workers.data} />
    </>
  );
}
