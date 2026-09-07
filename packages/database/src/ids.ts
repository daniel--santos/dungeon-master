import { v7 as uuidv7 } from "uuid";

/**
 * Identificadores são UUIDv7 gerados na aplicação, nunca pelo banco
 * (planejamento v0.4, decisões de partida da Fase 0). UUIDv7 carrega o
 * timestamp no prefixo, então a ordem de inserção é a ordem do índice.
 */
export function newId(): string {
  return uuidv7();
}
