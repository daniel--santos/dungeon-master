/**
 * `@dungeon-master/contracts` — schemas Zod.
 *
 * Fonte única de validação e de spec OpenAPI (planejamento v0.4, seção 3.8).
 * Este pacote não contém lógica: só schemas e os tipos inferidos deles.
 *
 * Os nomes são os canônicos do domínio (seção 14). Nada de vocabulário temático
 * aqui; o tema mora em `@dungeon-master/glossary` e só alcança labels da UI.
 */

export * from "./health.js";
export * from "./problem-details.js";
export * from "./user-setting.js";
