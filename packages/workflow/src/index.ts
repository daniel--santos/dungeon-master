/**
 * `@dungeon-master/workflow` — o motor de execução de Workflows (planejamento
 * v0.4, Fase 4).
 *
 * O runner conduz um Run com Workflow pelo estado persistido dos RunSteps,
 * um passo por vez, na ordem topológica da versão congelada; cada tipo de
 * step tem executor em módulo próprio; retry, timeout, gate de aprovação e
 * cancelamento são decididos aqui, por dados e código — a IA só decide dentro
 * do step de agente.
 *
 * O que **não** mora aqui: banco, HTTP, fila. Persistência, runtime de agente,
 * executor de processo e relógio entram por contrato (`ports.ts`), e o ESLint
 * garante que o pacote não importa `@dungeon-master/database`.
 */

export * from "./aggregate.js";
export * from "./artifact-probe.js";
export * from "./executors/agent.js";
export * from "./executors/approval.js";
export * from "./executors/command.js";
export * from "./executors/knowledge.js";
export * from "./executors/types.js";
export * from "./executors/validation.js";
export * from "./git-checkout-snapshot.js";
export * from "./logger.js";
export * from "./ports.js";
export * from "./process-command-executor.js";
export * from "./prompt.js";
export * from "./runner.js";

export const WORKFLOW_PACKAGE = "@dungeon-master/workflow" as const;
