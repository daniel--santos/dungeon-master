/**
 * `@dungeon-master/achievements` — Conquistas como dados.
 *
 * O schema Zod de definição, o vocabulário fechado de condições, o catálogo
 * fixo v1 como JSON validado (Fase 2.5A) e o núcleo puro do projetor
 * (Fase 2.5B). Conquistas são projeção: cosméticas, idempotentes,
 * reconstruíveis do zero e incapazes de afetar a execução de um Run.
 *
 * O pacote é puro. Só importa `zod` e builtins do Node, e o único I/O é ler os
 * próprios arquivos de catálogo. O que grava progresso e desbloqueios é o
 * adaptador de `@dungeon-master/database`, que escreve em transação.
 */

export * from "./condition.js";
export * from "./definition.js";
export * from "./load.js";
export * from "./projector/index.js";
export * from "./xp.js";
