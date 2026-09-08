import {
  ACHIEVEMENT_ORIGIN_VALUES,
  ACHIEVEMENT_RARITY_VALUES,
  ACHIEVEMENT_SCOPE_VALUES,
  type AchievementRarity,
  type Condition,
  type Provenance,
} from "@dungeon-master/achievements";
import {
  ACHIEVEMENT_REVIEW_STATUS_VALUES,
  HERO_SCOPE_VALUES,
  type ForgedAchievementProvenance,
  type HeroScope,
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
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { runs } from "./run.js";
import { tasks } from "./task.js";
import { users } from "./user.js";

/**
 * As cinco tabelas da Fase 2.5 (planejamento v0.4, seção 7).
 *
 * **Todas são projeção.** Podem ser truncadas e reconstruídas a partir de
 * `run_event`, `activity`, `task` e `project`, e nenhuma delas participa da
 * execução de um Run: uma Conquista errada é um texto errado numa carta, nunca
 * um Run que não roda (CLAUDE.md, seção 12).
 *
 * Os valores dos enums vêm de `@dungeon-master/achievements`, que é a fonte
 * única daquele vocabulário: o `z.enum` do pacote e o `pgEnum` daqui precisam
 * concordar, e usar o mesmo array nos dois é a única forma de garantir isso sem
 * disciplina.
 */

export const achievementOrigin = pgEnum("achievement_origin", ACHIEVEMENT_ORIGIN_VALUES);
export const achievementScope = pgEnum("achievement_scope", ACHIEVEMENT_SCOPE_VALUES);
export const achievementRarity = pgEnum("achievement_rarity", ACHIEVEMENT_RARITY_VALUES);

/** As fontes duráveis que o projetor consome, cada uma com o seu cursor. */
export const ACHIEVEMENT_SOURCE_VALUES = ["activity", "run_event", "dashboard_event"] as const;

export const achievementSource = pgEnum("achievement_source", ACHIEVEMENT_SOURCE_VALUES);

export type AchievementSource = (typeof ACHIEVEMENT_SOURCE_VALUES)[number];

/**
 * A revisão de uma Conquista forjada (Fase 2.5C). Só existe em `FORGED`: o
 * `CHECK` da tabela amarra a coluna à origem.
 */
export const achievementReviewStatus = pgEnum(
  "achievement_review_status",
  ACHIEVEMENT_REVIEW_STATUS_VALUES,
);

/** Herói e Equipamento acumulam a mesma coisa; o que muda é a quem ela pertence. */
export const heroScope = pgEnum("hero_scope", HERO_SCOPE_VALUES);

export type { HeroScope };

/**
 * A Conquista concreta de um usuário: do catálogo, instanciada ou forjada.
 *
 * `natural_key` é a identidade estável, e é ela que torna a carga do catálogo e
 * a instanciação de templates idempotentes: `catalog:<chave>`,
 * `template:<chave>:<escopo>`, `forged:<id>`. Sem ela seriam dois índices
 * únicos parciais — um por origem — e o `drizzle-kit` teria de round-tripar
 * predicados de índice em todo `db:check`.
 *
 * O nome guardado **mantém o placeholder** de um template (`Guardião de
 * {project}`); quem formata é a leitura da API, com o nome atual da entidade.
 * Gravar o nome já formatado deixaria a Conquista chamando a Campanha pelo nome
 * antigo depois da primeira renomeação.
 */
export const achievementDefinitions = pgTable(
  "achievement_definition",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    origin: achievementOrigin("origin").notNull(),
    naturalKey: text("natural_key").notNull(),
    /** Chave no catálogo fixo. Nula fora de `CATALOG`. */
    catalogKey: text("catalog_key"),
    /** Chave do template que gerou esta instância. Nula fora de `TEMPLATE`. */
    templateKey: text("template_key"),
    /** Versão do catálogo que produziu a linha, para a carga saber o que atualizar. */
    catalogVersion: text("catalog_version"),
    scopeType: achievementScope("scope_type").notNull(),
    /**
     * A entidade a que a Conquista está presa.
     *
     * `text` e não `uuid`: o escopo `HARNESS` é a chave da Guilda (`claude`), e
     * não um id. Sem chave estrangeira de propósito — apagar um Project não
     * pode apagar a Conquista que ele rendeu.
     */
    scopeId: text("scope_id"),
    nameTheme: text("name_theme").notNull(),
    namePlain: text("name_plain").notNull(),
    descriptionTheme: text("description_theme").notNull(),
    descriptionPlain: text("description_plain").notNull(),
    /** Só existe no tema; com o tema desligado, fica oculto. */
    flavor: text("flavor"),
    icon: text("icon").notNull(),
    rarity: achievementRarity("rarity").notNull(),
    /** Rótulos dos tiers de um `count`, um por limiar. */
    tiers: jsonb("tiers").$type<string[]>(),
    /** Raridade por tier, quando ela cresce ao longo dos limiares. */
    tierRarities: jsonb("tier_rarities").$type<AchievementRarity[]>(),
    hidden: boolean("hidden").notNull().default(false),
    condition: jsonb("condition").$type<Condition>().notNull(),
    provenance: jsonb("provenance").$type<Provenance>(),
    /**
     * A revisão de uma forjada (Fase 2.5C). Nula fora de `FORGED`.
     *
     * Uma forjada nasce `PENDING_REVIEW` e é invisível: o projetor e o Hall só
     * leem definições com esta coluna nula ou `APPROVED`. `DISCARDED` fica na
     * tabela para o rate limit contar e para a proveniência não sumir.
     */
    reviewStatus: achievementReviewStatus("review_status"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    /** Só numa forjada: o resultado notável, o Run e o lote que a propôs. */
    forgedProvenance: jsonb("forged_provenance").$type<ForgedAchievementProvenance>(),
    /**
     * A partir de quando os fatos contam para esta Conquista.
     *
     * Nulo em tudo que veio do catálogo: uma Conquista fixa vale desde sempre.
     * Numa instância de template é o instante do fato que a fez existir — a
     * criação do Project, o primeiro Run daquela Guilda —, **derivado dos dados
     * duráveis** e não do relógio de quem instanciou. É o que faz
     * `dm achievements rebuild` reproduzir os mesmos desbloqueios: sem isso, a
     * reconstrução veria a definição existindo desde o começo dos tempos e
     * premiaria fatos anteriores ao nascimento dela.
     */
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("achievement_definition_natural_key_uq").on(table.userId, table.naturalKey),
    index("achievement_definition_user_origin_idx").on(table.userId, table.origin),
    check(
      "achievement_definition_forged_review_ck",
      sql`("origin" = 'FORGED') = ("review_status" is not null) and ("origin" = 'FORGED') = ("forged_provenance" is not null)`,
    ),
  ],
);

/**
 * O progresso de uma Conquista, por usuário.
 *
 * Uma linha por par, criada no primeiro fato que casa. As quatro colunas
 * cobrem o que os cinco predicados precisam somar; `state` guarda o que não é
 * número — hoje só os valores já vistos de um `set`.
 */
export const achievementProgress = pgTable(
  "achievement_progress",
  {
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => achievementDefinitions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    counter: integer("counter").notNull().default(0),
    /** Melhor marca de um `record`. `bigint` porque duração em ms passa de `int4`. */
    bestValue: bigint("best_value", { mode: "number" }),
    currentStreak: integer("current_streak").notNull().default(0),
    bestStreak: integer("best_streak").notNull().default(0),
    state: jsonb("state").$type<{ seen?: string[] }>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.definitionId, table.userId], name: "achievement_progress_pk" }),
  ],
);

