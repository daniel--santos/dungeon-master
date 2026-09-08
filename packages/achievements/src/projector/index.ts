/**
 * O núcleo puro do projetor de Conquistas (planejamento v0.4, Fase 2.5B).
 *
 * Nada aqui conhece banco, ORM ou HTTP: entra um fato normalizado, sai o
 * progresso novo e a lista de tiers alcançados. O adaptador que lê `run_event`,
 * `activity` e `dashboard_event` e grava progresso, desbloqueios e estatísticas
 * mora em `@dungeon-master/database`, porque escreve em transação — e uma
 * transação não atravessa a fronteira deste pacote, que é puro por regra
 * (CLAUDE.md, seção 3).
 */

export * from "./event.js";
export * from "./hero-stats.js";
export * from "./instantiate.js";
export * from "./progress.js";
