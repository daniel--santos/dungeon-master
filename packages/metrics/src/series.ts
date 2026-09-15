import type { MetricWindow } from "@dungeon-master/contracts";

import { daysEndingAt } from "./day.js";

/**
 * Séries contínuas: um ponto por dia, **inclusive nos dias sem dado**.
 *
 * Um gráfico que só recebe os dias com Run desenha uma linha que pula o fim de
 * semana e mente sobre a inclinação: dois pontos vizinhos no eixo aparentam
 * dias consecutivos quando na verdade há uma semana entre eles. Preencher com
 * zero é o único jeito de a distância visual corresponder à distância no tempo.
 *
 * Zero aqui é um fato, não uma ausência: "nenhum Run neste dia" é verdade. É
 * diferente do custo, onde zero seria mentira — por isso a série de custo só
 * existe dentro de uma moeda, e os Runs sem preço ficam de fora dela e
 * aparecem no contador próprio.
 */

export function windowDays(window: MetricWindow): number {
  switch (window) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
  }
}

export interface DayRange {
  readonly from: string;
  readonly to: string;
  readonly days: readonly string[];
}

/** A janela que termina em `endDay`, inclusive nos dois extremos. */
export function windowRange(window: MetricWindow, endDay: string): DayRange {
  const days = daysEndingAt(endDay, windowDays(window));
  const from = days[0];
  const to = days[days.length - 1];
  if (from === undefined || to === undefined) {
    throw new Error(`A janela ${window} produziu um intervalo vazio.`);
  }
  return { from, to, days };
}

export interface SeriesPoint {
  readonly day: string;
  readonly value: number;
}

export interface SeriesLine {
  readonly key: string;
  readonly total: number;
  readonly points: readonly SeriesPoint[];
}

/**
 * Monta uma linha por chave, com um ponto por dia da janela.
 *
 * As linhas saem da maior soma para a menor, e o desempate é pela chave: uma
 * legenda que troca de ordem entre dois carregamentos do mesmo dado é ruído.
 */
export function buildSeries(input: {
  readonly days: readonly string[];
  /** `chave -> dia -> valor`. Um dia ausente vira zero. */
  readonly values: ReadonlyMap<string, ReadonlyMap<string, number>>;
}): SeriesLine[] {
  const linhas: SeriesLine[] = [];

  for (const [key, porDia] of input.values) {
    const points = input.days.map((day) => ({ day, value: porDia.get(day) ?? 0 }));
    const total = points.reduce((soma, ponto) => soma + ponto.value, 0);
    linhas.push({ key, total, points });
  }

  return linhas.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}