/**
 * Um desbloqueio, idempotente por construção.
 *
 * `UNIQUE (definition_id, user_id, tier)` **é** a idempotência: reprocessar o
 * mesmo evento não desbloqueia duas vezes porque o segundo `INSERT` não passa.
 * `unlocked_at` é o instante do **fato**, não o da gravação, e é por isso que
 * uma reconstrução produz a mesma crônica, com as mesmas datas.
 */
export const achievementUnlocks = pgTable(
  "achievement_unlock",
  {
    id: uuid("id").primaryKey(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => achievementDefinitions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 1 nos predicados de alvo único; o índice do limiar num `count`. */
    tier: integer("tier").notNull().default(1),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Nulo até o usuário ver o toast ou abrir a crônica. */
    seenAt: timestamp("seen_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("achievement_unlock_tier_uq").on(table.definitionId, table.userId, table.tier),
    // A crônica é sempre "do usuário X, do mais recente para o mais antigo".
    index("achievement_unlock_user_unlocked_idx").on(table.userId, table.unlockedAt),
  ],
);

/**
 * Onde o projetor parou em cada fonte.
 *
 * O par `(position_at, position_id)` é o cursor: as fontes ordenadas por
 * `(created_at, id)` comparam os dois, e `dashboard_event`, que tem `sequence`
 * própria, guarda o número em `position_id` e ignora o instante. Uma coluna por
 * fonte obrigaria a uma migração a cada fonte nova.
 */
export const achievementCursors = pgTable(
  "achievement_cursor",
  {
    source: achievementSource("source").notNull(),
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
  (table) => [primaryKey({ columns: [table.source, table.userId], name: "achievement_cursor_pk" })],
);

/**
 * As estatísticas de Herói e de Equipamento.
 *
 * Uma tabela e não duas: o que se acumula é idêntico, e o que muda é a quem
 * pertence. `scope_id` não tem chave estrangeira de propósito — o histórico de
 * um Herói apagado continua contando o que ele fez.
 */
export const heroStats = pgTable(
  "hero_stats",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: heroScope("scope").notNull(),
    scopeId: uuid("scope_id").notNull(),
    xp: integer("xp").notNull().default(0),
    level: integer("level").notNull().default(1),
    expeditions: integer("expeditions").notNull().default(0),
    victories: integer("victories").notNull().default(0),
    defeats: integer("defeats").notNull().default(0),
    monstersSlain: integer("monsters_slain").notNull().default(0),
    /** Vitórias em Masmorra selada. Guardadas porque o bônus só vale na primeira. */
    dockerVictories: integer("docker_victories").notNull().default(0),
    tokens: bigint("tokens", { mode: "number" }).notNull().default(0),
    harnessCounts: jsonb("harness_counts").$type<Record<string, number>>().notNull().default({}),
    /** Derivada de `harness_counts`, gravada para a leitura não recalcular. */
    topHarness: text("top_harness"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("hero_stats_scope_uq").on(table.userId, table.scope, table.scopeId)],
);

export type AchievementDefinitionRow = typeof achievementDefinitions.$inferSelect;
export type NewAchievementDefinitionRow = typeof achievementDefinitions.$inferInsert;
export type AchievementProgressRow = typeof achievementProgress.$inferSelect;
export type NewAchievementProgressRow = typeof achievementProgress.$inferInsert;
export type AchievementUnlockRow = typeof achievementUnlocks.$inferSelect;
export type NewAchievementUnlockRow = typeof achievementUnlocks.$inferInsert;
export type AchievementCursorRow = typeof achievementCursors.$inferSelect;
export type HeroStatsRow = typeof heroStats.$inferSelect;
export type NewHeroStatsRow = typeof heroStats.$inferInsert;
