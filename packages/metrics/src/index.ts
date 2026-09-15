/**
 * `@dungeon-master/metrics` — o cálculo puro das métricas (Fase 10A).
 *
 * Espelha `@dungeon-master/achievements`: dados e funções, sem Drizzle, sem
 * Hono, sem I/O. Quem lê `run`, `run_event` e `run_context` e grava
 * `run_metric` e `metric_daily` é `@dungeon-master/database`; o que mora aqui é
 * a conta — quais dimensões um Run alimenta, como um dia é somado, quanto ele
 * custou e como uma série vira contínua.
 *
 * A fronteira é aplicada pelo ESLint: deste pacote só se importa `zod`, `node:*`
 * e `@dungeon-master/contracts`, que é o vocabulário canônico do domínio.
 */

export * from "./cost.js";
export * from "./day.js";
export * from "./dimensions.js";
export * from "./facts.js";
export * from "./rollup.js";
export * from "./series.js";
export * from "./stats.js";
export * from "./tool-calls.js";
