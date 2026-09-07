/**
 * Utilitários **só para testes** de `@dungeon-master/database`, publicados no
 * subpath `@dungeon-master/database/testing`. Dependem de `embedded-postgres`,
 * que é devDependency deste pacote; nunca importe daqui em código de produção.
 */
export * from "./embedded-postgres.js";
