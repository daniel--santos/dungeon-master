import { METRIC_DIMENSION_ALL_KEY, type MetricDimension } from "@dungeon-master/contracts";

import type { RunMetricFacts } from "./facts.js";

/**
 * Por quais eixos um Run entra no rollup diário.
 *
 * ## Uma dimensão sem valor não vira linha
 *
 * Um Run de uma Task sem Project, ou de um Loadout sem Model, **não** produz
 * linha em `PROJECT` nem em `MODEL`. A alternativa seria inventar uma chave
 * ("(sem Project)") e ela viraria uma entidade fantasma na tela, ordenada junto
 * das reais e clicável para lugar nenhum.
 *
 * É por isso que `ALL` é uma dimensão própria, e não a soma das outras: somar
 * `PROJECT` para chegar ao total daria menos Runs do que houve, e ninguém
 * notaria até alguém conferir na mão.
 */
export interface DimensionEntry {
  readonly dimension: MetricDimension;
  readonly key: string;
}

export function dimensionsOf(facts: RunMetricFacts): DimensionEntry[] {
  const entradas: DimensionEntry[] = [
    { dimension: "ALL", key: METRIC_DIMENSION_ALL_KEY },
    { dimension: "HARNESS", key: facts.harnessKey },
    { dimension: "LOADOUT", key: facts.loadoutId },
    { dimension: "CREATED_BY", key: facts.createdBy },
    { dimension: "TASK_KIND", key: facts.taskKind },
    { dimension: "EXECUTION_MODE", key: facts.executionMode },
  ];

  if (facts.projectId !== null) entradas.push({ dimension: "PROJECT", key: facts.projectId });
  if (facts.modelKey !== null) entradas.push({ dimension: "MODEL", key: facts.modelKey });
  if (facts.providerId !== null) entradas.push({ dimension: "PROVIDER", key: facts.providerId });

  return entradas;
}

/** A chave composta de uma linha de `metric_daily`, para agrupar em memória. */
export function bucketKey(day: string, dimension: MetricDimension, key: string): string {
  return `${day}|${dimension}|${key}`;
}
