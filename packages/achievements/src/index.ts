/**
 * `@dungeon-master/achievements` — Conquistas como dados.
 *
 * O schema Zod de definição e o vocabulário fechado de condições
 * (planejamento v0.4, Fase 2.5A). O projetor não mora aqui e nunca escreve no
 * domínio: Conquistas são projeção, cosméticas, idempotentes e reconstruíveis
 * do zero.
 *
 * O pacote é puro. Só importa `zod` e builtins do Node.
 */

export * from "./condition.js";
export * from "./definition.js";
