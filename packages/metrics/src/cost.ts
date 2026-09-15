import type { CostStatus } from "@dungeon-master/contracts";

import { knownTokens, type TokenCounts } from "./facts.js";

/**
 * Custo: uma conta simples com uma regra dura.
 *
 * **Nunca existe custo zero por ausência.** Sem preço vigente, sem assinatura
 * declarada ou sem tokens reportados, o resultado é `NOT_MEASURED` com `amount`
 * e `currency` nulos. Um zero em lugar disso seria a pior das respostas: a soma
 * continuaria fechando, o gráfico continuaria desenhando, e o número estaria
 * errado para baixo sem nenhum sinal de que faltou dado.
 *
 * Pela mesma razão, somas só acontecem dentro da mesma moeda. Converter exigiria
 * uma taxa de câmbio, que é um dado externo com data — e um sistema que não tem
 * essa taxa não deve inventá-la.
 */

/** Casas decimais guardadas num valor monetário. Seis, porque preço por token é miúdo. */
export const MONEY_SCALE = 6;

const MONEY_FACTOR = 10 ** MONEY_SCALE;

const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** Arredonda para {@link MONEY_SCALE} casas, meio para cima. */
export function roundMoney(value: number): number {
  return Math.round(value * MONEY_FACTOR) / MONEY_FACTOR;
}

/**
 * Uma vigência de preço, já com os instantes em milissegundos.
 *
 * `effectiveTo` nulo é a vigência corrente. O histórico é append-only: gravar
 * um preço novo fecha a anterior, e é isso que faz o custo de um Run de março
 * continuar usando o preço de março depois de um reajuste em abril.
 */
export interface PriceWindow {
  readonly currency: string;
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion: number;
  readonly cacheWritePerMillion: number;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
}

/** A vigência que valia no instante, ou `null` quando não havia nenhuma. */
export function priceAt(prices: readonly PriceWindow[], atMs: number): PriceWindow | null {
  let escolhida: PriceWindow | null = null;

  for (const price of prices) {
    if (price.effectiveFrom > atMs) continue;
    if (price.effectiveTo !== null && atMs >= price.effectiveTo) continue;
    // Vigências não se sobrepõem por construção, mas escolher a de início mais
    // recente deixa a função correta mesmo com um histórico torto na mão.
    if (escolhida === null || price.effectiveFrom > escolhida.effectiveFrom) escolhida = price;
  }

  return escolhida;
}

export interface RunCost {
  readonly status: CostStatus;
  readonly currency: string | null;
  readonly amount: number | null;
}

export const NOT_MEASURED: RunCost = { status: "NOT_MEASURED", currency: null, amount: null };

/**
 * O custo por token de um Run.
 *
 * Um campo de token ausente entra como zero **na conta** — o harness que
 * reportou entrada e saída mas não cache não cobrou cache —, mas um conjunto
 * inteiramente ausente não entra: ele é `NOT_MEASURED`, com preço ou sem.
 */
export function costOfRun(input: {
  readonly tokens: TokenCounts;
  readonly price: PriceWindow | null;
}): RunCost {
  const { tokens, price } = input;
  if (price === null || !knownTokens(tokens)) return NOT_MEASURED;

  const bruto =
    ((tokens.input ?? 0) * price.inputPerMillion +
      (tokens.output ?? 0) * price.outputPerMillion +
      (tokens.cacheRead ?? 0) * price.cacheReadPerMillion +
      (tokens.cacheWrite ?? 0) * price.cacheWritePerMillion) /
    TOKENS_PER_PRICE_UNIT;

  return { status: "PRICED", currency: price.currency, amount: roundMoney(bruto) };
}

/**
 * A fatia de uma mensalidade que cabe a uma janela.
 *
 * O rateio é **por tokens dentro do mês civil UTC**: a mensalidade do mês é
 * dividida entre os Runs daquele Provider naquele mês, e a janela leva a parte
 * proporcional aos tokens que caem dentro dela. É por isso que este número
 * nunca é gravado por Run — enquanto o mês não fecha, cada Run novo muda a
 * fatia de todos os anteriores.
 *
 * Sem tokens no mês, a fatia é zero: não há como distribuir uma mensalidade
 * entre nenhum Run, e devolver a mensalidade inteira atribuiria a uma janela
 * vazia um custo que ela não gerou.
 */
export function prorateSubscription(input: {
  readonly monthlyCost: number;
  readonly windowTokens: number;
  readonly monthTokens: number;
}): number {
  if (input.monthTokens <= 0 || input.windowTokens <= 0) return 0;
  const fatia = Math.min(input.windowTokens / input.monthTokens, 1);
  return roundMoney(input.monthlyCost * fatia);
}

/**
 * Soma custos por moeda, preservando a procedência.
 *
 * Duas moedas nunca viram uma; `NOT_MEASURED` não vira zero nem some — ele
 * volta como uma entrada própria, com `amount` nulo, para a tela poder dizer
 * "e mais N Runs sem custo medido".
 */
export function sumByCurrency(costs: readonly RunCost[]): RunCost[] {
  const porMoeda = new Map<string, { status: CostStatus; amount: number }>();
  let naoMedidos = 0;

  for (const cost of costs) {
    if (cost.currency === null || cost.amount === null) {
      naoMedidos += 1;
      continue;
    }
    const atual = porMoeda.get(cost.currency);
    if (atual === undefined) {
      porMoeda.set(cost.currency, { status: cost.status, amount: cost.amount });
      continue;
    }
    // Uma moeda que recebeu um valor precificado e um rateado é uma estimativa:
    // o rótulo mais fraco vence, para a tela nunca chamar de exato um total que
    // tem palpite dentro.
    const status: CostStatus =
      atual.status === cost.status ? atual.status : "ESTIMATED_SUBSCRIPTION";
    porMoeda.set(cost.currency, { status, amount: roundMoney(atual.amount + cost.amount) });
  }

  const resultado: RunCost[] = [...porMoeda.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, valor]) => ({ status: valor.status, currency, amount: valor.amount }));

  if (naoMedidos > 0) resultado.push(NOT_MEASURED);

  return resultado;
}
