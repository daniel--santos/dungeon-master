import type {
  BudgetAction,
  BudgetLimitKey,
  BudgetLimits,
  BudgetWindow,
} from "@dungeon-master/contracts";

/**
 * Orçamentos (planejamento v0.4, Fase 9A): janela, avaliação e a decisão
 * sobre um Run novo. Tudo função pura sobre consumo já medido; quem mede é
 * `computeBudgetUsage`, no repositório, e quem decide é este arquivo.
 *
 * **Fail-closed em consumo desconhecido.** Um orçamento com `maxTokens` não
 * libera sobre uma soma que sabe estar incompleta: se algum Run que rodou
 * terminou sem reportar tokens, a decisão é a do teto atingido — `BLOCK`
 * recusa, `WARN` avisa — com o motivo dizendo que faltou medida.
 */

export type CalendarBudgetWindow = Exclude<BudgetWindow, "PER_RUN">;

export interface BudgetWindowBounds {
  readonly start: Date;
  /** Exclusivo. */
  readonly end: Date;
}

/**
 * Os limites de calendário de uma janela, em UTC.
 *
 * `DAY` começa à meia-noite; `WEEK` na segunda-feira (ISO); `MONTH` no dia 1.
 * Calendário, e não deslizante, para que "quantos Runs hoje" seja a mesma
 * pergunta de manhã e à noite, e para que a interface consiga desenhar a
 * janela.
 */
export function budgetWindowBounds(window: CalendarBudgetWindow, now: Date): BudgetWindowBounds {
  const ano = now.getUTCFullYear();
  const mes = now.getUTCMonth();
  const dia = now.getUTCDate();

  switch (window) {
    case "DAY":
      return {
        start: new Date(Date.UTC(ano, mes, dia)),
        end: new Date(Date.UTC(ano, mes, dia + 1)),
      };
    case "WEEK": {
      // `getUTCDay()` dá 0 para domingo; a semana ISO começa na segunda.
      const desdeSegunda = (now.getUTCDay() + 6) % 7;
      const start = new Date(Date.UTC(ano, mes, dia - desdeSegunda));
      return { start, end: new Date(Date.UTC(ano, mes, dia - desdeSegunda + 7)) };
    }
    case "MONTH":
      return { start: new Date(Date.UTC(ano, mes, 1)), end: new Date(Date.UTC(ano, mes + 1, 1)) };
  }
}

/**
 * Os tokens de um Run a partir de `run.result.usage`, ou `null` quando o
 * resultado não permite saber.
 *
 * `totalTokens` vence quando existe; senão a soma dos campos de entrada e
 * saída presentes (o formato do `UsageSummary`, com os de cache). Um `usage`
 * sem número nenhum é consumo desconhecido, e não zero: zero mentiria.
 */
export function runTokenUsage(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const numero = (chave: string): number | null => {
    const valor = u[chave];
    return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : null;
  };

  const total = numero("totalTokens");
  if (total !== null) return total;

  const partes = [
    numero("inputTokens"),
    numero("outputTokens"),
    numero("cacheReadInputTokens"),
    numero("cacheCreationInputTokens"),
  ].filter((parte): parte is number => parte !== null);

  if (partes.length === 0) return null;
  return partes.reduce((soma, parte) => soma + parte, 0);
}

export interface BudgetConsumption {
  readonly tokens: number;
  readonly tokensKnown: boolean;
  readonly runsWithoutUsage: number;
  readonly runs: number;
  readonly wallClockMs: number;
  readonly concurrentRuns: number;
}

export interface BudgetEvaluation {
  /** A maior razão consumo/teto entre os tetos definidos. `0` sem teto. */
  readonly pressure: number;
  /** Os tetos já atingidos ou ultrapassados. */
  readonly exceeded: readonly BudgetLimitKey[];
}

const LIMIT_ORDER: readonly BudgetLimitKey[] = [
  "maxRuns",
  "maxConcurrentRuns",
  "maxTokens",
  "maxWallClockMs",
];

function consumoDe(key: BudgetLimitKey, consumption: BudgetConsumption): number {
  switch (key) {
    case "maxTokens":
      return consumption.tokens;
    case "maxRuns":
      return consumption.runs;
    case "maxWallClockMs":
      return consumption.wallClockMs;
    case "maxConcurrentRuns":
      return consumption.concurrentRuns;
  }
}

