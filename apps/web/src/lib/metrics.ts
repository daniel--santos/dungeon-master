import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { api } from "@/lib/api";
import type {
  MetricCostsRecord,
  MetricDimensionRecord,
  MetricSeriesRecord,
  MetricWindowRecord,
  MetricsOverviewRecord,
  ModelPriceListRecord,
  ModelPriceRecord,
  RunMetricsRecord,
  SeriesMetricRecord,
  SetModelPriceBody,
  WorkerListRecord,
} from "@/lib/api-types";
import { EXECUTION_MODE } from "@/lib/execution-domain";
import { useGlossary } from "@/lib/glossary";
import { dimensionKeyLabel } from "@/lib/metrics-domain";
import { ApiError, fail } from "@/lib/problem";

/**
 * As leituras da observabilidade avançada (planejamento v0.4, Fase 10B).
 *
 * Tudo aqui é projeção: `run_metric` e `metric_daily` são mantidos pelo
 * projetor do Worker e podem ser reconstruídos do zero. A tela não recalcula
 * nada — nem soma moedas, nem inventa zero onde a API disse `NOT_MEASURED`.
 *
 * As chaves de query ficam sob o prefixo `metrics`, menos a dos Workers: um
 * `worker.online` invalida a presença sem derrubar as séries, e um
 * `metrics.updated` faz o inverso. A separação é o que evita uma releitura de
 * noventa dias de série cada vez que um processo bate o coração.
 */

export const metricKeys = {
  all: ["metrics"] as const,
  overview: (window: MetricWindowRecord, projectId: string | null) =>
    ["metrics", "overview", window, projectId ?? "ALL"] as const,
  series: (
    metric: SeriesMetricRecord,
    dimension: MetricDimensionRecord,
    window: MetricWindowRecord,
    projectId: string | null,
    currency: string | null,
  ) =>
    ["metrics", "series", metric, dimension, window, projectId ?? "ALL", currency ?? "-"] as const,
  costs: (window: MetricWindowRecord) => ["metrics", "costs", window] as const,
  run: (runId: string) => ["metrics", "run", runId] as const,
  prices: ["metrics", "model-prices"] as const,
  priceHistory: (modelId: string) => ["metrics", "model-prices", modelId] as const,
  workers: ["workers"] as const,
};

/** Tudo que muda quando o projetor fecha um lote. */
export function invalidateMetrics(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: metricKeys.all });
}

/** Só a presença: o tile de Workers do painel vive no overview, e relê junto. */
export function invalidateWorkers(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: metricKeys.workers });
  void queryClient.invalidateQueries({ queryKey: ["metrics", "overview"] });
}

/* ---------------------------------------------------------------- overview */

export interface OverviewParams {
  readonly window: MetricWindowRecord;
  /** `null` é o recorte global, o único em que a assinatura é rateada. */
  readonly projectId?: string | null;
}

