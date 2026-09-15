import type { GlossaryKey } from "@dungeon-master/glossary";

import type {
  BillingKindRecord,
  CostStatusRecord,
  MetricDimensionRecord,
  MetricWindowRecord,
  MoneyRecord,
  SeriesMetricRecord,
  WorkerStatusRecord,
} from "@/lib/api-types";
import { RUN_CREATED_BY } from "@/lib/autonomy-domain";
import { TASK_KIND } from "@/lib/domain";
import { EXECUTION_MODE } from "@/lib/execution-domain";

/**
 * A ponte entre os enums da observabilidade e o que a tela mostra (Fase 10B).
 *
 * Vale a disciplina de `lib/domain.ts`: nenhum label escrito aqui, só **chaves**
 * de glossário resolvidas no ponto de render, e todo mapa é um `Record<Enum, …>`
 * para que um valor novo no contrato vire erro de compilação em vez de
 * `undefined` numa tabela.
 */

/* ------------------------------------------------------------------ janela */

export const METRIC_WINDOWS = ["7d", "30d", "90d"] as const satisfies readonly MetricWindowRecord[];

export const METRIC_WINDOW: Record<MetricWindowRecord, GlossaryKey> = {
  "7d": "metrics.window.d7",
  "30d": "metrics.window.d30",
  "90d": "metrics.window.d90",
};

/* ------------------------------------------------------------------ medida */

export const SERIES_METRICS = [
  "runs",
  "tokens",
  "duration",
  "cost",
] as const satisfies readonly SeriesMetricRecord[];

export const SERIES_METRIC: Record<SeriesMetricRecord, GlossaryKey> = {
  runs: "metrics.metric.runs",
  tokens: "metrics.metric.tokens",
  duration: "metrics.metric.duration",
  cost: "metrics.metric.cost",
};

/* --------------------------------------------------------------- dimensão */

export const METRIC_DIMENSIONS = [
  "ALL",
  "PROJECT",
  "HARNESS",
  "MODEL",
  "PROVIDER",
  "LOADOUT",
  "CREATED_BY",
  "TASK_KIND",
  "EXECUTION_MODE",
] as const satisfies readonly MetricDimensionRecord[];

export const METRIC_DIMENSION: Record<MetricDimensionRecord, GlossaryKey> = {
  ALL: "metrics.dimension.all",
  PROJECT: "metrics.dimension.project",
  HARNESS: "metrics.dimension.harness",
  MODEL: "metrics.dimension.model",
  PROVIDER: "metrics.dimension.provider",
  LOADOUT: "metrics.dimension.loadout",
  CREATED_BY: "metrics.dimension.createdBy",
  TASK_KIND: "metrics.dimension.taskKind",
  EXECUTION_MODE: "metrics.dimension.executionMode",
};

/**
 * A chave de uma linha da série traduzida, quando a chave **é** um enum.
 *
 * A API resolve o nome atual de Project, Loadout, Provider, Harness e Model na
 * leitura — traduzir aquilo aqui seria inventar um segundo nome para a mesma
 * entidade. Já `CREATED_BY`, `TASK_KIND` e `EXECUTION_MODE` chegam como o valor
 * canônico do enum (`USER`, `BUG`, `DOCKER`), de propósito: a tradução é assunto
 * do glossário, e a API não escreve texto de interface. `undefined` significa
 * "use o `label` que veio do servidor".
 */
export function dimensionKeyLabel(
  dimension: MetricDimensionRecord,
  key: string,
): GlossaryKey | undefined {
  switch (dimension) {
    case "CREATED_BY":
      return key in RUN_CREATED_BY
        ? RUN_CREATED_BY[key as keyof typeof RUN_CREATED_BY].label
        : undefined;
    case "TASK_KIND":
      return key in TASK_KIND ? TASK_KIND[key as keyof typeof TASK_KIND].label : undefined;
    case "EXECUTION_MODE":
      return key in EXECUTION_MODE
        ? EXECUTION_MODE[key as keyof typeof EXECUTION_MODE].label
        : undefined;
    case "ALL":
    case "PROJECT":
    case "HARNESS":
    case "MODEL":
    case "PROVIDER":
    case "LOADOUT":
      return undefined;
  }
}

/* ------------------------------------------------------------------ custo */

export const COST_STATUS: Record<CostStatusRecord, GlossaryKey> = {
  PRICED: "metrics.cost.status.priced",
  ESTIMATED_SUBSCRIPTION: "metrics.cost.status.estimated",
  NOT_MEASURED: "metrics.cost.status.notMeasured",
};

export const BILLING_KINDS = [
  "PER_TOKEN",
  "SUBSCRIPTION",
] as const satisfies readonly BillingKindRecord[];

export const BILLING_KIND: Record<BillingKindRecord, GlossaryKey> = {
  PER_TOKEN: "provider.billing.perToken",
  SUBSCRIPTION: "provider.billing.subscription",
};

