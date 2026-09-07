import {
  AGENT_ROLE_VALUES,
  ENFORCEMENT_LEVEL_VALUES,
  EXECUTION_MODE_VALUES,
  HARNESS_KEY_VALUES,
  type ContextPolicy,
  type EnvironmentPolicy,
  type HarnessCapabilities,
  type KnowledgePolicy,
  type McpServerRef,
  type NetworkPolicy,
  type PermissionPolicy,
  WORKSPACE_STRATEGY_VALUES,
} from "@dungeon-master/contracts";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./user.js";

/**
 * Os cadastros de execução: Harness, Model, Agent, ExecutionProfile e Loadout.
 *
 * Agent, Harness e Model são tabelas diferentes de propósito (documento
 * técnico, seção 5.2): o papel é independente da ferramenta, e a ferramenta é
 * independente do modelo. Juntar os três numa tabela só faria "trocar de
 * modelo" virar "redefinir o papel".
 *
 * Como em toda tabela do sistema, os valores dos enums vêm de
 * `@dungeon-master/contracts`: o tipo do PostgreSQL, o enum Zod e as regras do
 * domínio precisam concordar, e usar o mesmo array nos três é a única forma de
 * garantir isso sem disciplina.
 */

export const harnessKey = pgEnum("harness_key", HARNESS_KEY_VALUES);
export const agentRole = pgEnum("agent_role", AGENT_ROLE_VALUES);
export const executionMode = pgEnum("execution_mode", EXECUTION_MODE_VALUES);
export const workspaceStrategy = pgEnum("workspace_strategy", WORKSPACE_STRATEGY_VALUES);
export const enforcementLevel = pgEnum("enforcement_level", ENFORCEMENT_LEVEL_VALUES);

/**
 * Harness é a Guilda: o runtime/CLI que executa o agente.
 *
 * O cadastro é fechado — as quatro linhas nascem no `db:seed` e a aplicação
 * nunca cria uma quinta. `key` é único por usuário justamente para impedir
 * isso: um harness novo é um adapter novo, não um `INSERT`.
 *
 * `capabilities` é a matriz da seção 32 do documento técnico. Fica em `jsonb`
 * e não em onze colunas booleanas porque ela cresce a cada capability nova, e
 * uma migração por booleano seria só cerimônia; o fechamento vale no tipo
 * `HarnessCapabilities`, que é obrigatório na escrita.
 */
export const harnesses = pgTable(
  "harness",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: harnessKey("key").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    capabilities: jsonb("capabilities").$type<HarnessCapabilities>().notNull(),
    installedVersion: text("installed_version"),
    checkedAt: timestamp("checked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("harness_user_key_uq").on(table.userId, table.key)],
);

/**
 * Model é o Patrono: o LLM que o harness usa.
 *
 * Pertence a um Harness porque a chave é do vocabulário dele. Uma tabela global
 * de modelos obrigaria a traduzir o nome na hora de montar a linha de comando,
 * e é exatamente esse tipo de tradução que produz `if (harness === ...)`.
 */
export const models = pgTable(
  "model",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    harnessId: uuid("harness_id")
      .notNull()
      .references(() => harnesses.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("model_harness_key_uq").on(table.harnessId, table.key),
    index("model_harness_idx").on(table.harnessId, table.name),
  ],
);

/** Agent é o Herói: papel e comportamento, sem ferramenta nem modelo. */
export const agents = pgTable(
  "agent",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: agentRole("role").notNull(),
    instructions: text("instructions").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("agent_user_name_uq").on(table.userId, table.name)],
);

/**
 * ExecutionProfile: onde e sob quais regras um Run roda.
 *
 * `mode` e `workspace_strategy` são colunas separadas porque são eixos
 * ortogonais (planejamento v0.4, Fase 2C): worktree não é backend de execução.
 * `enforcement` é a terceira coluna e não um booleano de sandbox, porque
 * "pedimos e não há barreira", "a CLI aplica" e "o ambiente limita de fato" são
 * três coisas diferentes que a interface precisa distinguir (documento
 * técnico, seção 15).
 *
 * `enabled` existe para o perfil "Masmorra selada" nascer desligado: o modo
 * Docker só é implementado na Fase 2C, e um perfil escolhível antes disso
 * produziria um Run que o worker não sabe executar.
 */
export const executionProfiles = pgTable(
  "execution_profile",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mode: executionMode("mode").notNull(),
    workspaceStrategy: workspaceStrategy("workspace_strategy").notNull(),
    enforcement: enforcementLevel("enforcement").notNull(),
    permissionPolicy: jsonb("permission_policy").$type<PermissionPolicy>().notNull(),
    environmentPolicy: jsonb("environment_policy").$type<EnvironmentPolicy>().notNull(),
    networkPolicy: jsonb("network_policy").$type<NetworkPolicy>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("execution_profile_user_name_uq").on(table.userId, table.name)],
);

/**
 * Loadout é o Equipamento: a configuração completa de uma execução.
 *
 * `version` sobe a cada edição que muda alguma coisa, e o Run guarda o número
 * junto do snapshot. Sem ele, dois Runs com o mesmo `loadout_id` seriam
 * indistinguíveis no histórico mesmo tendo rodado com equipamentos diferentes —
 * e comparar loadouts é metade da razão de Run existir separado de Task.
 *
 * O `on delete restrict` das quatro referências é deliberado: apagar um Agent
 * que um Loadout usa deixaria o Loadout apontando para o nada. O caminho é
 * apagar o Loadout primeiro, e a API diz isso no `409`.
 */
export const loadouts = pgTable(
  "loadout",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    harnessId: uuid("harness_id")
      .notNull()
      .references(() => harnesses.id, { onDelete: "restrict" }),
    modelId: uuid("model_id").references(() => models.id, { onDelete: "set null" }),
    executionProfileId: uuid("execution_profile_id")
      .notNull()
      .references(() => executionProfiles.id, { onDelete: "restrict" }),
    skills: jsonb("skills").$type<string[]>().notNull(),
    tools: jsonb("tools").$type<string[]>().notNull(),
    mcpServers: jsonb("mcp_servers").$type<McpServerRef[]>().notNull(),
    knowledgePolicy: jsonb("knowledge_policy").$type<KnowledgePolicy>().notNull(),
    contextPolicy: jsonb("context_policy").$type<ContextPolicy>().notNull(),
    version: integer("version").notNull().default(1),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("loadout_user_name_uq").on(table.userId, table.name),
    index("loadout_agent_idx").on(table.agentId),
    index("loadout_harness_idx").on(table.harnessId),
    index("loadout_execution_profile_idx").on(table.executionProfileId),
  ],
);

export type HarnessRow = typeof harnesses.$inferSelect;
export type NewHarnessRow = typeof harnesses.$inferInsert;
export type ModelRow = typeof models.$inferSelect;
export type NewModelRow = typeof models.$inferInsert;
export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
export type ExecutionProfileRow = typeof executionProfiles.$inferSelect;
export type NewExecutionProfileRow = typeof executionProfiles.$inferInsert;
export type LoadoutRow = typeof loadouts.$inferSelect;
export type NewLoadoutRow = typeof loadouts.$inferInsert;
