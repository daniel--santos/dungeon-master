/**
 * `@dungeon-master/platform` — processo, caminho e shell.
 *
 * Todo código que depende do sistema operacional mora aqui: kill de árvore de
 * processos com confirmação de término, criação de processo sem shell com
 * ambiente por allow-list, e normalização e restrição de caminho (planejamento
 * v0.4, seções 3.6 e 13.2; documento técnico, seção 14.1).
 *
 * O pacote importa apenas builtins do Node, e o ESLint garante isso.
 *
 * Detecção de CLI instalada **não** mora aqui: fica no preflight de cada
 * adapter de harness (decisão de partida da Fase 0).
 */

export * from "./path-validation.js";
export * from "./process-tree.js";
export * from "./spawn.js";

/** Sistemas operacionais tratados como plataforma de primeira classe. */
export type SupportedPlatform = "win32" | "darwin";
