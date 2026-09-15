import type {
  MetricCosts,
  MetricDimension,
  MetricSeries,
  MetricWindow,
  MetricsOverview,
  ModelCost,
  Money,
  ProviderCost,
  RunMetrics,
  SeriesMetric,
} from "@dungeon-master/contracts";
import {
  average,
  buildSeries,
  EMPTY_DAILY_MEASURES,
  costOfRun,
  monthBounds,
  monthOf,
  prorateSubscription,
  rollupDaily,
  roundMoney,
  successRate,
  sumMeasures,
  utcDay,
  windowRange,
  type DailyBucket,
  type DailyMeasures,
  type PriceWindow,
  type PricedRun,
  type RunMetricFacts,
  type TokenCounts,
} from "@dungeon-master/metrics";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { DatabaseExecutor } from "./dashboard-event.js";
import { loadPriceIndex, modelPriceKey } from "./metric-projector.js";
import { harnesses, models } from "./schema/execution.js";
import { metricDaily, runMetrics } from "./schema/metrics.js";
import { providers } from "./schema/registry.js";
import { countWorkersByStatus } from "./worker.js";

/**
 * A leitura das métricas (planejamento v0.4, Fase 10A).
 *
 * Tudo aqui sai de `metric_daily` e de `run_metric`, que o projetor mantém.
 * Nada recalcula o passado por conta própria — com uma exceção declarada, o
 * filtro por Project, explicada em {@link loadBuckets}.
 *
 * ## O custo é montado na leitura, e nunca some
 *
 * O custo por token já vem somado no rollup, por moeda. O rateio de assinatura
 * **não**: a fatia de um Provider muda a cada Run do mês, então gravá-la por
 * Run seria gravar um número que nasce errado. Ele é calculado aqui, sobre os
 * totais do mês civil UTC, e sai rotulado `ESTIMATED_SUBSCRIPTION`.
 *
 * O que não tem preço nem assinatura sai `NOT_MEASURED`, com `amount` nulo e
 * uma contagem de Runs ao lado. Nunca zero: um zero somado fecharia a conta e
 * estaria errado para baixo sem nenhum sinal.
 */

// --------------------------------------------------------------------------
// Baldes: a fonte única das três leituras agregadas
// --------------------------------------------------------------------------

function medidasDaLinha(row: typeof metricDaily.$inferSelect): DailyMeasures {
  return {
    runsTotal: row.runsTotal,
    runsSucceeded: row.runsSucceeded,
    runsFailed: row.runsFailed,
    runsTimedOut: row.runsTimedOut,
    runsCancelled: row.runsCancelled,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    tokensKnownRuns: row.tokensKnownRuns,
    durationMsTotal: row.durationMsTotal,
    durationMsMax: row.durationMsMax,
    durationRuns: row.durationRuns,
    toolCalls: row.toolCalls,
    costByCurrency: row.costByCurrency,
    pricedRuns: row.pricedRuns,
    unpricedRuns: row.unpricedRuns,
  };
}

/**
 * Os baldes diários da janela, em todas as dimensões.
 *
 * Sem filtro de Project, vêm prontos de `metric_daily`.
 *
 * **Com** filtro de Project, são recalculados em memória a partir de
 * `run_metric`. `metric_daily` não tem dimensão cruzada — não existe uma linha
 * "deste Project, por Harness" —, e inventá-la multiplicaria a tabela por todas
 * as combinações para servir uma tela que filtra por um Project de cada vez. O
 * recálculo usa **a mesma função pura** do projetor, sobre as mesmas linhas, o
 * que garante que os dois caminhos não divirjam: o que muda é de onde as linhas
 * vêm, não como são somadas.
 */
