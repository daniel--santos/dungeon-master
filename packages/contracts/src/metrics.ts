import { z } from "zod";

import { ExecutionModeSchema } from "./execution-profile.js";
import { HarnessKeySchema } from "./harness.js";
import { RunCreatedBySchema, RunStatusSchema } from "./run.js";
import { TaskKindSchema } from "./task.js";

/**
 * Métricas, custo e presença de Worker (planejamento v0.4, Fase 10A).
 *
 * Tudo aqui é **leitura de projeção**: `run_metric` e `metric_daily` são
 * reconstruíveis do zero a partir de `run`, `run_event` e `run_context`, e
 * nenhuma linha delas participa da execução de um Run. O vocabulário é
 * canônico (CLAUDE.md, seção 1): `metrics`, `worker`, `model_price` — a "Torre
 * de Vigia" existe só como label do glossário.
 *
 * ## A regra do custo
 *
 * Um número de custo só aparece acompanhado de `costStatus` e de `currency`, e
 * **nunca** de um zero inventado:
 *
 * - `PRICED` — há preço vigente para o Model na data do Run e o harness
 *   reportou tokens. O valor é a conta.
 * - `ESTIMATED_SUBSCRIPTION` — o Provider é de assinatura e tem `monthlyCost`.
 *   O valor é o rateio da mensalidade pela fatia de tokens do Provider no mês
 *   civil UTC, calculado na leitura (a fatia muda até o mês fechar) e por isso
 *   nunca gravado por Run.
 * - `NOT_MEASURED` — não há preço nem assinatura, **ou** o harness não reportou
 *   tokens. `amount` e `currency` vêm nulos.
 *
 * Somas só acontecem dentro da mesma moeda: toda resposta de custo é uma lista
 * por moeda, nunca um total único.
 */

// --------------------------------------------------------------------------
// Vocabulário
// --------------------------------------------------------------------------

/**
 * Por qual eixo uma linha de `metric_daily` foi agrupada.
 *
 * `ALL` é o total do dia, e existe como dimensão própria — e não como uma soma
 * das outras — porque um Run sem Project, sem Model ou sem Provider não produz
 * linha naquele eixo: somar `PROJECT` para chegar ao total daria menos Runs do
 * que houve.
 */
export const METRIC_DIMENSION_VALUES = [
  "ALL",
  "PROJECT",
  "HARNESS",
  "MODEL",
  "PROVIDER",
  "LOADOUT",
  "CREATED_BY",
  "TASK_KIND",
  "EXECUTION_MODE",
] as const;

export const MetricDimensionSchema = z.enum(METRIC_DIMENSION_VALUES).meta({
  id: "MetricDimension",
  description: "O eixo de agrupamento de uma linha do rollup diário.",
});

export type MetricDimension = z.infer<typeof MetricDimensionSchema>;

/** A chave da dimensão `ALL`. Uma constante, para não virar string solta. */
export const METRIC_DIMENSION_ALL_KEY = "ALL" as const;

export const COST_STATUS_VALUES = ["PRICED", "ESTIMATED_SUBSCRIPTION", "NOT_MEASURED"] as const;

export const CostStatusSchema = z.enum(COST_STATUS_VALUES).meta({
  id: "CostStatus",
  description:
    "De onde o custo saiu. `PRICED` é preço por token vigente na data do Run; " +
    "`ESTIMATED_SUBSCRIPTION` é o rateio de uma mensalidade pela fatia de tokens " +
    "do mês; `NOT_MEASURED` é ausência de preço ou de tokens reportados, nunca zero.",
});

export type CostStatus = z.infer<typeof CostStatusSchema>;

export const BILLING_KIND_VALUES = ["PER_TOKEN", "SUBSCRIPTION"] as const;

export const BillingKindSchema = z.enum(BILLING_KIND_VALUES).meta({
  id: "BillingKind",
  description:
    "Como o Provider cobra. `PER_TOKEN` usa `model_price`; `SUBSCRIPTION` usa " +
    "`monthlyCost` rateado. Nulo é desconhecido, e desconhecido custa `NOT_MEASURED`.",
});

export type BillingKind = z.infer<typeof BillingKindSchema>;

