import { METRIC_DIMENSION_VALUES } from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { executionMode, harnessKey, models } from "./execution.js";
import { projects } from "./project.js";
import { runCreatedBy, runs, runStatus } from "./run.js";
import { taskKind, tasks } from "./task.js";
import { users } from "./user.js";

/**
 * As quatro tabelas da Fase 10A (planejamento v0.4, seção 7).
 *
 * `run_metric` e `metric_daily` são **projeção**, com a mesma disciplina das
 * Conquistas: podem ser truncadas e reconstruídas de `run`, `run_event` e
 * `run_context`, e nenhuma delas alcança a execução de um Run. `model_price` é
 * o contrário — é **cadastro**, digitado pelo usuário, e por isso nunca é
 * apagado por um `rebuild`.
 *
 * ## Tokens nulos, nunca zero
 *
 * As quatro colunas de token são anuláveis de propósito. Um harness que não
 * reporta `Usage` deixa nulo; um que reporta zero cache grava zero. Achatar os
 * dois em `0` faria a média de tokens por Run mentir para baixo para sempre, e
 * `tokens_known` existe para que toda soma tenha um denominador honesto ao lado.
 */

export const metricDimension = pgEnum("metric_dimension", METRIC_DIMENSION_VALUES);

/**
 * As fontes duráveis que o projetor de métricas consome, cada uma com o seu
 * cursor. Hoje só uma, e a tabela já é chaveada por fonte pelo mesmo motivo de
 * `achievement_cursor`: acrescentar a segunda não pode pedir migração.
 */
export const METRIC_SOURCE_VALUES = ["run"] as const;

export const metricSource = pgEnum("metric_source", METRIC_SOURCE_VALUES);

export type MetricSource = (typeof METRIC_SOURCE_VALUES)[number];

/**
 * Uma linha por Expedição terminal.
 *
 * A chave é `run_id`: reprocessar o mesmo Run reescreve a linha em vez de
 * duplicá-la, e **é isso que faz a projeção ser idempotente** sem nenhuma marca
 * extra. O `on delete cascade` é deliberado — a métrica de um Run apagado não
 * tem o que medir.
 *
 * Quase tudo aqui é **cópia**, e não junção: `harness_key`, `model_key`,
 * `provider_id`, `loadout_version`, `task_kind`. É a mesma razão do Run guardar
 * o snapshot do Loadout (documento técnico, seção 13): trocar o Model de um
 * Loadout não pode reescrever a história de quanto custou o mês passado.
 */
