/**
 * `@dungeon-master/domain` — entidades, máquinas de estado e regras.
 *
 * Esqueleto da Fase 0. O conteúdo (Project, Task, Run, transições) chega nas
 * fases seguintes, em pacotes trabalhados em paralelo.
 *
 * Fronteira aplicada por lint (planejamento v0.4, seção 5): este pacote não
 * importa banco, ORM, HTTP, logger, runtime de agente nem builtins do Node.
 * O domínio computa; a infraestrutura entra por injeção de contrato.
 */

/** Marca de que um valor é imutável do ponto de vista do domínio. */
export type Readonly_<T> = { readonly [K in keyof T]: T[K] };

/** O pacote ainda não exporta entidades. */
export const DOMAIN_PACKAGE = "@dungeon-master/domain" as const;
