/**
 * As duas contas que a tela de métricas pede e que o SQL não deve improvisar.
 *
 * Ficam aqui, e não num `percentile_cont` solto no meio de uma consulta, porque
 * são regra de leitura: "sem amostra o resultado é nulo, e não zero" vale
 * igual para a média e para o percentil, e vale no banco e em memória.
 */

/**
 * Percentil por **posto mais próximo**, sobre uma amostra já ordenada.
 *
 * Posto mais próximo, e não interpolação linear: o p95 de durações precisa ser
 * a duração de uma Expedição que existiu, não a média entre duas. Um número
 * interpolado é impossível de conferir contra a lista de Runs, e a primeira
 * pergunta de quem vê um p95 alto é "qual Run foi esse?".
 *
 * `null` com amostra vazia. Zero seria a resposta errada: "nenhum Run foi
 * medido" e "todos terminaram instantaneamente" não são a mesma coisa.
 */
export function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  if (fraction <= 0) return sorted[0] ?? null;
  if (fraction >= 1) return sorted[sorted.length - 1] ?? null;

  const posto = Math.ceil(fraction * sorted.length);
  const indice = Math.min(Math.max(posto - 1, 0), sorted.length - 1);
  return sorted[indice] ?? null;
}

/** Média com denominador explícito. `null` quando não houve amostra. */
export function average(total: number, count: number): number | null {
  if (count <= 0) return null;
  return total / count;
}

/** `succeeded / total`, ou `null` quando não houve Run. */
export function successRate(succeeded: number, total: number): number | null {
  if (total <= 0) return null;
  return succeeded / total;
}
