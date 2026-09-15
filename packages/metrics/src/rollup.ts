import type { MetricDimension } from "@dungeon-master/contracts";

import { roundMoney, type RunCost } from "./cost.js";
import { bucketKey, dimensionsOf } from "./dimensions.js";
import { knownTokens, type RunMetricFacts } from "./facts.js";

/**
 * O rollup diário: `run_metric` dobrado em `metric_daily`.
 *
 * ## Por que o rollup é **derivado**, e não incremental
 *
 * Um rollup incremental — somar o Run no dia dele e seguir — parece mais
 * barato e é uma armadilha: o custo de um Run depende do preço vigente, e um
 * preço cadastrado hoje muda o custo de Runs de ontem. Com soma incremental o
 * único jeito de corrigir seria reconstruir tudo.
 *
 * Aqui `metric_daily` é sempre **recalculado a partir das linhas de
 * `run_metric` daquele dia**. Um lote do projetor recalcula os dias que tocou;
 * um preço novo recalcula os dias do Model. Nos dois casos a conta é a mesma
 * função, sobre os mesmos dados, e é por isso que `rebuild` reproduz linha por
 * linha o que a projeção ao vivo produziu.
 *
 * Um dia tem dezenas a centenas de Runs; refazer a soma dele é barato, e o que
 * se compra com isso é não ter duas verdades sobre o mesmo número.
 */

export interface DailyMeasures {
  readonly runsTotal: number;
  readonly runsSucceeded: number;
  readonly runsFailed: number;
  readonly runsTimedOut: number;
  readonly runsCancelled: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** Quantos Runs reportaram tokens. O denominador honesto das quatro somas acima. */
  readonly tokensKnownRuns: number;
  readonly durationMsTotal: number;
  readonly durationMsMax: number;
  /** Runs com duração conhecida. Sem ele a média dividiria por Runs que nunca começaram. */
  readonly durationRuns: number;
  readonly toolCalls: number;
  /** Custo por token, por moeda. Moedas diferentes nunca se somam. */
  readonly costByCurrency: Readonly<Record<string, number>>;
  readonly pricedRuns: number;
  readonly unpricedRuns: number;
}

export const EMPTY_DAILY_MEASURES: DailyMeasures = {
  runsTotal: 0,
  runsSucceeded: 0,
  runsFailed: 0,
  runsTimedOut: 0,
  runsCancelled: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  tokensKnownRuns: 0,
  durationMsTotal: 0,
  durationMsMax: 0,
  durationRuns: 0,
  toolCalls: 0,
  costByCurrency: {},
  pricedRuns: 0,
  unpricedRuns: 0,
};

/** Uma Expedição terminal com o custo que ela teve na data dela. */
export interface PricedRun {
  readonly facts: RunMetricFacts;
  readonly cost: RunCost;
}

export interface DailyBucket {
  readonly day: string;
  readonly dimension: MetricDimension;
  readonly dimensionKey: string;
  readonly measures: DailyMeasures;
}

