import {
  AGENT_ROLE_VALUES,
  ENFORCEMENT_LEVEL_VALUES,
  EXECUTION_MODE_VALUES,
  HARNESS_AUTH_STATUS_VALUES,
  HARNESS_KEY_VALUES,
  type ContextPolicy,
  type EnvironmentPolicy,
  type HarnessCapabilities,
  type KnowledgePolicy,
  type LoadoutDefinition,
  type NetworkPolicy,
  type PermissionPolicy,
  WORKSPACE_STRATEGY_VALUES,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { mcpServers, providers, skills, tools } from "./registry.js";
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
export const harnessAuthStatus = pgEnum("harness_auth_status", HARNESS_AUTH_STATUS_VALUES);
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
 *
 * `auth_status`, `auth_checked_at` e `auth_reason` (migração `0016`, Fase 8B)
 * são o que a CLI respondeu sobre a credencial dela no boot do Worker desta
 * máquina. Colunas próprias, e não chaves dentro de `capabilities`: a matriz
 * diz o que o código sabe fazer e é mesclada chave a chave; a credencial é um
 * estado medido, com instante, e não uma capability.
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
    authStatus: harnessAuthStatus("auth_status"),
    authCheckedAt: timestamp("auth_checked_at", { withTimezone: true, mode: "date" }),
    /** Uma frase sem segredo: o comando local e o que ele respondeu. */
    authReason: text("auth_reason"),
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
    /**
     * Quem serve o modelo (Fase 8A). `restrict`, e não `set null`: apagar o
     * Provider deixaria o preflight sem saber que credencial procurar, e a API
     * diz isso no `409` com os Models que ainda apontam para ele.
     */
    providerId: uuid("provider_id").references(() => providers.id, { onDelete: "restrict" }),
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
    index("model_provider_idx").on(table.providerId),
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
 * Desde a Fase 8A cada número tem uma linha em `loadout_version` com a
 * definição daquele instante, e é ela que o restore reaplica.
 *
 * Skills, Tools e servidores MCP saíram das colunas `jsonb` (migração `0015`)
 * para as junções `loadout_skill`, `loadout_tool` e `loadout_mcp`: são
 * referências a registros versionados, e uma referência em `jsonb` não tem
 * chave estrangeira nem `restrict`.
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

/**
 * As referências do Loadout, uma junção por registro.
 *
 * `position` guarda a ordem em que o Loadout as declara: a ordem das Skills é
 * a ordem em que o conteúdo entra no prompt, e um conjunto sem ordem mudaria o
 * prompt entre dois Runs do mesmo Loadout. `skill_id`, `tool_id` e
 * `mcp_server_id` são `restrict`: um registro em uso não se apaga, e a API
 * nomeia os Loadouts no `409`. Do Loadout para cá é `cascade`: apagar o
 * Loadout apaga as referências dele, e só elas.
 *
 * `pinned_version` nulo é "siga a mais recente na hora de congelar o Run".
 */
export const loadoutSkills = pgTable(
  "loadout_skill",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    loadoutId: uuid("loadout_id")
      .notNull()
      .references(() => loadouts.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "restrict" }),
    pinnedVersion: integer("pinned_version"),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.loadoutId, table.skillId], name: "loadout_skill_pk" }),
    index("loadout_skill_skill_idx").on(table.skillId),
    check("loadout_skill_pin_positive_ck", sql`"pinned_version" is null or "pinned_version" > 0`),
  ],
);

export const loadoutTools = pgTable(
  "loadout_tool",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    loadoutId: uuid("loadout_id")
      .notNull()
      .references(() => loadouts.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.loadoutId, table.toolId], name: "loadout_tool_pk" }),
    index("loadout_tool_tool_idx").on(table.toolId),
  ],
);

export const loadoutMcpServers = pgTable(
  "loadout_mcp",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    loadoutId: uuid("loadout_id")
      .notNull()
      .references(() => loadouts.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.loadoutId, table.mcpServerId], name: "loadout_mcp_pk" }),
    index("loadout_mcp_server_idx").on(table.mcpServerId),
  ],
);

/**
 * Uma versão guardada do Loadout: a definição por referências daquele número.
 *
 * Imutável, como `workflow_version`: sem `updated_at`, e nenhuma escrita faz
 * `UPDATE`. Toda edição que sobe `loadout.version` insere a linha
 * correspondente na mesma transação, e o restore de uma versão antiga cria uma
 * versão **nova** com a definição dela — a história nunca é reescrita.
 */
export const loadoutVersions = pgTable(
  "loadout_version",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    loadoutId: uuid("loadout_id")
      .notNull()
      .references(() => loadouts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<LoadoutDefinition>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("loadout_version_loadout_version_uq").on(table.loadoutId, table.version),
    check("loadout_version_positive_ck", sql`"version" > 0`),
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
export type LoadoutSkillRow = typeof loadoutSkills.$inferSelect;
export type LoadoutToolRow = typeof loadoutTools.$inferSelect;
export type LoadoutMcpServerRow = typeof loadoutMcpServers.$inferSelect;
export type LoadoutVersionRow = typeof loadoutVersions.$inferSelect;
export type NewLoadoutVersionRow = typeof loadoutVersions.$inferInsert;
