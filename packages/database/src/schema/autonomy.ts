import {
  BREAKER_SCOPE_VALUES,
  BREAKER_STATE_VALUES,
  BUDGET_ACTION_VALUES,
  BUDGET_SCOPE_VALUES,
  BUDGET_WINDOW_VALUES,
  type BreakerTriggers,
  POLICY_ACTION_VALUES,
  POLICY_SUBJECT_VALUES,
  ROUTING_KIND_VALUES,
  type RuleConditions,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { harnessKey, loadouts } from "./execution.js";
import { projects } from "./project.js";
import { runs } from "./run.js";
import { users } from "./user.js";

/**
 * As regras da autonomia controlada (planejamento v0.4, Fase 9A): política de
 * aprovação, orçamento, disjuntor e regra de roteamento.
 *
 * São **dados com vocabulário fechado**, como os Rituais: as condições ficam
 * em `jsonb` validado por `RuleConditions` na escrita, e o casamento é função
 * pura do domínio. Nenhuma tabela aqui pertence a um Project — uma regra
 * escopada por Project é uma regra global com um filtro —, e por isso os
 * eventos delas saem em `registry.changed`, como os cadastros.
 *
 * Os enums vêm de `@dungeon-master/contracts`, como em toda tabela: o tipo
 * do PostgreSQL, o enum Zod e o domínio precisam concordar.
 */

export const policySubject = pgEnum("policy_subject", POLICY_SUBJECT_VALUES);
export const policyAction = pgEnum("policy_action", POLICY_ACTION_VALUES);
export const budgetScope = pgEnum("budget_scope", BUDGET_SCOPE_VALUES);
export const budgetWindow = pgEnum("budget_window", BUDGET_WINDOW_VALUES);
export const budgetAction = pgEnum("budget_action", BUDGET_ACTION_VALUES);
export const breakerScope = pgEnum("breaker_scope", BREAKER_SCOPE_VALUES);
export const breakerState = pgEnum("breaker_state", BREAKER_STATE_VALUES);
export const routingKind = pgEnum("routing_kind", ROUTING_KIND_VALUES);

/**
 * ApprovalPolicy: decide, sem humano, uma proposta, uma partida ou um gate.
 *
 * `project_id` nulo é global. `on delete cascade` do Project: uma política
 * de um Project que sumiu não tem sobre o que decidir.
 */
export const approvalPolicies = pgTable(
  "approval_policy",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subject: policySubject("subject").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(100),
    conditions: jsonb("conditions").$type<RuleConditions>().notNull(),
    action: policyAction("action").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // A avaliação lê "as ligadas deste assunto, do Project ou globais".
    index("approval_policy_user_subject_idx").on(table.userId, table.subject, table.enabled),
    index("approval_policy_project_idx").on(table.projectId),
    check("approval_policy_priority_ck", sql`"priority" >= 0`),
  ],
);

/**
 * Budget: um teto por escopo e janela.
 *
 * `max_tokens` e `max_wall_clock_ms` são `bigint`: um mês de execução em
 * milissegundos passa de dois bilhões, e um teto que não cabe na coluna não é
 * teto. Os `CHECK` prendem o id de escopo ao escopo e exigem pelo menos um
 * teto — um orçamento sem teto não mede nada e ninguém saberia por quê.
 */
export const budgets = pgTable(
  "budget",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scope: budgetScope("scope").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    loadoutId: uuid("loadout_id").references(() => loadouts.id, { onDelete: "cascade" }),
    window: budgetWindow("window").notNull(),
    maxTokens: bigint("max_tokens", { mode: "number" }),
    maxRuns: integer("max_runs"),
    maxWallClockMs: bigint("max_wall_clock_ms", { mode: "number" }),
    maxConcurrentRuns: integer("max_concurrent_runs"),
    action: budgetAction("action").notNull().default("BLOCK"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("budget_user_scope_idx").on(table.userId, table.scope, table.enabled),
    index("budget_project_idx").on(table.projectId),
    index("budget_loadout_idx").on(table.loadoutId),
    check("budget_project_scope_ck", sql`("scope" = 'PROJECT') = ("project_id" is not null)`),
    check("budget_loadout_scope_ck", sql`("scope" = 'LOADOUT') = ("loadout_id" is not null)`),
    check(
      "budget_some_limit_ck",
      sql`"max_tokens" is not null or "max_runs" is not null or "max_wall_clock_ms" is not null or "max_concurrent_runs" is not null`,
    ),
    check(
      "budget_limits_positive_ck",
      sql`coalesce("max_tokens", 1) > 0 and coalesce("max_runs", 1) > 0 and coalesce("max_wall_clock_ms", 1) > 0 and coalesce("max_concurrent_runs", 1) > 0`,
    ),
  ],
);