export const runMetrics = pgTable(
  "run_metric",
  {
    runId: uuid("run_id")
      .primaryKey()
      .references(() => runs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    taskKind: taskKind("task_kind").notNull(),
    harnessKey: harnessKey("harness_key").notNull(),
    modelKey: text("model_key"),
    /**
     * O Provider do Model no instante da projeção, quando havia um.
     *
     * Sem chave estrangeira de propósito, como `execution_stats.scope_id`: o
     * custo do mês passado continua atribuído ao Provider que o serviu, mesmo
     * depois de alguém apagar o cadastro dele.
     */
    providerId: uuid("provider_id"),
    loadoutId: uuid("loadout_id").notNull(),
    loadoutVersion: integer("loadout_version").notNull(),
    executionMode: executionMode("execution_mode").notNull(),
    createdBy: runCreatedBy("created_by").notNull(),
    parentRunId: uuid("parent_run_id"),
    status: runStatus("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }).notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }),
    /** Da criação ao início. Nulo num Run que nunca começou. */
    queueMs: bigint("queue_ms", { mode: "number" }),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }),
    tokensKnown: boolean("tokens_known").notNull().default(false),
    /** O que o contexto montado custou, de `run_context`. */
    contextTokens: integer("context_tokens"),
    contextItems: integer("context_items"),
    contextSections: integer("context_sections"),
    contextTruncations: integer("context_truncations"),
    /** `{ "knowledge": 4, "native": 12 }` — o prefixo `mcp__<servidor>__` separa. */
    toolCallsByServer: jsonb("tool_calls_by_server")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    toolCalls: integer("tool_calls").notNull().default(0),
    /** Passos por tipo de WorkflowStep. Vazio num Run sem Workflow. */
    stepsByType: jsonb("steps_by_type").$type<Record<string, number>>().notNull().default({}),
    gatesGrantedUser: integer("gates_granted_user").notNull().default(0),
    gatesGrantedPolicy: integer("gates_granted_policy").notNull().default(0),
    childrenDelegated: integer("children_delegated").notNull().default(0),
    /** Data UTC de `finished_at`. A chave do rollup. */
    day: date("day", { mode: "string" }).notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A varredura de uma janela é sempre "deste usuário, entre dois dias".
    index("run_metric_user_day_idx").on(table.userId, table.day),
    // O recálculo de custo de um preço novo é "quais dias este Model tocou?".
    index("run_metric_user_model_day_idx").on(table.userId, table.modelKey, table.day),
    index("run_metric_project_day_idx").on(table.projectId, table.day),
    check("run_metric_tool_calls_nonnegative_ck", sql`"tool_calls" >= 0`),
    check("run_metric_duration_nonnegative_ck", sql`"duration_ms" is null or "duration_ms" >= 0`),
    check("run_metric_queue_nonnegative_ck", sql`"queue_ms" is null or "queue_ms" >= 0`),
    // Um desfecho não terminal aqui seria uma linha sem fato: `run_metric` é a
    // Expedição **acabada**, e o projetor só lê `finished_at is not null`.
    check(
      "run_metric_status_terminal_ck",
      sql`"status" in ('SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED')`,
    ),
  ],
);

/**
 * O rollup diário, uma linha por `(usuário, dia, dimensão, chave)`.
 *
 * **Sempre recalculado**, nunca somado incrementalmente: o custo de um Run
 * depende do preço vigente, e um preço cadastrado hoje muda o custo de ontem.
 * Um lote do projetor refaz os dias que tocou; um preço novo refaz os dias do
 * Model. A conta é a mesma função pura nos dois casos, e é por isso que
 * `dm metrics rebuild` reproduz exatamente o que a projeção ao vivo produziu.
 *
 * `cost_by_currency` é `jsonb` e não duas colunas porque somas só valem dentro
 * da mesma moeda: uma coluna `cost` com uma coluna `currency` ao lado obrigaria
 * a escolher uma moeda por dia, e o dia em que o usuário usar duas ficaria
 * errado em silêncio.
 */
export const metricDaily = pgTable(
  "metric_daily",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    dimension: metricDimension("dimension").notNull(),
    /** Id, chave ou valor de enum. `ALL` na dimensão `ALL`. */
    dimensionKey: text("dimension_key").notNull(),
    runsTotal: integer("runs_total").notNull().default(0),
    runsSucceeded: integer("runs_succeeded").notNull().default(0),
    runsFailed: integer("runs_failed").notNull().default(0),
    runsTimedOut: integer("runs_timed_out").notNull().default(0),
    runsCancelled: integer("runs_cancelled").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull().default(0),
    tokensKnownRuns: integer("tokens_known_runs").notNull().default(0),
    durationMsTotal: bigint("duration_ms_total", { mode: "number" }).notNull().default(0),
    durationMsMax: bigint("duration_ms_max", { mode: "number" }).notNull().default(0),
    durationRuns: integer("duration_runs").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    costByCurrency: jsonb("cost_by_currency").$type<Record<string, number>>().notNull().default({}),
    pricedRuns: integer("priced_runs").notNull().default(0),
    /** Runs sem preço vigente ou sem tokens. Nunca somados como zero. */
    unpricedRuns: integer("unpriced_runs").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.day, table.dimension, table.dimensionKey],
      name: "metric_daily_pk",
    }),
    // "Desta dimensão, nesta janela": a consulta de toda série e de todo tile.
    index("metric_daily_dimension_idx").on(table.userId, table.dimension, table.day),
  ],
);

