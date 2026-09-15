import {
  BILLING_KIND_VALUES,
  type HarnessKey,
  MCP_TRANSPORT_VALUES,
  PROVIDER_KIND_VALUES,
  TOOL_KIND_VALUES,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./user.js";

/**
 * Os registros da Fase 8A: Skill (com versões), Provider, servidor MCP e Tool.
 *
 * São **dados versionados, não código** (planejamento v0.4, Fase 8). Uma Skill
 * é um registro com nome e uma pilha de versões imutáveis; um servidor MCP é
 * uma forma de subir um processo, sem segredo; uma Tool é um comando liberado
 * ou uma ferramenta de um servidor; um Provider é quem serve os modelos e como
 * se autentica nele — só os **nomes** das variáveis, nunca o valor.
 *
 * Os enums vêm de `@dungeon-master/contracts`, como em toda tabela: o tipo do
 * PostgreSQL, o enum Zod e as regras do domínio precisam concordar.
 */

export const toolKind = pgEnum("tool_kind", TOOL_KIND_VALUES);
export const providerKind = pgEnum("provider_kind", PROVIDER_KIND_VALUES);
export const mcpTransport = pgEnum("mcp_transport", MCP_TRANSPORT_VALUES);
export const billingKind = pgEnum("billing_kind", BILLING_KIND_VALUES);

/**
 * Skill: o registro. O conteúdo mora em `skill_version`.
 *
 * `latest_version` é desnormalizado de propósito: é o número que a listagem e
 * a resolução do pin leem a cada Run, e um `max()` por Skill em toda leitura
 * custaria uma junção onde basta uma coluna. Ele só sobe dentro da mesma
 * transação que insere a versão, com a linha travada.
 */
export const skills = pgTable(
  "skill",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    latestVersion: integer("latest_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("skill_user_name_uq").on(table.userId, table.name),
    check("skill_latest_version_positive_ck", sql`"latest_version" > 0`),
  ],
);

/**
 * Uma versão imutável do conteúdo de uma Skill.
 *
 * Sem `updated_at`, e nenhuma função de escrita faz `UPDATE` aqui: publicar é
 * inserir a versão seguinte. `on delete cascade` da Skill é seguro porque
 * `loadout_skill.skill_id` é `restrict` — uma Skill em uso não se apaga.
 */
export const skillVersions = pgTable(
  "skill_version",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    changelog: text("changelog"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("skill_version_skill_version_uq").on(table.skillId, table.version),
    check("skill_version_positive_ck", sql`"version" > 0`),
  ],
);

/**
 * Provider: quem serve os modelos.
 *
 * `auth_env_keys` são nomes de variáveis de ambiente; `harness_keys` são as
 * chaves dos Harnesses que o usam. Os dois em `jsonb` porque são listas
 * pequenas lidas inteiras, e uma tabela de junção para quatro linhas seria
 * cerimônia.
 */
export const providers = pgTable(
  "provider",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: providerKind("kind").notNull(),
    authEnvKeys: jsonb("auth_env_keys").$type<string[]>().notNull(),
    harnessKeys: jsonb("harness_keys").$type<HarnessKey[]>().notNull(),
    docsUrl: text("docs_url"),
    /**
     * Como o Provider **cobra** (Fase 10A). Não é o mesmo que `kind`, que diz
     * como ele **autentica**: uma CLI que entra por login pode cobrar por
     * token, e uma chave de API pode vir de um plano fixo. Nulo é desconhecido,
     * e desconhecido faz o custo sair `NOT_MEASURED` em vez de zero.
     */
    billingKind: billingKind("billing_kind"),
    monthlyCost: numeric("monthly_cost", { precision: 20, scale: 8 }),
    currency: text("currency"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("provider_user_name_uq").on(table.userId, table.name),
    // Uma mensalidade sem moeda é um número sem unidade, e o contrário é uma
    // moeda sem valor: o `CHECK` prende os dois juntos no banco, e não só no
    // Zod. Mensalidade só faz sentido em assinatura.
    check(
      "provider_monthly_cost_ck",
      sql`("monthly_cost" is null) = ("currency" is null) and ("monthly_cost" is null or "billing_kind" = 'SUBSCRIPTION')`,
    ),
    check(
      "provider_monthly_cost_nonnegative_ck",
      sql`"monthly_cost" is null or "monthly_cost" >= 0`,
    ),
    check("provider_currency_ck", sql`"currency" is null or "currency" ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * Servidor MCP: a forma de subi-lo, sem segredo.
 *
 * `STDIO` tem `command` e `args` separados — um caminho com espaço sobrevive,
 * o que a string única da Fase 7 não garantia. `HTTP` tem `url`. O `CHECK`
 * prende a forma ao transporte no banco, e não só no Zod: uma linha com URL e
 * transporte `STDIO` seria um servidor que ninguém sabe subir.
 *
 * `env_keys` são **nomes**. O valor viaja pelo ambiente do processo do
 * Worker, nunca pelo argv e nunca por aqui.
 */
export const mcpServers = pgTable(
  "mcp_server",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    transport: mcpTransport("transport").notNull(),
    command: text("command"),
    args: jsonb("args").$type<string[]>().notNull(),
    url: text("url"),
    envKeys: jsonb("env_keys").$type<string[]>().notNull(),
    readOnly: boolean("read_only").notNull().default(false),
    builtIn: boolean("built_in").notNull().default(false),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("mcp_server_user_name_uq").on(table.userId, table.name),
    check(
      "mcp_server_transport_shape_ck",
      sql`("transport" = 'STDIO' and "command" is not null and "url" is null) or ("transport" = 'HTTP' and "url" is not null and "command" is null)`,
    ),
  ],
);

/**
 * Tool: um comando liberado (`COMMAND`) ou a ferramenta de um servidor MCP
 * (`MCP_TOOL`). O `CHECK` prende os campos à espécie.
 *
 * `mcp_server_id` é `restrict`: apagar um servidor com Tools apontando para ele
 * deixaria ferramentas sem dono, e a API diz isso no `409`.
 */
export const tools = pgTable(
  "tool",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: toolKind("kind").notNull(),
    command: text("command"),
    mcpServerId: uuid("mcp_server_id").references(() => mcpServers.id, { onDelete: "restrict" }),
    toolName: text("tool_name"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("tool_user_name_uq").on(table.userId, table.name),
    index("tool_mcp_server_idx").on(table.mcpServerId),
    check(
      "tool_kind_shape_ck",
      sql`("kind" = 'COMMAND' and "command" is not null and "mcp_server_id" is null and "tool_name" is null) or ("kind" = 'MCP_TOOL' and "mcp_server_id" is not null and "tool_name" is not null and "command" is null)`,
    ),
  ],
);

export type SkillRow = typeof skills.$inferSelect;
export type NewSkillRow = typeof skills.$inferInsert;
export type SkillVersionRow = typeof skillVersions.$inferSelect;
export type NewSkillVersionRow = typeof skillVersions.$inferInsert;
export type ProviderRow = typeof providers.$inferSelect;
export type NewProviderRow = typeof providers.$inferInsert;
export type McpServerRow = typeof mcpServers.$inferSelect;
export type NewMcpServerRow = typeof mcpServers.$inferInsert;
export type ToolRow = typeof tools.$inferSelect;
export type NewToolRow = typeof tools.$inferInsert;
