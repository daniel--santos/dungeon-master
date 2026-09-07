/**
 * `@dungeon-master/achievements` — Conquistas como dados.
 *
 * Esqueleto da Fase 0. Recebe depois o schema Zod de definição, o vocabulário
 * fechado de condições e o catálogo fixo v1 como JSON validado no CI
 * (planejamento v0.4, Fase 2.5). O projetor não mora aqui e nunca escreve no
 * domínio: Conquistas são projeção.
 */

/** Origens de uma Conquista. */
export type AchievementOrigin = "CATALOG" | "TEMPLATE" | "FORGED";

/** O pacote ainda não exporta catálogo nem schema. */
export const ACHIEVEMENTS_PACKAGE = "@dungeon-master/achievements" as const;