/**
 * Onde o projetor de métricas parou.
 *
 * Mesmo desenho de `achievement_cursor`, e pelos mesmos motivos: o par
 * `(position_at, position_id)` ordena a fonte, e `position_id` é `text` para
 * caber tanto um UUID quanto um número de sequência.
 *
 * A fonte escolhida é **`run.finished_at`**, e não o `run_event` terminal.
 * `finished_at` é escrito por `applyRunStatus` em **toda** transição terminal,
 * por qualquer caminho — inclusive o cancelamento de um Run que nunca saiu da
 * fila e portanto nunca produziu evento de execução. E como os quatro estados
 * terminais não têm saída na máquina de estados, isso dá exatamente uma linha
 * por Run: contar por ali é exatamente-uma-vez sem nenhuma marca extra. O
 * `run_event` entra só como detalhe do Run já selecionado — `Usage`, `ToolCall`
 * e as aprovações.
 */
export const metricCursors = pgTable(
  "metric_cursor",
  {
    source: metricSource("source").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    positionAt: timestamp("position_at", { withTimezone: true, mode: "date" }),
    positionId: text("position_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.source, table.userId], name: "metric_cursor_pk" })],
);

/**
 * O preço de um Model, por vigência.
 *
 * **Append-only**: cadastrar um preço novo fecha a vigência anterior
 * (`effective_to`) e abre outra. Sobrescrever a linha faria o custo do mês
 * passado mudar sozinho no dia de um reajuste, e o relatório de março deixaria
 * de bater com o que foi pago em março.
 *
 * O índice único parcial é o que garante **uma vigência corrente por Model**:
 * duas linhas com `effective_to is null` fariam `priceAt` escolher por
 * desempate, e o desempate de um dado torto não é uma regra de negócio.
 *
 * `numeric` e não `double precision`: preço é dinheiro, e o binário de ponto
 * flutuante não representa 0,3 exatamente. A conta do custo acontece em
 * JavaScript, onde o arredondamento é explícito e documentado (`MONEY_SCALE`).
 */
export const modelPrices = pgTable(
  "model_price",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    inputPerMillion: numeric("input_per_million", { precision: 20, scale: 8 }).notNull(),
    outputPerMillion: numeric("output_per_million", { precision: 20, scale: 8 }).notNull(),
    cacheReadPerMillion: numeric("cache_read_per_million", { precision: 20, scale: 8 }).notNull(),
    cacheWritePerMillion: numeric("cache_write_per_million", { precision: 20, scale: 8 }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    /** Nulo é a vigência corrente. */
    effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("model_price_current_uq")
      .on(table.modelId)
      .where(sql`effective_to is null`),
    // "Qual preço valia no dia deste Run?" é a única leitura quente daqui.
    index("model_price_model_from_idx").on(table.modelId, table.effectiveFrom),
    check("model_price_currency_ck", sql`"currency" ~ '^[A-Z]{3}$'`),
    check("model_price_range_ck", sql`"effective_to" is null or "effective_to" > "effective_from"`),
    check(
      "model_price_nonnegative_ck",
      sql`"input_per_million" >= 0 and "output_per_million" >= 0 and "cache_read_per_million" >= 0 and "cache_write_per_million" >= 0`,
    ),
  ],
);

export type RunMetricRow = typeof runMetrics.$inferSelect;
export type NewRunMetricRow = typeof runMetrics.$inferInsert;
export type MetricDailyRow = typeof metricDaily.$inferSelect;
export type NewMetricDailyRow = typeof metricDaily.$inferInsert;
export type MetricCursorRow = typeof metricCursors.$inferSelect;
export type ModelPriceRow = typeof modelPrices.$inferSelect;
export type NewModelPriceRow = typeof modelPrices.$inferInsert;
