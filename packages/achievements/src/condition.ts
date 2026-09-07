import { z } from "zod";

/**
 * Vocabulário fechado de condições (planejamento v0.4, Fase 2.5A).
 *
 * Mesma regra dos Workflows: dados, sem linguagem de expressão. Cinco
 * predicados, uma lista fechada de fontes e um filtro de campos conhecidos.
 * Todo objeto é estrito: predicado, fonte ou campo desconhecido não passa no
 * schema, e o carregador o descarta. Fail-closed, sempre.
 */

/** Eventos e mudanças de domínio que uma condição pode observar. */
export const ConditionSourceSchema = z.enum([
  "run.succeeded",
  "run.failed",
  "run.cancelled",
  "task.completed",
  "task.dependency_created",
  "approval.granted",
  "approval.rejected",
  "knowledge_item.promoted",
  "project.created",
]);

export type ConditionSource = z.infer<typeof ConditionSourceSchema>;

/** `kind` de uma Task, o fato de domínio por trás de "bugs são Monstros". */
export const TaskKindSchema = z.enum(["BUG", "FEATURE", "RESEARCH", "CHORE"]);

export type TaskKind = z.infer<typeof TaskKindSchema>;

/** Modo de execução de um Run. */
export const ExecutionModeSchema = z.enum(["HOST", "DOCKER"]);

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

/**
 * Presença de um campo opcional do Run.
 *
 * O catálogo pede `resumedFrom != null` e `workflowVersionId != null`; sem
 * linguagem de expressão, isso vira um valor do vocabulário.
 */
export const PresenceSchema = z.enum(["PRESENT", "ABSENT"]);

export type Presence = z.infer<typeof PresenceSchema>;

/** Identificador de Harness: slug estável, não o rótulo exibido. */
export const HarnessIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "O id de Harness usa minúsculas, dígitos e hífen.");

/** Faixa de hora local, inclusiva nas duas pontas. Cobre `hourLocal in 0..5`. */
export const HourRangeSchema = z
  .strictObject({
    from: z.int().min(0).max(23),
    to: z.int().min(0).max(23),
  })
  .refine((range) => range.from <= range.to, {
    message: "A faixa de hora local precisa ir do menor para o maior.",
  });

export type HourRange = z.infer<typeof HourRangeSchema>;

/**
 * Filtro de uma condição: só campos conhecidos, todos opcionais e tipados.
 *
 * Campo fora desta lista falha a validação em vez de ser ignorado, para que uma
 * definição errada nunca desbloqueie nada.
 */
export const ConditionFilterSchema = z.strictObject({
  "task.kind": TaskKindSchema.optional(),
  "task.id": z.uuid().optional(),
  "run.executionMode": ExecutionModeSchema.optional(),
  "run.harness": HarnessIdSchema.optional(),
  "run.resumedFrom": PresenceSchema.optional(),
  "run.workflowVersionId": PresenceSchema.optional(),
  "project.id": z.uuid().optional(),
  "agent.id": z.uuid().optional(),
  hourLocal: HourRangeSchema.optional(),
});

export type ConditionFilter = z.infer<typeof ConditionFilterSchema>;

/** Nomes dos campos de filtro, na ordem do schema. Fonte da lista de dimensões. */
export const CONDITION_FILTER_FIELDS = [
  "task.kind",
  "task.id",
  "run.executionMode",
  "run.harness",
  "run.resumedFrom",
  "run.workflowVersionId",
  "project.id",
  "agent.id",
  "hourLocal",
] as const;

export type ConditionFilterField = (typeof CONDITION_FILTER_FIELDS)[number];

/** Dimensões que o predicado `set` sabe percorrer para exigir um conjunto completo. */
export const ConditionDimensionSchema = z.enum([
  "task.kind",
  "run.executionMode",
  "run.harness",
  "project.id",
  "agent.id",
]);

export type ConditionDimension = z.infer<typeof ConditionDimensionSchema>;

/** Métricas de recorde. Só duração de Run por enquanto. */
export const RecordMetricSchema = z.enum(["run.durationMs"]);

export type RecordMetric = z.infer<typeof RecordMetricSchema>;

/** Direção de um recorde: maior é melhor ou menor é melhor. */
export const RecordDirectionSchema = z.enum(["max", "min"]);

export type RecordDirection = z.infer<typeof RecordDirectionSchema>;

const filterField = { filter: ConditionFilterSchema.optional() };

/** `count { source, filter, thresholds[] }` — cada limiar é um tier. */
export const CountConditionSchema = z
  .strictObject({
    predicate: z.literal("count"),
    source: ConditionSourceSchema,
    ...filterField,
    thresholds: z.array(z.int().positive()).min(1).max(8),
  })
  .refine(
    (condition) =>
      condition.thresholds.every((value, i) => i === 0 || value > condition.thresholds[i - 1]!),
    { message: "thresholds precisa ser estritamente crescente.", path: ["thresholds"] },
  );

export type CountCondition = z.infer<typeof CountConditionSchema>;

/** `streak { source, filter, length }` — vitórias seguidas, sem interrupção. */
export const StreakConditionSchema = z.strictObject({
  predicate: z.literal("streak"),
  source: ConditionSourceSchema,
  ...filterField,
  length: z.int().min(2).max(1000),
});

export type StreakCondition = z.infer<typeof StreakConditionSchema>;

/** `first { source, filter }` — a primeira vez que algo acontece. */
export const FirstConditionSchema = z.strictObject({
  predicate: z.literal("first"),
  source: ConditionSourceSchema,
  ...filterField,
});

export type FirstCondition = z.infer<typeof FirstConditionSchema>;

/** `set { source, dimension, values[] }` — o conjunto completo de uma dimensão. */
export const SetConditionSchema = z
  .strictObject({
    predicate: z.literal("set"),
    source: ConditionSourceSchema,
    ...filterField,
    dimension: ConditionDimensionSchema,
    values: z.array(z.string().min(1)).min(2).max(32),
  })
  .refine((condition) => new Set(condition.values).size === condition.values.length, {
    message: "values não pode repetir um valor.",
    path: ["values"],
  });

export type SetCondition = z.infer<typeof SetConditionSchema>;

/** `record { source, metric, direction }` — a melhor marca até agora, com piso opcional. */
export const RecordConditionSchema = z.strictObject({
  predicate: z.literal("record"),
  source: ConditionSourceSchema,
  ...filterField,
  metric: RecordMetricSchema,
  direction: RecordDirectionSchema,
  min: z.int().nonnegative().optional(),
});

export type RecordCondition = z.infer<typeof RecordConditionSchema>;

/** Os cinco predicados, discriminados por `predicate`. */
export const ConditionSchema = z.discriminatedUnion("predicate", [
  CountConditionSchema,
  StreakConditionSchema,
  FirstConditionSchema,
  SetConditionSchema,
  RecordConditionSchema,
]);

export type Condition = z.infer<typeof ConditionSchema>;

/** Os nomes dos predicados, para exibição e para teste de exaustividade. */
export const CONDITION_PREDICATES = ["count", "streak", "first", "set", "record"] as const;

export type ConditionPredicate = (typeof CONDITION_PREDICATES)[number];
