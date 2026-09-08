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
export const ACHIEVEMENT_STATE_VALUES = ["LOCKED", "HIDDEN", "IN_PROGRESS", "UNLOCKED"] as const;

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
      .describe(
        "Rótulo do tier corrente (`I`, `II`, `III`). Nulo quando a Conquista " +
          "tem um tier só, e também quando `current` é `0`: o numeral aparece " +
          "junto com o desbloqueio, não antes dele.",
      ),
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

// --------------------------------------------------------------------------
// Conquistas forjadas (Fase 2.5C, depois da Fase 6)
// --------------------------------------------------------------------------

/**
 * A revisão de uma Conquista forjada.
 *
 * O Distiller propõe; o usuário aprova, renomeia ou descarta (documento
 * técnico, questão aberta 11, decidida: sim, passa pelo Selo da Guilda). Uma
 * forjada em `PENDING_REVIEW` ou `DISCARDED` é invisível no Hall e o projetor
 * não a avalia; só `APPROVED` entra na projeção.
 */
export const ACHIEVEMENT_REVIEW_STATUS_VALUES = [
  "PENDING_REVIEW",
  "APPROVED",
  "DISCARDED",
] as const;

export const AchievementReviewStatusSchema = z.enum(ACHIEVEMENT_REVIEW_STATUS_VALUES).meta({
  id: "AchievementReviewStatus",
  description: "Estado de revisão de uma Conquista forjada.",
});

export type AchievementReviewStatus = z.infer<typeof AchievementReviewStatusSchema>;

/** O resultado notável que inspirou a forjada. Vocabulário fechado, para a tela rotular. */
export const NOTABLE_RESULT_KIND_VALUES = [
  "NEMESIS_DEFEATED",
  "VICTORY_STREAK",
  "FIRST_HARNESS_VICTORY",
  "DURATION_RECORD",
] as const;

export const NotableResultKindSchema = z.enum(NOTABLE_RESULT_KIND_VALUES).meta({
  id: "NotableResultKind",
  description:
    "Monstro reaberto derrotado, sequência de vitórias, primeira vitória de uma Guilda ou " +
    "recorde de duração.",
});

export type NotableResultKind = z.infer<typeof NotableResultKindSchema>;

export const ForgedAchievementProvenanceSchema = z
  .object({
    kind: NotableResultKindSchema,
    detail: z.string().describe("O fato, em uma linha canônica, escrito pelo código."),
    projectId: z.uuid().nullable(),
    runId: z.uuid().nullable().describe("O Run que produziu o resultado notável."),
    taskId: z.uuid().nullable(),
    distillationRunId: z.uuid().nullable().describe("O lote do Distiller que propôs a forjada."),
    harnessSessionId: z.string().nullable(),
  })
  .meta({ id: "ForgedAchievementProvenance", description: "De onde a forjada veio." });

export type ForgedAchievementProvenance = z.infer<typeof ForgedAchievementProvenanceSchema>;

export const FORGED_NAME_MAX_LENGTH = 120;
export const FORGED_DESCRIPTION_MAX_LENGTH = 120;
export const FORGED_FLAVOR_MAX_LENGTH = 240;

/**
 * Uma Conquista forjada pelo Distiller.
 *
 * Só a versão `theme` é escrita pelo modelo: texto de sabor só existe no tema
 * (VOICE.md, seção 7), e a versão sóbria que a tabela exige vem do código, a
 * partir do resultado notável. Todo texto passou por `escapeXmlTags` e nunca
 * volta a um prompt.
 */
export const ForgedAchievementSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da definição gravada."),
    reviewStatus: AchievementReviewStatusSchema,
    name: z.string().describe("Nome no tema, escrito pelo modelo e sanitizado."),
    description: z.string().describe("A condição cumprida e o beat de plateia, no tema."),
    flavor: z.string().describe("O anúncio no ar, no tema."),
    plainName: z.string().describe("A versão sóbria, escrita pelo código."),
    plainDescription: z.string().describe("A condição, no vocabulário canônico."),
    icon: z.string(),
    rarity: z.enum(["COMMON", "RARE", "EPIC", "LEGENDARY"]),
    provenance: ForgedAchievementProvenanceSchema,
    reviewedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "ForgedAchievement", description: "Uma Conquista proposta pelo Distiller." });

export type ForgedAchievement = z.infer<typeof ForgedAchievementSchema>;

export const ForgedAchievementListSchema = z
  .object({
    items: z.array(ForgedAchievementSchema).describe("Da mais recente para a mais antiga."),
  })
  .meta({ id: "ForgedAchievementList", description: "As Conquistas forjadas do usuário." });

export type ForgedAchievementList = z.infer<typeof ForgedAchievementListSchema>;

export const ForgedAchievementListQuerySchema = z
  .object({
    reviewStatus: AchievementReviewStatusSchema.optional().describe(
      "Só as neste estado. Ausente lista as em revisão.",
    ),
  })
  .meta({ id: "ForgedAchievementListQuery" });

export type ForgedAchievementListQuery = z.infer<typeof ForgedAchievementListQuerySchema>;

export const RenameForgedAchievementSchema = z
  .object({
    name: z.string().trim().min(1).max(FORGED_NAME_MAX_LENGTH).optional(),
    description: z.string().trim().min(1).max(FORGED_DESCRIPTION_MAX_LENGTH).optional(),
    flavor: z.string().trim().min(1).max(FORGED_FLAVOR_MAX_LENGTH).optional(),
  })
  .meta({
    id: "RenameForgedAchievement",
    description:
      "Corpo de `POST /api/v1/achievements/{id}/rename` e, opcionalmente, de `/approve`: " +
      "o texto que o usuário reescreveu.",
  });

export type RenameForgedAchievement = z.infer<typeof RenameForgedAchievementSchema>;