async function loadBuckets(
  db: DatabaseExecutor,
  input: { userId: string; days: readonly string[]; projectId?: string | null },
): Promise<DailyBucket[]> {
  const dias = [...input.days];
  const projectId = input.projectId ?? null;

  if (projectId === null) {
    const rows = await db
      .select()
      .from(metricDaily)
      .where(and(eq(metricDaily.userId, input.userId), inArray(metricDaily.day, dias)));

    return rows.map((row) => ({
      day: row.day,
      dimension: row.dimension,
      dimensionKey: row.dimensionKey,
      measures: medidasDaLinha(row),
    }));
  }

  const precos = await loadPriceIndex(db, { userId: input.userId });

  const rows = await db
    .select()
    .from(runMetrics)
    .where(
      and(
        eq(runMetrics.userId, input.userId),
        eq(runMetrics.projectId, projectId),
        inArray(runMetrics.day, dias),
      ),
    );

  const priced: PricedRun[] = rows.map((row) => {
    const tokens: TokenCounts = {
      input: row.inputTokens,
      output: row.outputTokens,
      cacheRead: row.cacheReadTokens,
      cacheWrite: row.cacheWriteTokens,
    };
    const facts: RunMetricFacts = {
      runId: row.runId,
      projectId: row.projectId,
      taskKind: row.taskKind,
      harnessKey: row.harnessKey,
      modelKey: row.modelKey,
      providerId: row.providerId,
      loadoutId: row.loadoutId,
      executionMode: row.executionMode,
      createdBy: row.createdBy,
      status: row.status,
      day: row.day,
      durationMs: row.durationMs,
      tokens,
      toolCalls: row.toolCalls,
    };
    const price = pricedAt(precos, row.harnessKey, row.modelKey, row.finishedAt);
    return { facts, cost: costOfRun({ tokens, price }) };
  });

  return rollupDaily(priced);
}

function pricedAt(
  precos: Map<string, PriceWindow[]>,
  harnessKey: string,
  modelKey: string | null,
  at: Date,
): PriceWindow | null {
  const vigencias = precos.get(modelPriceKey(harnessKey, modelKey));
  if (vigencias === undefined) return null;
  let escolhida: PriceWindow | null = null;
  const instante = at.getTime();
  for (const price of vigencias) {
    if (price.effectiveFrom > instante) continue;
    if (price.effectiveTo !== null && instante >= price.effectiveTo) continue;
    if (escolhida === null || price.effectiveFrom > escolhida.effectiveFrom) escolhida = price;
  }
  return escolhida;
}

/** As medidas de uma dimensão, somadas sobre a janela. */
function totalDaDimensao(
  buckets: readonly DailyBucket[],
  dimension: MetricDimension,
  key?: string,
): DailyMeasures {
  return sumMeasures(
    buckets
      .filter(
        (balde) =>
          balde.dimension === dimension && (key === undefined || balde.dimensionKey === key),
      )
      .map((balde) => balde.measures),
  );
}

// --------------------------------------------------------------------------
// Custo
// --------------------------------------------------------------------------

function tokensDe(measures: DailyMeasures): number {
  return (
    measures.inputTokens +
    measures.outputTokens +
    measures.cacheReadTokens +
    measures.cacheWriteTokens
  );
}

function dinheiroPorToken(measures: DailyMeasures): Money {
  const moedas = Object.entries(measures.costByCurrency).filter(([, valor]) => valor > 0);
  const primeira = moedas[0];
  if (primeira === undefined) return { status: "NOT_MEASURED", currency: null, amount: null };
  // Um Model pertence a um Provider, e um Provider cobra numa moeda. Duas
  // moedas no mesmo agrupamento só acontecem se o preço mudou de moeda no meio
  // da janela; nesse caso a maior soma é a que representa o agrupamento, e o
  // rótulo cai para estimativa porque a outra ficou de fora.
  if (moedas.length === 1) {
    return { status: "PRICED", currency: primeira[0], amount: roundMoney(primeira[1]) };
  }
  const maior = moedas.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { status: "ESTIMATED_SUBSCRIPTION", currency: maior[0], amount: roundMoney(maior[1]) };
}

interface SubscriptionProvider {
  readonly id: string;
  readonly monthlyCost: number;
  readonly currency: string;
}

/**
 * O rateio da mensalidade de um Provider sobre a janela, mês a mês.
 *
 * Para cada mês civil UTC que a janela toca, a fatia é
 * `tokens do Provider dentro da janela ÷ tokens do Provider no mês inteiro`.
 * É por isso que a leitura precisa dos totais do mês fechado, e não só da
 * janela: uma janela de sete dias no meio de um mês leva a fatia dela, não a
 * mensalidade toda.
 */