export const METRIC_WINDOW_VALUES = ["7d", "30d", "90d"] as const;

export const MetricWindowSchema = z.enum(METRIC_WINDOW_VALUES).meta({
  id: "MetricWindow",
  description: "A janela de dias, contada para trás a partir de hoje em UTC, inclusive.",
});

export type MetricWindow = z.infer<typeof MetricWindowSchema>;

/**
 * O que a série desenha.
 *
 * Minúsculo de propósito, como `RUN_RESULT_STATUS_VALUES`: é valor de
 * parâmetro de consulta, e não enum do domínio.
 */
export const SERIES_METRIC_VALUES = ["runs", "tokens", "duration", "cost"] as const;

export const SeriesMetricSchema = z.enum(SERIES_METRIC_VALUES).meta({
  id: "SeriesMetric",
  description: "Qual medida a série traz por dia.",
});

export type SeriesMetric = z.infer<typeof SeriesMetricSchema>;

/** Código ISO 4217, três letras maiúsculas. */
export const CurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "A moeda é um código ISO 4217 de três letras, como USD ou BRL.");

/** Um dia civil em UTC, `YYYY-MM-DD`. */
export const MetricDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "O dia é uma data UTC no formato YYYY-MM-DD.");

// --------------------------------------------------------------------------
// Custo
// --------------------------------------------------------------------------

export const MoneySchema = z
  .object({
    currency: z.string().nullable().describe("ISO 4217. Nulo quando o custo não foi medido."),
    amount: z
      .number()
      .nullable()
      .describe("O valor na moeda. Nulo quando o custo não foi medido — nunca zero."),
    status: CostStatusSchema,
  })
  .meta({
    id: "Money",
    description: "Um custo com procedência. Sem `PRICED` ou assinatura, `amount` é nulo.",
  });

export type Money = z.infer<typeof MoneySchema>;

// --------------------------------------------------------------------------
// Tiles do painel
// --------------------------------------------------------------------------

export const MetricRunCountsSchema = z
  .object({
    total: z.number().int().nonnegative().describe("Runs terminais na janela."),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    timedOut: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    successRate: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe("`succeeded / total`. Nulo quando não houve Run — não zero."),
  })
  .meta({ id: "MetricRunCounts", description: "Runs terminais por desfecho." });

export const MetricTokenCountsSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().describe("A soma dos quatro."),
    knownRuns: z
      .number()
      .int()
      .nonnegative()
      .describe("Runs cujo harness reportou tokens. É o denominador honesto das somas."),
    unknownRuns: z
      .number()
      .int()
      .nonnegative()
      .describe("Runs sem `Usage`. Os tokens deles não entram como zero em lugar nenhum."),
  })
  .meta({
    id: "MetricTokenCounts",
    description: "Tokens somados, com quantos Runs os reportaram.",
  });

export const MetricDurationSchema = z
  .object({
    averageMs: z.number().nonnegative().nullable().describe("Nulo quando nenhum Run foi medido."),
    p95Ms: z
      .number()
      .nonnegative()
      .nullable()
      .describe("Percentil 95 por posto mais próximo, sobre os Runs medidos."),
    maxMs: z.number().nonnegative().nullable(),
    totalMs: z.number().nonnegative().describe("Tempo somado de execução na janela."),
    measuredRuns: z.number().int().nonnegative().describe("Runs com início e fim conhecidos."),
  })
  .meta({ id: "MetricDuration", description: "Duração das Expedições da janela." });

export const MetricWorkerCountsSchema = z
  .object({
    online: z.number().int().nonnegative().describe("Com batimento dentro do prazo."),
    stale: z
      .number()
      .int()
      .nonnegative()
      .describe("Sem batimento há mais de três intervalos e sem desligamento gracioso."),
    offline: z.number().int().nonnegative().describe("Desligados graciosamente."),
  })
  .meta({ id: "MetricWorkerCounts", description: "Presença de Worker no instante da leitura." });