/** Avalia o consumo medido contra os tetos. Sem tetos, pressão zero. */
export function evaluateBudget(
  limits: BudgetLimits,
  consumption: BudgetConsumption,
): BudgetEvaluation {
  let pressure = 0;
  const exceeded: BudgetLimitKey[] = [];

  for (const key of LIMIT_ORDER) {
    const limite = limits[key];
    if (limite === null) continue;
    const atual = consumoDe(key, consumption);
    const razao = atual / limite;
    if (razao > pressure) pressure = razao;
    if (atual >= limite) exceeded.push(key);
  }

  return { pressure, exceeded };
}

/** A maior pressão entre vários orçamentos. Nenhum orçamento é pressão zero. */
export function budgetPressure(evaluations: readonly Pick<BudgetEvaluation, "pressure">[]): number {
  return evaluations.reduce((maior, item) => Math.max(maior, item.pressure), 0);
}

export interface BudgetBreachCore {
  /** O teto atingido. Nulo quando a recusa foi por consumo desconhecido. */
  readonly limit: BudgetLimitKey | null;
  readonly limitValue: number | null;
  /** O consumo medido, já contando o Run pedido. */
  readonly current: number;
  readonly reason: string;
}

export type NewRunBudgetCheck =
  | { readonly admit: true; readonly breach: BudgetBreachCore | null }
  | { readonly admit: false; readonly breach: BudgetBreachCore };

export interface CheckBudgetForNewRunInput {
  readonly budget: {
    readonly id: string;
    readonly name: string;
    readonly window: BudgetWindow;
    readonly limits: BudgetLimits;
    readonly action: BudgetAction;
  };
  readonly consumption: BudgetConsumption;
}

/**
 * O orçamento deixa um Run novo nascer?
 *
 * `maxRuns` e `maxConcurrentRuns` contam o Run pedido: com teto 2 e dois já
 * criados, o terceiro estoura. `maxTokens` e `maxWallClockMs` olham o que já
 * foi consumido: no teto, nenhum Run novo cabe, porque nenhum consome zero.
 * `PER_RUN` não tem o que medir na criação — o Worker (9B) o aplica durante a
 * execução — e sempre admite.
 *
 * `BLOCK` recusa; `WARN` admite com o teto em `breach`. Um teto por vez, na
 * ordem fixa dos limites: a resposta nomeia o primeiro que estourou.
 */
export function checkBudgetForNewRun(input: CheckBudgetForNewRunInput): NewRunBudgetCheck {
  const { budget, consumption } = input;
  if (budget.window === "PER_RUN") return { admit: true, breach: null };

  const nome = `O orçamento "${budget.name}" (${budget.id})`;
  let breach: BudgetBreachCore | null = null;

  if (budget.limits.maxTokens !== null && !consumption.tokensKnown) {
    breach = {
      limit: null,
      limitValue: budget.limits.maxTokens,
      current: consumption.tokens,
      reason:
        `${nome} tem teto de tokens e ${String(consumption.runsWithoutUsage)} Run(s) da janela ` +
        "terminaram sem reportar consumo; sem a soma completa o orçamento não libera.",
    };
  }

  if (breach === null) {
    for (const key of LIMIT_ORDER) {
      const limite = budget.limits[key];
      if (limite === null) continue;
      const contaOPedido = key === "maxRuns" || key === "maxConcurrentRuns";
      const depois = consumoDe(key, consumption) + (contaOPedido ? 1 : 0);
      const estoura = contaOPedido ? depois > limite : depois >= limite;
      if (!estoura) continue;
      breach = {
        limit: key,
        limitValue: limite,
        current: depois,
        reason:
          `${nome} está no teto de ${key} (${String(depois)} de ${String(limite)}) na janela ` +
          `${budget.window}.`,
      };
      break;
    }
  }

  if (breach === null) return { admit: true, breach: null };
  return budget.action === "BLOCK" ? { admit: false, breach } : { admit: true, breach };
}

/** As chaves de teto que uma janela aceita. `PER_RUN` limita cada Run isoladamente. */
export function allowedLimitKeys(window: BudgetWindow): readonly BudgetLimitKey[] {
  return window === "PER_RUN" ? ["maxTokens", "maxWallClockMs"] : LIMIT_ORDER;
}
