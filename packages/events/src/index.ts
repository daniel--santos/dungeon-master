/**
 * `@dungeon-master/events` — ExecutionEvent, writers e cursor.
 *
 * Esqueleto da Fase 0. Recebe depois os dois contratos de escrita
 * (`appendEvent`, que nunca lança, e `persistEvent`, que propaga), o erro
 * terminal de escrita de status e o sanitizador de credenciais
 * (planejamento v0.4, seções 2A e 13.2).
 */

/** Os dois contratos de escrita de evento. */
export type EventWriteContract = "never-throws" | "propagates";

/** O pacote ainda não exporta writers. */
export const EVENTS_PACKAGE = "@dungeon-master/events" as const;