export const MetricsOverviewSchema = z
  .object({
    window: MetricWindowSchema,
    from: MetricDaySchema.describe("Primeiro dia da janela, em UTC."),
    to: MetricDaySchema.describe("Último dia da janela, em UTC. É hoje."),
    projectId: z.uuid().nullable().describe("O Project do filtro, quando houve um."),
    runs: MetricRunCountsSchema,
    tokens: MetricTokenCountsSchema,
    duration: MetricDurationSchema,
    costs: z
      .array(MoneySchema)
      .describe(
        "Uma entrada por moeda, mais uma entrada `NOT_MEASURED` quando houve Run " +
          "sem preço. Nunca um total único: moedas diferentes não se somam.",
      ),
    notMeasuredRuns: z
      .number()
      .int()
      .nonnegative()
      .describe("Runs sem custo medido, por falta de preço, de assinatura ou de tokens."),
    openCircuitBreakers: z
      .number()
      .int()
      .nonnegative()
      .describe("Disjuntores ligados que não estão `CLOSED` agora."),
    workers: MetricWorkerCountsSchema,
  })
  .meta({
    id: "MetricsOverview",
    description: "Os tiles da janela: Runs, tokens, duração, custo, disjuntores e Workers.",
  });

export type MetricsOverview = z.infer<typeof MetricsOverviewSchema>;

export const MetricsOverviewQuerySchema = z
  .object({
    window: MetricWindowSchema.optional().describe("Padrão: `30d`."),
    projectId: z.uuid().optional().describe("Só os Runs deste Project."),
  })
  .meta({ id: "MetricsOverviewQuery" });

export type MetricsOverviewQuery = z.infer<typeof MetricsOverviewQuerySchema>;

// --------------------------------------------------------------------------
// Séries
// --------------------------------------------------------------------------

export const MetricSeriesPointSchema = z
  .object({
    day: MetricDaySchema,
    value: z.number().describe("Zero em dia sem dado: a série é contínua por construção."),
  })
  .meta({ id: "MetricSeriesPoint", description: "Um dia da série." });

export const MetricSeriesLineSchema = z
  .object({
    key: z.string().describe("A chave da dimensão. `ALL` quando a dimensão é `ALL`."),
    label: z
      .string()
      .describe("Nome atual da entidade, resolvido na leitura. Cai para a chave quando sumiu."),
    total: z.number().describe("A soma dos pontos, para ordenar as linhas sem refazer a conta."),
    points: z.array(MetricSeriesPointSchema).describe("Um ponto por dia da janela, em ordem."),
  })
  .meta({ id: "MetricSeriesLine", description: "Uma linha da série, por chave de dimensão." });

export const MetricSeriesSchema = z
  .object({
    metric: SeriesMetricSchema,
    dimension: MetricDimensionSchema,
    window: MetricWindowSchema,
    from: MetricDaySchema,
    to: MetricDaySchema,
    projectId: z.uuid().nullable(),
    currency: z
      .string()
      .nullable()
      .describe(
        "Só em `metric=cost`: a moeda desenhada. Nulo quando nada foi precificado " +
          "ou quando a métrica não é custo.",
      ),
    unit: z.string().describe("A unidade do eixo: `runs`, `tokens`, `ms` ou o código da moeda."),
    series: z.array(MetricSeriesLineSchema).describe("Da maior soma para a menor."),
  })
  .meta({ id: "MetricSeries", description: "Pontos por dia, por chave de dimensão." });

export type MetricSeries = z.infer<typeof MetricSeriesSchema>;

export const MetricSeriesQuerySchema = z
  .object({
    metric: SeriesMetricSchema.optional().describe("Padrão: `runs`."),
    dimension: MetricDimensionSchema.optional().describe("Padrão: `ALL`."),
    window: MetricWindowSchema.optional().describe("Padrão: `30d`."),
    projectId: z.uuid().optional(),
    currency: CurrencySchema.optional().describe(
      "Só em `metric=cost`. Padrão: a moeda com maior custo na janela.",
    ),
  })
  .meta({ id: "MetricSeriesQuery" });

export type MetricSeriesQuery = z.infer<typeof MetricSeriesQuerySchema>;

// --------------------------------------------------------------------------
// Custos por Provider e por Model
// --------------------------------------------------------------------------

