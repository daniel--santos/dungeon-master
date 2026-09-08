/**
 * `@dungeon-master/knowledge/testing` — as portas em memória.
 *
 * Um store com o lock, a transação e o resumo corrente do banco, e um modelo
 * roteirizado por finalidade. Nada aqui importa Vitest: os dublês servem a
 * qualquer suíte, inclusive à do Worker.
 */

export * from "./memory-store.js";
export * from "./scripted-runtime.js";
