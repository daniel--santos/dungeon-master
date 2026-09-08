import { z } from "zod";

import { PageQuerySchema } from "./pagination.js";

/**
 * O que a API acrescenta às Conquistas (planejamento v0.4, Fase 2.5B e 2.5D).
 *
 * O vocabulário de **Conquista** — origem, escopo, raridade, condição, os dois
 * textos — é de `@dungeon-master/achievements`, que é a fonte única daquele
 * domínio, e a rota importa e registra os schemas de lá em vez de redeclará-los
 * (CLAUDE.md, seção 5). O que mora aqui é o que a API inventa por cima: o
 * estado calculado de uma carta, o progresso para a barra, o tier corrente e as
 * estatísticas de Herói, que não existem no pacote puro.
 */

/**
 * O estado de uma carta no Hall.
 *
 * Não é coluna e nunca será: é derivado do progresso e dos desbloqueios em toda
 * leitura. Uma coluna de estado seria uma quarta verdade sobre o mesmo fato, e
 * ficaria errada na primeira reconstrução.
 *
 * `HIDDEN` é a Conquista oculta que ainda não teve nenhum progresso — a carta
 * "???" da grade. Ela vira `IN_PROGRESS` no primeiro fato que conta, e é assim
 * que uma instância de template aparece.
 */
export const ACHIEVEMENT_STATE_VALUES = [
  "LOCKED",
  "HIDDEN",
  "IN_PROGRESS",
  "UNLOCKED",
] as const;

export const AchievementStateSchema = z.enum(ACHIEVEMENT_STATE_VALUES).meta({
  id: "AchievementState",
  description:
    "Estado calculado de uma Conquista: bloqueada, oculta (sem progresso), " +
    "em progresso ou desbloqueada. Derivado, nunca gravado.",
});

export type AchievementState = z.infer<typeof AchievementStateSchema>;

/** Onde a Conquista está dentro dos tiers dela. */
export const AchievementTierSchema = z
  .object({
    current: z
      .number()
      .int()
      .nonnegative()
      .describe("Maior tier já desbloqueado. `0` quando nenhum foi."),
    total: z.number().int().positive().describe("Quantos tiers a condição tem. `1` é o comum."),
    label: z
      .string()
      .nullable()
      .describe("Rótulo do tier corrente (`I`, `II`, `III`). Nulo quando há um tier só."),
  })
  .meta({ id: "AchievementTier", description: "O tier corrente de uma Conquista." });

export type AchievementTier = z.infer<typeof AchievementTierSchema>;

/**
 * O progresso para a barra da carta.
 *
 * `target` é o limiar do **próximo** tier, e não o do primeiro: quem já fez 12
 * de 10/50/200 vê 12 de 50, que é a próxima meta, e não uma barra estourada.
 */
export const AchievementProgressSchema = z
  .object({
    current: z.number().int().nonnegative().describe("Quanto já foi feito."),
    target: z.number().int().positive().describe("O limiar do próximo tier."),
    percent: z.number().int().min(0).max(100).describe("`current/target`, limitado a 100."),
  })
  .meta({ id: "AchievementProgress", description: "Progresso de uma Conquista, para a barra." });

export type AchievementProgress = z.infer<typeof AchievementProgressSchema>;

/**
 * Quantas Conquistas em cada estado. É o "desbloqueadas de N" do Hall.
 *
 * Os filtros da listagem não moram aqui: dois deles são `origin` e `rarity`,
 * que são vocabulário de `@dungeon-master/achievements`, e o schema de query é
 * declarado junto da rota, que importa os enums de lá.
 */
export const AchievementCountsSchema = z
  .object({
    total: z.number().int().nonnegative().describe("Todas as Conquistas do usuário."),
    unlocked: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    locked: z.number().int().nonnegative(),
    hidden: z.number().int().nonnegative(),
  })
  .meta({
    id: "AchievementCounts",
    description: "Contagem por estado, sempre sobre o conjunto inteiro, ignorando os filtros.",
  });

export type AchievementCounts = z.infer<typeof AchievementCountsSchema>;

/** Paginação da crônica de desbloqueios. */
export const AchievementUnlockListQuerySchema = PageQuerySchema.meta({
  id: "AchievementUnlockListQuery",
});

export type AchievementUnlockListQuery = z.infer<typeof AchievementUnlockListQuerySchema>;

// --------------------------------------------------------------------------
// Estatísticas de Herói
// --------------------------------------------------------------------------

/** A quem as estatísticas pertencem. */
export const HERO_SCOPE_VALUES = ["AGENT", "LOADOUT"] as const;

export const HeroScopeSchema = z.enum(HERO_SCOPE_VALUES).meta({
  id: "HeroScope",
  description: "Se a estatística é de um Agent (Herói) ou de um Loadout (Equipamento).",
});

export type HeroScope = z.infer<typeof HeroScopeSchema>;

/**
 * O acumulado de um Herói ou de um Equipamento.
 *
 * Tudo cosmético: nenhuma funcionalidade depende de nível (CLAUDE.md, seção
 * 12). `name` vem por junção na leitura, e não gravado: uma estatística
 * acompanha a renomeação do Herói. Nulo quando a entidade foi apagada — o que
 * ela fez continua tendo acontecido.
 */
export const HeroStatsSchema = z
  .object({
    scopeId: z.uuid().describe("Id do Agent ou do Loadout."),
    name: z.string().nullable().describe("Nome atual. Nulo quando a entidade foi apagada."),
    xp: z.number().int().nonnegative().describe("Experiência acumulada."),
    level: z.number().int().positive().describe("Nível derivado da experiência por fórmula fixa."),
    xpToNextLevel: z.number().int().nonnegative().describe("Quanto falta para o próximo nível."),
    expeditions: z
      .number()
      .int()
      .nonnegative()
      .describe("Runs terminados: vitórias, derrotas e cancelamentos."),
    victories: z.number().int().nonnegative(),
    defeats: z.number().int().nonnegative().describe("Runs em FAILED ou TIMED_OUT."),
    monstersSlain: z
      .number()
      .int()
      .nonnegative()
      .describe("Runs vitoriosos que concluíram uma Task `BUG`."),
    tokens: z.number().int().nonnegative().describe("Tokens somados dos eventos `Usage`."),
    topHarness: z
      .string()
      .nullable()
      .describe("Harness mais usado. Empate desfeito pela ordem alfabética."),
  })
  .meta({ id: "HeroStats", description: "O acumulado de um Agent ou de um Loadout." });

export type HeroStats = z.infer<typeof HeroStatsSchema>;

export const HeroStatsResponseSchema = z
  .object({
    agents: z.array(HeroStatsSchema).describe("Por Agent, do mais experiente para o menos."),
    loadouts: z.array(HeroStatsSchema).describe("Por Loadout, na mesma ordem."),
  })
  .meta({
    id: "HeroStatsResponse",
    description: "As estatísticas de Herói e de Equipamento, ambas projeção.",
  });

export type HeroStatsResponse = z.infer<typeof HeroStatsResponseSchema>;