export const ProviderCostSchema = z
  .object({
    providerId: z.uuid().nullable().describe("Nulo agrupa os Runs cujo Model não tem Provider."),
    providerName: z.string().nullable(),
    billingKind: BillingKindSchema.nullable().describe("Nulo é desconhecido."),
    monthlyCost: z.number().nullable().describe("A mensalidade declarada, em `currency`."),
    runs: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative().describe("Tokens dos Runs que reportaram."),
    cost: MoneySchema,
    months: z
      .array(
        z.object({
          month: z.string().describe("Mês civil UTC, `YYYY-MM`."),
          windowTokens: z.number().int().nonnegative().describe("Tokens dentro da janela."),
          monthTokens: z.number().int().nonnegative().describe("Tokens do mês inteiro."),
          amount: z.number().describe("A fatia da mensalidade atribuída à janela."),
        }),
      )
      .describe("O rateio, mês a mês. Vazio fora de `ESTIMATED_SUBSCRIPTION`."),
  })
  .meta({ id: "ProviderCost", description: "O custo de um Provider na janela, com procedência." });

export const ModelCostSchema = z
  .object({
    modelKey: z.string().describe("A chave gravada no Run, que sobrevive ao Model apagado."),
    modelId: z.uuid().nullable(),
    modelName: z.string().nullable(),
    providerId: z.uuid().nullable(),
    providerName: z.string().nullable(),
    runs: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    cost: MoneySchema,
  })
  .meta({ id: "ModelCost", description: "O custo de um Model na janela." });

export const MetricCostsSchema = z
  .object({
    window: MetricWindowSchema,
    from: MetricDaySchema,
    to: MetricDaySchema,
    totals: z.array(MoneySchema).describe("Uma entrada por moeda; nunca um total único."),
    notMeasuredRuns: z.number().int().nonnegative(),
    providers: z.array(ProviderCostSchema).describe("Do maior custo para o menor."),
    models: z.array(ModelCostSchema).describe("Do maior custo para o menor."),
  })
  .meta({ id: "MetricCosts", description: "Custo por Provider e por Model, com o rateio." });

export type MetricCosts = z.infer<typeof MetricCostsSchema>;

export const MetricCostsQuerySchema = z
  .object({ window: MetricWindowSchema.optional().describe("Padrão: `30d`.") })
  .meta({ id: "MetricCostsQuery" });

export type MetricCostsQuery = z.infer<typeof MetricCostsQuerySchema>;

// --------------------------------------------------------------------------
// A quebra de um Run
// --------------------------------------------------------------------------

export const RunToolCallsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    byServer: z
      .array(
        z.object({
          server: z
            .string()
            .describe(
              "O nome do servidor MCP, tirado do prefixo `mcp__<servidor>__`. " +
                "`native` agrupa as ferramentas do próprio harness.",
            ),
          calls: z.number().int().nonnegative(),
        }),
      )
      .describe("Da mais chamada para a menos."),
  })
  .meta({ id: "RunToolCalls", description: "Chamadas de ferramenta de um Run, por servidor." });

export const RunContextMetricsSchema = z
  .object({
    estimatedTokens: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe("Tokens estimados do bloco de contexto. Nulo quando não houve contexto."),
    items: z.number().int().nonnegative().nullable(),
    sections: z.number().int().nonnegative().nullable(),
    truncations: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe("Seções que o orçamento cortou."),
  })
  .meta({
    id: "RunContextMetrics",
    description: "O que o contexto montado custou, para comparar com os tokens de entrada.",
  });

