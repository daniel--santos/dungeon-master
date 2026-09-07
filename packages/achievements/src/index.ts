/**
 * `@dungeon-master/achievements` — Conquistas como dados.
 *
 * O schema Zod de definição, o vocabulário fechado de condições e o catálogo
 * fixo v1 como JSON validado (planejamento v0.4, Fase 2.5A). O projetor não
 * mora aqui e nunca escreve no domínio: Conquistas são projeção, cosméticas,
 * idempotentes e reconstruíveis do zero.
 *
 * O pacote é puro. Só importa `zod` e builtins do Node, e o único I/O é ler os
 * próprios arquivos de catálogo.
 */

export * from "./condition.js";
export * from "./definition.js";
export * from "./load.js";
export * from "./xp.js";