export function useMetricsOverview(params: OverviewParams): UseQueryResult<MetricsOverviewRecord> {
  const { window, projectId = null } = params;

  return useQuery({
    queryKey: metricKeys.overview(window, projectId),
    queryFn: async () => {
      // A rota do Project é outra — `GET /projects/{id}/metrics` —, e não a
      // global com um filtro: ela devolve `404` quando o Project não existe,
      // que é uma resposta diferente de "este Project não teve Run".
      if (projectId !== null) {
        const { data, error, response } = await api.GET("/api/v1/projects/{id}/metrics", {
          params: { path: { id: projectId }, query: { window } },
        });
        if (data === undefined) fail(error, response.status, "Não foi possível ler as medidas");
        return data;
      }

      const { data, error, response } = await api.GET("/api/v1/metrics/overview", {
        params: { query: { window } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler as medidas");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

/* ------------------------------------------------------------------ série */

export interface SeriesParams {
  readonly metric: SeriesMetricRecord;
  readonly dimension: MetricDimensionRecord;
  readonly window: MetricWindowRecord;
  readonly projectId?: string | null;
  readonly currency?: string | null;
}

export function useMetricSeries(params: SeriesParams): UseQueryResult<MetricSeriesRecord> {
  const { metric, dimension, window, projectId = null, currency = null } = params;

  return useQuery({
    queryKey: metricKeys.series(metric, dimension, window, projectId, currency),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/metrics/series", {
        params: {
          query: {
            metric,
            dimension,
            window,
            ...(projectId === null ? {} : { projectId }),
            ...(currency === null ? {} : { currency }),
          },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a série");
      return data;
    },
    // A troca de dimensão mantém o desenho anterior enquanto a próxima não
    // chega: sem isso o gráfico pisca em branco a cada clique no seletor.
    placeholderData: (previous) => previous,
  });
}

/* ------------------------------------------------------------------ custo */

export function useMetricCosts(window: MetricWindowRecord): UseQueryResult<MetricCostsRecord> {
  return useQuery({
    queryKey: metricKeys.costs(window),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/metrics/costs", {
        params: { query: { window } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler os custos");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

/* ------------------------------------------------------- a quebra de um Run */

/**
 * A quebra de um Run, que só existe depois do fim **e** do projetor.
 *
 * O `404` daqui não é erro de tela: é "ainda não medido", e a aba mostra a
 * frase em vez da mensagem de falha. Por isso a query devolve `null` no `404`
 * em vez de lançar — um `retry` num `404` seria bater na mesma porta fechada
 * três vezes.
 */
export function useRunMetrics(runId: string): UseQueryResult<RunMetricsRecord | null> {
  return useQuery({
    queryKey: metricKeys.run(runId),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/runs/{id}/metrics", {
        params: { path: { id: runId } },
      });
      if (response.status === 404) return null;
      if (data === undefined) fail(error, response.status, "Não foi possível ler as medidas");
      return data;
    },
  });
}

/* ------------------------------------------------------------------ preço */

export function useModelPrices(): UseQueryResult<ModelPriceListRecord> {
  return useQuery({
    queryKey: metricKeys.prices,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/model-prices");
      if (data === undefined) fail(error, response.status, "Não foi possível ler os preços");
      return data;
    },
  });
}

/** O histórico de um Model. `null` desliga a consulta enquanto ninguém o abriu. */
export function useModelPriceHistory(modelId: string | null): UseQueryResult<ModelPriceListRecord> {
  return useQuery({
    queryKey: metricKeys.priceHistory(modelId ?? ""),
    enabled: modelId !== null,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/models/{id}/prices", {
        params: { path: { id: modelId ?? "" } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o histórico");
      return data;
    },
  });
}

export interface SetModelPriceInput extends SetModelPriceBody {
  readonly modelId: string;
}

/**
 * Abre uma vigência nova de preço.
 *
 * O sucesso invalida **todas** as métricas, e não só a lista de preços: gravar
 * um preço recalcula o rollup dos dias em que aquele Model apareceu, então o
 * custo que estava `NOT_MEASURED` na tela passa a `PRICED` sem recarregar.
 */
export function useSetModelPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ modelId, ...body }: SetModelPriceInput): Promise<ModelPriceRecord> => {
      const { data, error, response } = await api.PUT("/api/v1/models/{id}/price", {
        params: { path: { id: modelId } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível gravar o preço");
      return data;
    },
    onSuccess: () => {
      invalidateMetrics(queryClient);
    },
  });
}

/* ----------------------------------------------------------------- Workers */

export function useWorkers(): UseQueryResult<WorkerListRecord> {
  return useQuery({
    queryKey: metricKeys.workers,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/workers");
      if (data === undefined) fail(error, response.status, "Não foi possível ler os Workers");
      return data;
    },
  });
}

/* --------------------------------------------------------------- rótulos */

/**
 * O texto de uma chave de dimensão, já resolvido no tema ativo.
 *
 * Três dimensões chegam como valor de enum (`USER`, `BUG`, `DOCKER`) e são
 * traduzidas aqui; as outras chegam com o nome atual da entidade, resolvido
 * pela API na leitura, e esse nome passa direto.
 *
 * `EXECUTION_MODE` carrega junto o aviso do modo sem isolamento: a regra da
 * seção 2 do CLAUDE.md vale também numa legenda de gráfico, onde não há badge
 * para acompanhar o nome.
 */
export function useDimensionLabel(): (
  dimension: MetricDimensionRecord,
  key: string,
  fallback: string,
) => string {
  const { t } = useGlossary();

  return useCallback(
    (dimension, key, fallback) => {
      const glossaryKey = dimensionKeyLabel(dimension, key);
      if (glossaryKey === undefined) return fallback;

      const base = t(glossaryKey);
      if (dimension !== "EXECUTION_MODE" || !(key in EXECUTION_MODE)) return base;

      const { warning } = EXECUTION_MODE[key as keyof typeof EXECUTION_MODE];
      return warning === null ? base : `${base} · ${t(warning)}`;
    },
    [t],
  );
}
