import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * Budget: um teto de consumo por escopo e janela (planejamento v0.4, Fase 9).
 *
 * O consumo é medido pelo que já existe: `run.result.usage` (tokens), a
 * contagem de Runs criados na janela, a duração dos Runs e os Runs vivos. A
 * janela é de calendário em UTC (`DAY` começa à meia-noite, `WEEK` na
 * segunda-feira, `MONTH` no dia 1); `PER_RUN` limita cada Run isoladamente e
 * é o Worker (9B) quem o aplica durante a execução — na criação não há o que
 * medir.
 *
 * **Fail-closed em consumo desconhecido.** Um Run que rodou e terminou sem
 * reportar tokens deixa a soma da janela incompleta; um orçamento com
 * `maxTokens` não libera sobre uma soma que não sabe ser verdadeira. A
 * resposta de uso diz quantos Runs ficaram sem medida.
 */

export const BUDGET_SCOPE_VALUES = ["GLOBAL", "PROJECT", "LOADOUT"] as const;

export const BudgetScopeSchema = z.enum(BUDGET_SCOPE_VALUES).meta({
  id: "BudgetScope",
  description: "`GLOBAL` conta todo Run; `PROJECT` os do Project; `LOADOUT` os do Loadout.",
});

export type BudgetScope = z.infer<typeof BudgetScopeSchema>;

export const BUDGET_WINDOW_VALUES = ["DAY", "WEEK", "MONTH", "PER_RUN"] as const;

export const BudgetWindowSchema = z.enum(BUDGET_WINDOW_VALUES).meta({
  id: "BudgetWindow",
  description: "Janela de calendário em UTC, ou `PER_RUN` para limitar cada Run isoladamente.",
});

export type BudgetWindow = z.infer<typeof BudgetWindowSchema>;

export const BUDGET_ACTION_VALUES = ["BLOCK", "WARN"] as const;

export const BudgetActionSchema = z.enum(BUDGET_ACTION_VALUES).meta({
  id: "BudgetAction",
  description: "`BLOCK` recusa o Run com `409`; `WARN` deixa passar e avisa.",
});

export type BudgetAction = z.infer<typeof BudgetActionSchema>;

export const BUDGET_LIMIT_KEY_VALUES = [
  "maxTokens",
  "maxRuns",
  "maxWallClockMs",
  "maxConcurrentRuns",
] as const;

export const BudgetLimitKeySchema = z.enum(BUDGET_LIMIT_KEY_VALUES).meta({
  id: "BudgetLimitKey",
  description: "Qual dos quatro tetos de um orçamento.",
});

export type BudgetLimitKey = z.infer<typeof BudgetLimitKeySchema>;

export const BUDGET_NAME_MAX_LENGTH = 200;

const NameSchema = z.string().trim().min(1).max(BUDGET_NAME_MAX_LENGTH);
const LimitSchema = z.number().int().positive();

export const BudgetLimitsSchema = z
  .object({
    maxTokens: LimitSchema.nullable().describe("Teto de tokens (`inputTokens + outputTokens`)."),
    maxRuns: LimitSchema.nullable().describe("Teto de Runs criados na janela."),
    maxWallClockMs: LimitSchema.nullable().describe("Teto de tempo de execução somado."),
    maxConcurrentRuns: LimitSchema.nullable().describe("Teto de Runs vivos ao mesmo tempo."),
  })
  .meta({ id: "BudgetLimits", description: "Os tetos de um orçamento. Nulo é sem teto." });

export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;

export const BudgetSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do orçamento."),
    name: z.string(),
    scope: BudgetScopeSchema,
    projectId: z.uuid().nullable().describe("Só em `PROJECT`."),
    loadoutId: z.uuid().nullable().describe("Só em `LOADOUT`."),
    window: BudgetWindowSchema,
    limits: BudgetLimitsSchema,
    action: BudgetActionSchema,
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Budget", description: "Um teto de consumo por escopo e janela." });

export type Budget = z.infer<typeof BudgetSchema>;

const LimitsInputShape = {
  maxTokens: LimitSchema.nullish(),
  maxRuns: LimitSchema.nullish(),
  maxWallClockMs: LimitSchema.nullish(),
  maxConcurrentRuns: LimitSchema.nullish(),
};

