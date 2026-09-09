/**
 * `@dungeon-master/domain` — entidades, máquinas de estado e regras.
 *
 * Fronteira aplicada por lint (planejamento v0.4, seção 5): este pacote não
 * importa banco, ORM, HTTP, logger, runtime de agente nem builtins do Node. O
 * domínio computa; a infraestrutura entra por injeção de contrato. De
 * `@dungeon-master/contracts` vêm apenas tipos, sem import de valor.
 *
 * Tudo aqui é função pura sobre dados já lidos. Quem chama é responsável por
 * ler o estado e aplicar a mudança na mesma transação: uma regra checada fora
 * da transação responde sobre um passado.
 */

export * from "./dependency-graph.js";
export * from "./task-rules.js";
export * from "./task-status.js";
export * from "./run-status.js";
export * from "./run-task-coupling.js";
export * from "./run-step-status.js";
export * from "./workflow-graph.js";
export * from "./predicates.js";
export * from "./proposed-task-rules.js";
export * from "./capability-matching.js";

/** Marca de que um valor é imutável do ponto de vista do domínio. */
export type Readonly_<T> = { readonly [K in keyof T]: T[K] };

/** O nome do pacote, usado pelos testes de fiação do workspace. */
export const DOMAIN_PACKAGE = "@dungeon-master/domain" as const;