/** Soma um Run às medidas. Puro: devolve as medidas novas. */
export function addRun(measures: DailyMeasures, run: PricedRun): DailyMeasures {
  const { facts, cost } = run;
  const conhecidos = knownTokens(facts.tokens);

  const custos = { ...measures.costByCurrency };
  if (cost.currency !== null && cost.amount !== null) {
    custos[cost.currency] = roundMoney((custos[cost.currency] ?? 0) + cost.amount);
  }

  return {
    runsTotal: measures.runsTotal + 1,
    runsSucceeded: measures.runsSucceeded + (facts.status === "SUCCEEDED" ? 1 : 0),
    runsFailed: measures.runsFailed + (facts.status === "FAILED" ? 1 : 0),
    runsTimedOut: measures.runsTimedOut + (facts.status === "TIMED_OUT" ? 1 : 0),
    runsCancelled: measures.runsCancelled + (facts.status === "CANCELLED" ? 1 : 0),
    inputTokens: measures.inputTokens + (facts.tokens.input ?? 0),
    outputTokens: measures.outputTokens + (facts.tokens.output ?? 0),
    cacheReadTokens: measures.cacheReadTokens + (facts.tokens.cacheRead ?? 0),
    cacheWriteTokens: measures.cacheWriteTokens + (facts.tokens.cacheWrite ?? 0),
    tokensKnownRuns: measures.tokensKnownRuns + (conhecidos ? 1 : 0),
    durationMsTotal: measures.durationMsTotal + (facts.durationMs ?? 0),
    durationMsMax: Math.max(measures.durationMsMax, facts.durationMs ?? 0),
    durationRuns: measures.durationRuns + (facts.durationMs === null ? 0 : 1),
    toolCalls: measures.toolCalls + facts.toolCalls,
    costByCurrency: custos,
    pricedRuns: measures.pricedRuns + (cost.status === "PRICED" ? 1 : 0),
    unpricedRuns: measures.unpricedRuns + (cost.status === "PRICED" ? 0 : 1),
  };
}

/**
 * Dobra os Runs em linhas de `metric_daily`.
 *
 * A saída sai ordenada por `(day, dimension, key)`: duas execuções sobre os
 * mesmos dados produzem exatamente a mesma lista, na mesma ordem, e é isso que
 * torna o teste de "rebuild reproduz" uma comparação direta.
 */
export function rollupDaily(runs: Iterable<PricedRun>): DailyBucket[] {
  const baldes = new Map<
    string,
    { bucket: Omit<DailyBucket, "measures">; measures: DailyMeasures }
  >();

  for (const run of runs) {
    for (const entrada of dimensionsOf(run.facts)) {
      const chave = bucketKey(run.facts.day, entrada.dimension, entrada.key);
      const atual = baldes.get(chave) ?? {
        bucket: {
          day: run.facts.day,
          dimension: entrada.dimension,
          dimensionKey: entrada.key,
        },
        measures: EMPTY_DAILY_MEASURES,
      };
      baldes.set(chave, { bucket: atual.bucket, measures: addRun(atual.measures, run) });
    }
  }

  return [...baldes.values()]
    .map((entrada) => ({ ...entrada.bucket, measures: entrada.measures }))
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.dimension.localeCompare(b.dimension) ||
        a.dimensionKey.localeCompare(b.dimensionKey),
    );
}

/** Soma medidas de dias diferentes, para os tiles de uma janela. */
export function sumMeasures(measures: Iterable<DailyMeasures>): DailyMeasures {
  let total = EMPTY_DAILY_MEASURES;

  for (const medida of measures) {
    const custos = { ...total.costByCurrency };
    for (const [moeda, valor] of Object.entries(medida.costByCurrency)) {
      custos[moeda] = roundMoney((custos[moeda] ?? 0) + valor);
    }

    total = {
      runsTotal: total.runsTotal + medida.runsTotal,
      runsSucceeded: total.runsSucceeded + medida.runsSucceeded,
      runsFailed: total.runsFailed + medida.runsFailed,
      runsTimedOut: total.runsTimedOut + medida.runsTimedOut,
      runsCancelled: total.runsCancelled + medida.runsCancelled,
      inputTokens: total.inputTokens + medida.inputTokens,
      outputTokens: total.outputTokens + medida.outputTokens,
      cacheReadTokens: total.cacheReadTokens + medida.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + medida.cacheWriteTokens,
      tokensKnownRuns: total.tokensKnownRuns + medida.tokensKnownRuns,
      durationMsTotal: total.durationMsTotal + medida.durationMsTotal,
      durationMsMax: Math.max(total.durationMsMax, medida.durationMsMax),
      durationRuns: total.durationRuns + medida.durationRuns,
      toolCalls: total.toolCalls + medida.toolCalls,
      costByCurrency: custos,
      pricedRuns: total.pricedRuns + medida.pricedRuns,
      unpricedRuns: total.unpricedRuns + medida.unpricedRuns,
    };
  }

  return total;
}