async function prorateProvider(
  db: DatabaseExecutor,
  input: {
    userId: string;
    provider: SubscriptionProvider;
    days: readonly string[];
    buckets: readonly DailyBucket[];
  },
): Promise<ProviderCost["months"]> {
  const meses = new Map<string, { windowTokens: number; days: Set<string> }>();

  for (const day of input.days) {
    const mes = monthOf(day);
    const atual = meses.get(mes) ?? { windowTokens: 0, days: new Set<string>() };
    atual.days.add(day);
    meses.set(mes, atual);
  }

  for (const balde of input.buckets) {
    if (balde.dimension !== "PROVIDER" || balde.dimensionKey !== input.provider.id) continue;
    const mes = meses.get(monthOf(balde.day));
    if (mes === undefined) continue;
    mes.windowTokens += tokensDe(balde.measures);
  }

  const resultado: ProviderCost["months"] = [];

  for (const [mes, dados] of [...meses.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const limites = monthBounds(`${mes}-01`);
    const { rows } = await db.execute<{ total: string | null }>(
      sql`select sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens)::bigint as total
          from metric_daily d
          where d.user_id = ${input.userId}::uuid
            and d.dimension = 'PROVIDER'
            and d.dimension_key = ${input.provider.id}
            and d.day between ${limites.first}::date and ${limites.last}::date`,
    );

    const monthTokens = Number(rows[0]?.total ?? 0);
    const amount = prorateSubscription({
      monthlyCost: input.provider.monthlyCost,
      windowTokens: dados.windowTokens,
      monthTokens,
    });

    resultado.push({ month: mes, windowTokens: dados.windowTokens, monthTokens, amount });
  }

  return resultado;
}

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------

export interface ReadMetricsInput {
  userId: string;
  window: MetricWindow;
  projectId?: string | null;
  /** Silêncio que torna um Worker `STALE`. Vem da configuração do Worker. */
  staleAfterMs: number;
  now?: Date;
}

/** O p95 vem do banco, por posto: `percentile_disc` devolve uma duração que existiu. */
async function percentil95(
  db: DatabaseExecutor,
  input: { userId: string; days: readonly string[]; projectId: string | null },
): Promise<number | null> {
  const dias = [...input.days];
  const primeiro = dias[0];
  const ultimo = dias[dias.length - 1];
  if (primeiro === undefined || ultimo === undefined) return null;

  const filtroProject =
    input.projectId === null ? sql`` : sql`and m.project_id = ${input.projectId}::uuid`;

  const { rows } = await db.execute<{ p95: string | null }>(
    sql`select percentile_disc(0.95) within group (order by m.duration_ms)::bigint as p95
        from run_metric m
        where m.user_id = ${input.userId}::uuid
          and m.day between ${primeiro}::date and ${ultimo}::date
          and m.duration_ms is not null
          ${filtroProject}`,
  );

  const valor = rows[0]?.p95;
  return valor === null || valor === undefined ? null : Number(valor);
}

export async function readMetricsOverview(
  db: DatabaseExecutor,
  input: ReadMetricsInput,
): Promise<MetricsOverview> {
  const hoje = utcDay(input.now ?? new Date());
  const range = windowRange(input.window, hoje);
  const projectId = input.projectId ?? null;

  const buckets = await loadBuckets(db, {
    userId: input.userId,
    days: range.days,
    projectId,
  });

  const total =
    projectId === null
      ? totalDaDimensao(buckets, "ALL")
      : totalDaDimensao(buckets, "PROJECT", projectId);

  const [p95, workers, disjuntores, custos] = await Promise.all([
    percentil95(db, { userId: input.userId, days: range.days, projectId }),
    countWorkersByStatus(db, {
      userId: input.userId,
      staleAfterMs: input.staleAfterMs,
      ...(input.now === undefined ? {} : { now: input.now }),
    }),
    countOpenCircuitBreakers(db, { userId: input.userId }),
    // O rateio de assinatura só existe no recorte global: `metric_daily` não
    // tem uma dimensão cruzada Project × Provider, e atribuir a mensalidade a
    // um Project pela fatia do Provider inteiro seria um número que não é de
    // ninguém. Com filtro de Project sai o custo por token, e os Runs de
    // assinatura entram na contagem de não medidos.
    projectId === null
      ? totalCosts(db, { userId: input.userId, days: range.days, buckets })
      : Promise.resolve({
          costs: costsFromMeasures(total),
          notMeasuredRuns: total.unpricedRuns,
        }),
  ]);

  return {
    window: input.window,
    from: range.from,
    to: range.to,
    projectId,
    runs: {
      total: total.runsTotal,
      succeeded: total.runsSucceeded,
      failed: total.runsFailed,
      timedOut: total.runsTimedOut,
      cancelled: total.runsCancelled,
      successRate: successRate(total.runsSucceeded, total.runsTotal),
    },
    tokens: {
      input: total.inputTokens,
      output: total.outputTokens,
      cacheRead: total.cacheReadTokens,
      cacheWrite: total.cacheWriteTokens,
      total: tokensDe(total),
      knownRuns: total.tokensKnownRuns,
      unknownRuns: total.runsTotal - total.tokensKnownRuns,
    },
    duration: {
      averageMs: average(total.durationMsTotal, total.durationRuns),
      p95Ms: p95,
      maxMs: total.durationRuns === 0 ? null : total.durationMsMax,
      totalMs: total.durationMsTotal,
      measuredRuns: total.durationRuns,
    },
    costs: custos.costs,
    notMeasuredRuns: custos.notMeasuredRuns,
    openCircuitBreakers: disjuntores,
    workers,
  };
}

function costsFromMeasures(measures: DailyMeasures): Money[] {
  const lista: Money[] = Object.entries(measures.costByCurrency)
    .filter(([, valor]) => valor > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({
      status: "PRICED" as const,
      currency,
      amount: roundMoney(amount),
    }));

  if (measures.unpricedRuns > 0) {
    lista.push({ status: "NOT_MEASURED", currency: null, amount: null });
  }

  return lista;
}

async function countOpenCircuitBreakers(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<number> {
  const { rows } = await db.execute<{ total: number }>(
    sql`select count(*)::int as total from circuit_breaker
        where user_id = ${input.userId}::uuid and enabled = true and state <> 'CLOSED'`,
  );
  return rows[0]?.total ?? 0;
}

// --------------------------------------------------------------------------
// Custos por Provider e por Model
// --------------------------------------------------------------------------

interface CostTotals {
  readonly costs: Money[];
  readonly notMeasuredRuns: number;
}

async function totalCosts(
  db: DatabaseExecutor,
  input: { userId: string; days: readonly string[]; buckets: readonly DailyBucket[] },
): Promise<CostTotals> {
  const detalhe = await buildCosts(db, input);
  return { costs: detalhe.totals, notMeasuredRuns: detalhe.notMeasuredRuns };
}

interface CostsDetail {
  readonly totals: Money[];
  readonly notMeasuredRuns: number;
  readonly providers: ProviderCost[];
  readonly models: ModelCost[];
}

async function buildCosts(
  db: DatabaseExecutor,
  input: { userId: string; days: readonly string[]; buckets: readonly DailyBucket[] },
): Promise<CostsDetail> {
  const cadastro = await db
    .select({
      id: providers.id,
      name: providers.name,
      billingKind: providers.billingKind,
      monthlyCost: providers.monthlyCost,
      currency: providers.currency,
    })
    .from(providers)
    .where(eq(providers.userId, input.userId));

  const porProvider = new Map<string, DailyMeasures>();
  for (const balde of input.buckets) {
    if (balde.dimension !== "PROVIDER") continue;
    porProvider.set(
      balde.dimensionKey,
      sumMeasures([porProvider.get(balde.dimensionKey) ?? EMPTY_DAILY_MEASURES, balde.measures]),
    );
  }

  const providerCosts: ProviderCost[] = [];
  let naoMedidos = totalDaDimensao(input.buckets, "ALL").unpricedRuns;

  for (const [providerId, measures] of porProvider) {
    const registro = cadastro.find((linha) => linha.id === providerId);
    const assinatura =
      registro?.billingKind === "SUBSCRIPTION" && registro.monthlyCost !== null
        ? {
            id: providerId,
            monthlyCost: Number(registro.monthlyCost),
            currency: registro.currency ?? "",
          }
        : null;

    if (assinatura !== null && assinatura.currency !== "") {
      const months = await prorateProvider(db, {
        userId: input.userId,
        provider: assinatura,
        days: input.days,
        buckets: input.buckets,
      });
      const amount = roundMoney(months.reduce((soma, mes) => soma + mes.amount, 0));

      // O Provider de assinatura não soma preço por token: o que se paga é a
      // mensalidade, e cobrar as duas coisas contaria o mesmo gasto duas vezes.
      naoMedidos -= measures.unpricedRuns;

      providerCosts.push({
        providerId,
        providerName: registro?.name ?? null,
        billingKind: registro?.billingKind ?? null,
        monthlyCost: assinatura.monthlyCost,
        runs: measures.runsTotal,
        tokens: tokensDe(measures),
        cost: {
          status: "ESTIMATED_SUBSCRIPTION",
          currency: assinatura.currency,
          amount,
        },
        months,
      });
      continue;
    }

    providerCosts.push({
      providerId,
      providerName: registro?.name ?? null,
      billingKind: registro?.billingKind ?? null,
      monthlyCost:
        registro?.monthlyCost === null || registro === undefined
          ? null
          : Number(registro.monthlyCost),
      runs: measures.runsTotal,
      tokens: tokensDe(measures),
      cost: dinheiroPorToken(measures),
      months: [],
    });
  }

  // ------------------------------------------------------------------ models
  const porModel = new Map<string, DailyMeasures>();
  for (const balde of input.buckets) {
    if (balde.dimension !== "MODEL") continue;
    porModel.set(
      balde.dimensionKey,
      sumMeasures([porModel.get(balde.dimensionKey) ?? EMPTY_DAILY_MEASURES, balde.measures]),
    );
  }

  const chaves = [...porModel.keys()];
  const cadastroModels =
    chaves.length === 0
      ? []
      : await db
          .select({
            id: models.id,
            key: models.key,
            name: models.name,
            providerId: models.providerId,
            harnessKey: harnesses.key,
          })
          .from(models)
          .innerJoin(harnesses, eq(harnesses.id, models.harnessId))
          .where(and(eq(models.userId, input.userId), inArray(models.key, chaves)))
          .orderBy(harnesses.key, models.id);

  const modelCosts: ModelCost[] = [...porModel.entries()].map(([modelKey, measures]) => {
    // A chave de Model é única **por Harness**; duas Guildas podem oferecer a
    // mesma. A dimensão do rollup é a chave, então aqui o desempate é
    // determinístico (a primeira em ordem de Harness) e o nome pode ser o do
    // Model homônimo — o custo, que é o que a coluna mede, continua certo.
    const registro = cadastroModels.find((linha) => linha.key === modelKey);
    const provider = cadastro.find((linha) => linha.id === registro?.providerId);
    return {
      modelKey,
      modelId: registro?.id ?? null,
      modelName: registro?.name ?? null,
      providerId: registro?.providerId ?? null,
      providerName: provider?.name ?? null,
      runs: measures.runsTotal,
      tokens: tokensDe(measures),
      cost: dinheiroPorToken(measures),
    };
  });

  // ------------------------------------------------------------------ totais
  //
  // O total **não** é a soma dos Providers: um Run cujo Model não aponta para
  // Provider nenhum tem custo por token e não aparece em nenhuma linha de
  // Provider. Somar só os Providers deixaria esse gasto de fora em silêncio —
  // que é exatamente o tipo de zero que esta fase existe para não produzir.
  //
  // O total sai da dimensão `ALL`, que conta todo Run, e cada Provider de
  // assinatura **troca** ali a sua parcela por token pelo rateio da
  // mensalidade: cobrar as duas coisas contaria o mesmo gasto duas vezes.
  const geral = totalDaDimensao(input.buckets, "ALL");
  const acumulado = new Map<string, Money>();

  for (const [moeda, valor] of Object.entries(geral.costByCurrency)) {
    if (valor > 0) acumulado.set(moeda, { status: "PRICED", currency: moeda, amount: valor });
  }

  for (const entrada of providerCosts) {
    if (entrada.cost.status !== "ESTIMATED_SUBSCRIPTION") continue;
    const medidas = porProvider.get(entrada.providerId ?? "");
    if (medidas !== undefined) {
      for (const [moeda, valor] of Object.entries(medidas.costByCurrency)) {
        const atual = acumulado.get(moeda);
        if (atual?.amount == null) continue;
        acumulado.set(moeda, { ...atual, amount: atual.amount - valor });
      }
    }
    const moeda = entrada.cost.currency;
    if (moeda === null || entrada.cost.amount === null) continue;
    const atual = acumulado.get(moeda);
    acumulado.set(moeda, {
      status: "ESTIMATED_SUBSCRIPTION",
      currency: moeda,
      amount: (atual?.amount ?? 0) + entrada.cost.amount,
    });
  }

  const totals: Money[] = [...acumulado.values()]
    .filter((dinheiro) => (dinheiro.amount ?? 0) > 0)
    .map((dinheiro) => ({ ...dinheiro, amount: roundMoney(dinheiro.amount ?? 0) }))
    .sort((a, b) => (a.currency ?? "").localeCompare(b.currency ?? ""));

  if (naoMedidos > 0) totals.push({ status: "NOT_MEASURED", currency: null, amount: null });

  return {
    totals,
    notMeasuredRuns: Math.max(naoMedidos, 0),
    providers: providerCosts.sort((a, b) => (b.cost.amount ?? 0) - (a.cost.amount ?? 0)),
    models: modelCosts.sort((a, b) => (b.cost.amount ?? 0) - (a.cost.amount ?? 0)),
  };
}

export async function readMetricCosts(
  db: DatabaseExecutor,
  input: { userId: string; window: MetricWindow; now?: Date },
): Promise<MetricCosts> {
  const hoje = utcDay(input.now ?? new Date());
  const range = windowRange(input.window, hoje);
  const buckets = await loadBuckets(db, { userId: input.userId, days: range.days });
  const detalhe = await buildCosts(db, {
    userId: input.userId,
    days: range.days,
    buckets,
  });

  return {
    window: input.window,
    from: range.from,
    to: range.to,
    totals: detalhe.totals,
    notMeasuredRuns: detalhe.notMeasuredRuns,
    providers: detalhe.providers,
    models: detalhe.models,
  };
}

// --------------------------------------------------------------------------
// Séries
// --------------------------------------------------------------------------

export interface ReadMetricSeriesInput {
  userId: string;
  metric: SeriesMetric;
  dimension: MetricDimension;
  window: MetricWindow;
  projectId?: string | null;
  currency?: string | undefined;
  now?: Date;
}

function valorDaMedida(
  metric: SeriesMetric,
  measures: DailyMeasures,
  currency: string | null,
): number {
  switch (metric) {
    case "runs":
      return measures.runsTotal;
    case "tokens":
      return tokensDe(measures);
    case "duration":
      return measures.durationMsTotal;
    case "cost":
      return currency === null ? 0 : roundMoney(measures.costByCurrency[currency] ?? 0);
  }
}

function unidadeDa(metric: SeriesMetric, currency: string | null): string {
  switch (metric) {
    case "runs":
      return "runs";
    case "tokens":
      return "tokens";
    case "duration":
      return "ms";
    case "cost":
      return currency ?? "";
  }
}

export async function readMetricSeries(
  db: DatabaseExecutor,
  input: ReadMetricSeriesInput,
): Promise<MetricSeries> {
  const hoje = utcDay(input.now ?? new Date());
  const range = windowRange(input.window, hoje);
  const projectId = input.projectId ?? null;

  const buckets = await loadBuckets(db, {
    userId: input.userId,
    days: range.days,
    projectId,
  });

  const daDimensao = buckets.filter((balde) => balde.dimension === input.dimension);

  // A moeda da série de custo: a pedida, ou a de maior gasto na janela. Sem
  // nenhuma moeda com custo, a série sai zerada e `currency` vem nula — o que
  // a tela lê como "nada foi precificado", e não como "custou zero".
  let currency: string | null = input.currency ?? null;
  if (input.metric === "cost" && currency === null) {
    const somas = new Map<string, number>();
    for (const balde of daDimensao) {
      for (const [moeda, valor] of Object.entries(balde.measures.costByCurrency)) {
        somas.set(moeda, (somas.get(moeda) ?? 0) + valor);
      }
    }
    const maior = [...somas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    currency = maior?.[0] ?? null;
  }

  const valores = new Map<string, Map<string, number>>();
  for (const balde of daDimensao) {
    const porDia = valores.get(balde.dimensionKey) ?? new Map<string, number>();
    porDia.set(balde.day, valorDaMedida(input.metric, balde.measures, currency));
    valores.set(balde.dimensionKey, porDia);
  }

  const linhas = buildSeries({ days: range.days, values: valores });
  const rotulos = await resolveDimensionLabels(db, {
    userId: input.userId,
    dimension: input.dimension,
    keys: linhas.map((linha) => linha.key),
  });

  return {
    metric: input.metric,
    dimension: input.dimension,
    window: input.window,
    from: range.from,
    to: range.to,
    projectId,
    currency: input.metric === "cost" ? currency : null,
    unit: unidadeDa(input.metric, currency),
    series: linhas.map((linha) => ({
      key: linha.key,
      label: rotulos.get(linha.key) ?? linha.key,
      total: linha.total,
      points: [...linha.points],
    })),
  };
}

/**
 * O nome atual da entidade de cada chave, resolvido na leitura.
 *
 * Na leitura, e não gravado no rollup: uma Campanha renomeada precisa aparecer
 * com o nome novo em toda a série, inclusive nos dias anteriores à renomeação.
 * Uma chave que não resolve — entidade apagada — volta como a própria chave, e
 * quem chama a usa como rótulo.
 */
async function resolveDimensionLabels(
  db: DatabaseExecutor,
  input: { userId: string; dimension: MetricDimension; keys: readonly string[] },
): Promise<Map<string, string>> {
  const rotulos = new Map<string, string>();
  if (input.keys.length === 0) return rotulos;

  const chaves = [...input.keys];

  const consulta = (texto: ReturnType<typeof sql>): Promise<{ id: string; name: string }[]> =>
    db.execute<{ id: string; name: string }>(texto).then((resultado) => resultado.rows);

  const lista = sql.join(
    chaves.map((chave) => sql`${chave}`),
    sql`, `,
  );

  let linhas: { id: string; name: string }[] = [];

  switch (input.dimension) {
    case "PROJECT":
      linhas = await consulta(
        sql`select p.id::text as id, p.title as name from project p
            where p.user_id = ${input.userId}::uuid and p.id::text in (${lista})`,
      );
      break;
    case "LOADOUT":
      linhas = await consulta(
        sql`select l.id::text as id, l.name from loadout l
            where l.user_id = ${input.userId}::uuid and l.id::text in (${lista})`,
      );
      break;
    case "PROVIDER":
      linhas = await consulta(
        sql`select pr.id::text as id, pr.name from provider pr
            where pr.user_id = ${input.userId}::uuid and pr.id::text in (${lista})`,
      );
      break;
    case "HARNESS":
      linhas = await consulta(
        sql`select h.key::text as id, h.name from harness h
            where h.user_id = ${input.userId}::uuid and h.key::text in (${lista})`,
      );
      break;
    case "MODEL":
      linhas = await consulta(
        sql`select distinct on (m.key) m.key as id, m.name from model m
            where m.user_id = ${input.userId}::uuid and m.key in (${lista})
            order by m.key, m.id`,
      );
      break;
    // `ALL`, `CREATED_BY`, `TASK_KIND` e `EXECUTION_MODE` são valores de enum:
    // a chave **é** o rótulo canônico, e a tradução é assunto do glossário da
    // web. Traduzir aqui colocaria texto de interface na API.
    case "ALL":
    case "CREATED_BY":
    case "TASK_KIND":
    case "EXECUTION_MODE":
      break;
  }

  for (const linha of linhas) rotulos.set(linha.id, linha.name);
  return rotulos;
}

// --------------------------------------------------------------------------
// A quebra de um Run
// --------------------------------------------------------------------------

export async function readRunMetrics(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<RunMetrics | null> {
  const [row] = await db
    .select()
    .from(runMetrics)
    .where(and(eq(runMetrics.userId, input.userId), eq(runMetrics.runId, input.runId)));

  if (row === undefined) return null;

  const precos = await loadPriceIndex(db, { userId: input.userId });
  const tokens: TokenCounts = {
    input: row.inputTokens,
    output: row.outputTokens,
    cacheRead: row.cacheReadTokens,
    cacheWrite: row.cacheWriteTokens,
  };
  const price = pricedAt(precos, row.harnessKey, row.modelKey, row.finishedAt);
  const custoPorToken = costOfRun({ tokens, price });

  const [provider] =
    row.providerId === null
      ? []
      : await db
          .select({
            name: providers.name,
            billingKind: providers.billingKind,
            monthlyCost: providers.monthlyCost,
            currency: providers.currency,
          })
          .from(providers)
          .where(and(eq(providers.userId, input.userId), eq(providers.id, row.providerId)));

  // O rateio de assinatura é do **mês**, não de um Run: um Run sozinho não tem
  // uma fatia estável. O que a quebra de um Run mostra, num Provider de
  // assinatura, é a fatia dele no mês corrente — calculada agora, e rotulada
  // como estimativa.
  let cost = custoPorToken;
  if (provider?.billingKind === "SUBSCRIPTION" && provider.monthlyCost !== null) {
    const amount = await rateioDoRun(db, {
      userId: input.userId,
      providerId: row.providerId ?? "",
      day: row.day,
      runTokens:
        (tokens.input ?? 0) +
        (tokens.output ?? 0) +
        (tokens.cacheRead ?? 0) +
        (tokens.cacheWrite ?? 0),
      monthlyCost: Number(provider.monthlyCost),
    });
    cost =
      amount === null
        ? { status: "NOT_MEASURED", currency: null, amount: null }
        : { status: "ESTIMATED_SUBSCRIPTION", currency: provider.currency, amount };
  }

  const total =
    tokens.input === null &&
    tokens.output === null &&
    tokens.cacheRead === null &&
    tokens.cacheWrite === null
      ? null
      : (tokens.input ?? 0) +
        (tokens.output ?? 0) +
        (tokens.cacheRead ?? 0) +
        (tokens.cacheWrite ?? 0);

  return {
    runId: row.runId,
    status: row.status,
    taskId: row.taskId,
    taskKind: row.taskKind,
    projectId: row.projectId,
    harnessKey: row.harnessKey,
    modelKey: row.modelKey,
    providerId: row.providerId,
    providerName: provider?.name ?? null,
    loadoutId: row.loadoutId,
    loadoutVersion: row.loadoutVersion,
    executionMode: row.executionMode,
    createdBy: row.createdBy,
    parentRunId: row.parentRunId,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt.toISOString(),
    durationMs: row.durationMs,
    queueMs: row.queueMs,
    tokens: { ...tokens, total, known: row.tokensKnown },
    context: {
      estimatedTokens: row.contextTokens,
      items: row.contextItems,
      sections: row.contextSections,
      truncations: row.contextTruncations,
    },
    toolCalls: {
      total: row.toolCalls,
      byServer: Object.entries(row.toolCallsByServer)
        .map(([server, calls]) => ({ server, calls }))
        .sort((a, b) => b.calls - a.calls || a.server.localeCompare(b.server)),
    },
    steps: Object.entries(row.stepsByType)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    gates: {
      grantedByUser: row.gatesGrantedUser,
      grantedByPolicy: row.gatesGrantedPolicy,
    },
    childrenDelegated: row.childrenDelegated,
    cost,
  };
}

async function rateioDoRun(
  db: DatabaseExecutor,
  input: {
    userId: string;
    providerId: string;
    day: string;
    runTokens: number;
    monthlyCost: number;
  },
): Promise<number | null> {
  if (input.runTokens <= 0) return null;

  const limites = monthBounds(input.day);
  const { rows } = await db.execute<{ total: string | null }>(
    sql`select sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens)::bigint as total
        from metric_daily d
        where d.user_id = ${input.userId}::uuid
          and d.dimension = 'PROVIDER'
          and d.dimension_key = ${input.providerId}
          and d.day between ${limites.first}::date and ${limites.last}::date`,
  );

  const monthTokens = Number(rows[0]?.total ?? 0);
  if (monthTokens <= 0) return null;

  return prorateSubscription({
    monthlyCost: input.monthlyCost,
    windowTokens: input.runTokens,
    monthTokens,
  });
}

/** Os dias em que há métrica, para o `dm metrics status` e para teste. */
export async function countRunMetrics(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<{ runs: number; buckets: number }> {
  const { rows } = await db.execute<{ runs: number; buckets: number }>(
    sql`select
          (select count(*)::int from run_metric where user_id = ${input.userId}::uuid) as runs,
          (select count(*)::int from metric_daily where user_id = ${input.userId}::uuid) as buckets`,
  );
  return { runs: rows[0]?.runs ?? 0, buckets: rows[0]?.buckets ?? 0 };
}
