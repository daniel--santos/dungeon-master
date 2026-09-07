/**
 * `@dungeon-master/platform` — processo, caminho e shell.
 *
 * Esqueleto da Fase 0. Recebe depois o kill de árvore de processos por sistema
 * operacional, a normalização de caminho e o spawn sem shell (planejamento
 * v0.4, seções 3.6 e 13.2). Detecção de CLI instalada não mora aqui: fica no
 * preflight de cada adapter.
 */

/** Sistemas operacionais tratados como plataforma de primeira classe. */
export type SupportedPlatform = "win32" | "darwin";

/** O pacote ainda não exporta utilitários. */
export const PLATFORM_PACKAGE = "@dungeon-master/platform" as const;