/* ----------------------------------------------------------------- Worker */

interface WorkerStatusPresentation {
  readonly label: GlossaryKey;
  /** A cor do ponto do chip, da família de acentos de `styles.css`. */
  readonly dot: string;
  readonly dim: boolean;
}

export const WORKER_STATUS: Record<WorkerStatusRecord, WorkerStatusPresentation> = {
  ONLINE: { label: "metrics.worker.status.online", dot: "var(--accent-green)", dim: false },
  STALE: { label: "metrics.worker.status.stale", dot: "var(--accent-amber)", dim: false },
  OFFLINE: { label: "metrics.worker.status.offline", dot: "var(--muted-foreground)", dim: true },
};

/* -------------------------------------------------------------- formatação */

const NUMBER = new Intl.NumberFormat("pt-BR");
const COMPACT = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

/** Um inteiro por extenso, com separador de milhar. */
export function formatCount(value: number): string {
  return NUMBER.format(value);
}

/** Um número grande em forma curta: 1,2 mi. Para tile e eixo, nunca para tabela. */
export function formatCompact(value: number): string {
  return COMPACT.format(value);
}

export function formatPercent(value: number): string {
  return PERCENT.format(value);
}

/**
 * Um valor monetário no locale, com a moeda que o veio acompanhando.
 *
 * `null` em `amount` **não** vira zero: quem chama mostra o rótulo do status no
 * lugar do número. Uma moeda que o `Intl` não conhece cai no código puro, em vez
 * de lançar e derrubar a tela.
 */
export function formatMoney(money: Pick<MoneyRecord, "amount" | "currency">): string | null {
  if (money.amount === null) return null;
  if (money.currency === null) return NUMBER.format(money.amount);
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: money.currency,
      maximumFractionDigits: money.amount < 1 ? 4 : 2,
    }).format(money.amount);
  } catch {
    return `${money.currency} ${NUMBER.format(money.amount)}`;
  }
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Uma duração em milissegundos, na maior unidade que ainda diz alguma coisa.
 *
 * `null` é ausência de medida — "nunca começou" —, e vira o travessão de quem
 * chama, nunca `0 s`.
 */
export function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < SECOND) return `${NUMBER.format(Math.round(ms))} ms`;
  if (ms < MINUTE) return `${NUMBER.format(Math.round(ms / SECOND))} s`;
  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE);
    const seconds = Math.round((ms % MINUTE) / SECOND);
    return `${String(minutes)} min ${String(seconds)} s`;
  }
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.round((ms % HOUR) / MINUTE);
  return `${String(hours)} h ${String(minutes)} min`;
}

/** O dia `YYYY-MM-DD` da série, curto, para o eixo. */
export function formatDay(day: string): string {
  const [, month, date] = day.split("-");
  return month === undefined || date === undefined ? day : `${date}/${month}`;
}

/**
 * O valor de um ponto da série no formato da medida.
 *
 * A unidade vem do servidor (`runs`, `tokens`, `ms` ou o código da moeda), e é
 * ela que decide: uma série de custo em BRL não se formata como contagem.
 */
export function formatSeriesValue(
  metric: SeriesMetricRecord,
  value: number,
  currency: string | null,
): string {
  switch (metric) {
    case "runs":
      return formatCount(value);
    case "tokens":
      return formatCount(value);
    case "duration":
      return formatDuration(value) ?? "—";
    case "cost":
      return formatMoney({ amount: value, currency }) ?? formatCount(value);
  }
}

/* ------------------------------------------------------------- paleta ---- */

/**
 * A paleta das séries, derivada dos tokens de `styles.css`.
 *
 * Uma paleta só, nos dois temas de cor: os tokens `--accent-*` já têm valor
 * próprio em claro e escuro, então o gráfico acompanha sem uma segunda tabela.
 * A cor **nunca** carrega sozinha o significado — cada linha tem forma de
 * marcador e nome na legenda, e a mesma série existe na tabela equivalente logo
 * abaixo do gráfico.
 */
export const SERIES_COLORS: readonly string[] = [
  "var(--accent-blue)",
  "var(--accent-violet)",
  "var(--accent-amber)",
  "var(--accent-green)",
  "var(--accent-teal)",
  "var(--accent-green-strong)",
];

/** As formas de marcador, na mesma ordem da paleta: a segunda pista visual. */
export const SERIES_SHAPES = ["circle", "square", "triangle", "diamond", "star", "cross"] as const;

export type SeriesShape = (typeof SERIES_SHAPES)[number];

/** Quantas linhas a série desenha antes de o resto virar só tabela. */
export const MAX_SERIES_LINES = 6;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? "var(--accent-blue)";
}

export function seriesShape(index: number): SeriesShape {
  return SERIES_SHAPES[index % SERIES_SHAPES.length] ?? "circle";
}