export const RunMetricsSchema = z
  .object({
    runId: z.uuid(),
    status: RunStatusSchema.describe("O desfecho terminal."),
    taskId: z.uuid(),
    taskKind: TaskKindSchema,
    projectId: z.uuid().nullable(),
    harnessKey: HarnessKeySchema,
    modelKey: z.string().nullable(),
    providerId: z.uuid().nullable(),
    providerName: z.string().nullable(),
    loadoutId: z.uuid(),
    loadoutVersion: z.number().int().positive(),
    executionMode: ExecutionModeSchema,
    createdBy: RunCreatedBySchema,
    parentRunId: z.uuid().nullable(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime(),
    durationMs: z.number().int().nonnegative().nullable(),
    queueMs: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe("Da criação ao início. Nulo quando o Run nunca chegou a começar."),
    tokens: z
      .object({
        input: z.number().int().nonnegative().nullable(),
        output: z.number().int().nonnegative().nullable(),
        cacheRead: z.number().int().nonnegative().nullable(),
        cacheWrite: z.number().int().nonnegative().nullable(),
        total: z.number().int().nonnegative().nullable(),
        known: z.boolean().describe("O harness reportou `Usage`? Falso não é zero."),
      })
      .describe("Nulos quando o harness não reportou; nunca zero fingido."),
    context: RunContextMetricsSchema,
    toolCalls: RunToolCallsSchema,
    steps: z
      .array(z.object({ type: z.string(), count: z.number().int().nonnegative() }))
      .describe("Passos do Workflow por tipo. Vazio num Run sem Workflow."),
    gates: z
      .object({
        grantedByUser: z.number().int().nonnegative(),
        grantedByPolicy: z.number().int().nonnegative(),
      })
      .describe("Aprovações concedidas, separadas por quem decidiu."),
    childrenDelegated: z.number().int().nonnegative().describe("Runs filhos que este abriu."),
    cost: MoneySchema,
  })
  .meta({ id: "RunMetrics", description: "A quebra de uma Expedição terminal." });

export type RunMetrics = z.infer<typeof RunMetricsSchema>;

// --------------------------------------------------------------------------
// Preço de Model
// --------------------------------------------------------------------------

const PriceAmountSchema = z
  .number()
  .nonnegative()
  .max(1_000_000)
  .describe("Preço por 1 milhão de tokens, na moeda declarada.");

export const ModelPriceSchema = z
  .object({
    id: z.uuid(),
    modelId: z.uuid(),
    modelKey: z.string().nullable().describe("A chave do Model, para a listagem ser legível."),
    modelName: z.string().nullable(),
    currency: z.string(),
    inputPerMillion: z.number(),
    outputPerMillion: z.number(),
    cacheReadPerMillion: z.number(),
    cacheWritePerMillion: z.number(),
    effectiveFrom: z.iso.datetime(),
    effectiveTo: z.iso.datetime().nullable().describe("Nulo é a vigência corrente."),
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({
    id: "ModelPrice",
    description:
      "Uma vigência de preço de um Model. O histórico é append-only: um preço novo " +
      "fecha a vigência anterior e abre outra, e o custo de um Run usa a vigência da data dele.",
  });

export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const SetModelPriceSchema = z
  .object({
    currency: CurrencySchema,
    inputPerMillion: PriceAmountSchema,
    outputPerMillion: PriceAmountSchema,
    cacheReadPerMillion: PriceAmountSchema.optional().describe("Padrão: zero."),
    cacheWritePerMillion: PriceAmountSchema.optional().describe("Padrão: zero."),
    effectiveFrom: z.iso
      .datetime()
      .optional()
      .describe("Quando a vigência começa. Padrão: agora. Precisa ser depois da vigência atual."),
    note: z.string().trim().max(500).nullish(),
  })
  .meta({ id: "SetModelPrice", description: "Corpo de `PUT /api/v1/models/{id}/price`." });

export type SetModelPrice = z.infer<typeof SetModelPriceSchema>;

export const ModelPriceListSchema = z
  .object({ items: z.array(ModelPriceSchema) })
  .meta({ id: "ModelPriceList", description: "Preços de Model." });

export type ModelPriceList = z.infer<typeof ModelPriceListSchema>;

/** O que `PUT /models/{id}/price` pode recusar. */
export const MODEL_PRICE_FAILURE_VALUES = ["EFFECTIVE_FROM_NOT_AFTER_CURRENT"] as const;

export const ModelPriceFailureSchema = z.enum(MODEL_PRICE_FAILURE_VALUES).meta({
  id: "ModelPriceFailure",
  description:
    "`EFFECTIVE_FROM_NOT_AFTER_CURRENT`: a vigência nova precisa começar depois " +
    "do início da vigência atual — o histórico é append-only e não se reescreve.",
});

export type ModelPriceFailure = z.infer<typeof ModelPriceFailureSchema>;