/**
 * CircuitBreaker: o disjuntor de um escopo, com o estado e a sondagem.
 *
 * O estado só muda por CAS (`WHERE state = <esperado>`): a admissão em
 * `POST /runs`, o desfecho gravado pelo Worker (9B) e o reset disputam a
 * mesma linha, e quem perde vê o estado atual em vez de sobrescrevê-lo. Os
 * `CHECK` fecham a metade estrutural: `OPEN`/`HALF_OPEN` têm instante de
 * abertura, `CLOSED` não; só `HALF_OPEN` tem sondagem.
 *
 * `probe_run_id` é `set null`: apagar o Run de sondagem não pode deixar o
 * disjuntor apontando para o nada, e um `HALF_OPEN` sem sondagem volta a
 * aceitar uma.
 */
export const circuitBreakers = pgTable(
  "circuit_breaker",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scope: breakerScope("scope").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    loadoutId: uuid("loadout_id").references(() => loadouts.id, { onDelete: "cascade" }),
    harnessKey: harnessKey("harness_key"),
    triggers: jsonb("triggers").$type<BreakerTriggers>().notNull(),
    cooldownMs: integer("cooldown_ms").notNull(),
    state: breakerState("state").notNull().default("CLOSED"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }),
    reason: text("reason"),
    probeRunId: uuid("probe_run_id").references(() => runs.id, { onDelete: "set null" }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("circuit_breaker_user_scope_idx").on(table.userId, table.scope, table.enabled),
    index("circuit_breaker_project_idx").on(table.projectId),
    index("circuit_breaker_loadout_idx").on(table.loadoutId),
    check(
      "circuit_breaker_project_scope_ck",
      sql`("scope" = 'PROJECT') = ("project_id" is not null)`,
    ),
    check(
      "circuit_breaker_loadout_scope_ck",
      sql`("scope" = 'LOADOUT') = ("loadout_id" is not null)`,
    ),
    check(
      "circuit_breaker_harness_scope_ck",
      sql`("scope" = 'HARNESS') = ("harness_key" is not null)`,
    ),
    check("circuit_breaker_opened_ck", sql`("state" = 'CLOSED') = ("opened_at" is null)`),
    check("circuit_breaker_probe_ck", sql`"probe_run_id" is null or "state" = 'HALF_OPEN'`),
    check("circuit_breaker_cooldown_ck", sql`"cooldown_ms" > 0`),
  ],
);

/**
 * RoutingRule: escolhe Model, Loadout ou Workflow por condições.
 *
 * `target_id` e `fallback_ids` não têm chave estrangeira porque a tabela
 * alvo depende de `kind`: a validade do alvo é conferida na escrita e, de
 * novo, na hora de rotear — um alvo que sumiu é pulado com o motivo, e a
 * decisão diz que caiu no padrão.
 */
export const routingRules = pgTable(
  "routing_rule",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: routingKind("kind").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(100),
    conditions: jsonb("conditions").$type<RuleConditions>().notNull(),
    targetId: uuid("target_id").notNull(),
    fallbackIds: jsonb("fallback_ids").$type<string[]>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("routing_rule_user_kind_idx").on(table.userId, table.kind, table.enabled),
    index("routing_rule_project_idx").on(table.projectId),
    check("routing_rule_priority_ck", sql`"priority" >= 0`),
  ],
);

export type ApprovalPolicyRow = typeof approvalPolicies.$inferSelect;
export type NewApprovalPolicyRow = typeof approvalPolicies.$inferInsert;
export type BudgetRow = typeof budgets.$inferSelect;
export type NewBudgetRow = typeof budgets.$inferInsert;
export type CircuitBreakerRow = typeof circuitBreakers.$inferSelect;
export type NewCircuitBreakerRow = typeof circuitBreakers.$inferInsert;
export type RoutingRuleRow = typeof routingRules.$inferSelect;
export type NewRoutingRuleRow = typeof routingRules.$inferInsert;