export const CreateBudgetSchema = z
  .object({
    name: NameSchema,
    scope: BudgetScopeSchema,
    projectId: z.uuid().nullish().describe("Obrigatório em `PROJECT`; recusado nos outros."),
    loadoutId: z.uuid().nullish().describe("Obrigatório em `LOADOUT`; recusado nos outros."),
    window: BudgetWindowSchema,
    ...LimitsInputShape,
    action: BudgetActionSchema.optional().describe("Padrão: `BLOCK`."),
    enabled: z.boolean().optional().describe("Padrão: ligado."),
  })
  .meta({
    id: "CreateBudget",
    description:
      "Corpo de `POST /api/v1/budgets`. Pelo menos um teto; `PER_RUN` só aceita " +
      "`maxTokens` e `maxWallClockMs`.",
  });

export type CreateBudget = z.infer<typeof CreateBudgetSchema>;

export const UpdateBudgetSchema = z
  .object({
    name: NameSchema.optional(),
    ...LimitsInputShape,
    action: BudgetActionSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .meta({
    id: "UpdateBudget",
    description:
      "Corpo de `PATCH /api/v1/budgets/{id}`. Escopo e janela não mudam: apague e crie de novo.",
  });

export type UpdateBudget = z.infer<typeof UpdateBudgetSchema>;

export const BudgetListQuerySchema = PageQuerySchema.extend({
  scope: BudgetScopeSchema.optional(),
  projectId: z.uuid().optional().describe("Só os orçamentos deste Project, mais os globais."),
  loadoutId: z.uuid().optional().describe("Só os orçamentos deste Loadout, mais os globais."),
}).meta({ id: "BudgetListQuery" });

export type BudgetListQuery = z.infer<typeof BudgetListQuerySchema>;

export const BudgetPageSchema = paginatedSchema(
  BudgetSchema,
  "BudgetPage",
  "Uma página de orçamentos, em ordem alfabética.",
);

export type BudgetPage = z.infer<typeof BudgetPageSchema>;

// --------------------------------------------------------------------------
// Consumo
// --------------------------------------------------------------------------

export const BudgetUsageSchema = z
  .object({
    budgetId: z.uuid(),
    window: BudgetWindowSchema,
    windowStart: z.iso
      .datetime()
      .nullable()
      .describe("Começo da janela, em UTC. Nulo em `PER_RUN`."),
    windowEnd: z.iso.datetime().nullable().describe("Fim exclusivo da janela. Nulo em `PER_RUN`."),
    runId: z
      .uuid()
      .nullable()
      .describe("Em `PER_RUN`, o Run medido: o pedido, ou o último terminal do escopo."),
    tokens: z.number().int().nonnegative().describe("Soma de `inputTokens + outputTokens`."),
    tokensKnown: z
      .boolean()
      .describe("Falso quando algum Run que rodou terminou sem reportar consumo."),
    runsWithoutUsage: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative().describe("Runs criados na janela."),
    wallClockMs: z
      .number()
      .int()
      .nonnegative()
      .describe("Duração somada dos Runs, com os vivos contados até agora."),
    concurrentRuns: z.number().int().nonnegative().describe("Runs vivos agora, sem janela."),
    limits: BudgetLimitsSchema,
    pressure: z
      .number()
      .min(0)
      .describe("A maior razão consumo/teto entre os tetos definidos. `1` é no teto."),
    exceeded: z.array(BudgetLimitKeySchema).describe("Os tetos já atingidos ou ultrapassados."),
    computedAt: z.iso.datetime(),
  })
  .meta({ id: "BudgetUsage", description: "O consumo medido de um orçamento na janela atual." });

export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

/**
 * O que `POST /runs` devolve quando um orçamento `WARN` foi atingido, e o que
 * vai em `budget` no `409 BUDGET_EXCEEDED` de um `BLOCK`.
 */
export const BudgetBreachSchema = z
  .object({
    budgetId: z.uuid(),
    name: z.string(),
    action: BudgetActionSchema,
    limit: BudgetLimitKeySchema.nullable().describe(
      "O teto atingido. Nulo quando a recusa foi por consumo desconhecido.",
    ),
    limitValue: z.number().int().positive().nullable(),
    current: z.number().int().nonnegative().describe("O consumo medido, já contando o Run pedido."),
    decidedBy: z.string().describe("`BUDGET:<id>`."),
    reason: z.string(),
    usage: BudgetUsageSchema,
  })
  .meta({ id: "BudgetBreach", description: "Um orçamento atingido por um pedido de Run." });

export type BudgetBreach = z.infer<typeof BudgetBreachSchema>;
