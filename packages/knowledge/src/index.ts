/**
 * `@dungeon-master/knowledge` — o Distiller do Grimório (planejamento v0.4,
 * Fase 6).
 *
 * O que decide o destino de cada `KnowledgeCandidate`: o filtro de ruído do
 * L0, o funil de duplicata em duas fases com fail-open, os prompts adaptados
 * do TencentDB (seção 13.3), o gatilho de regeneração do Project Summary, o
 * scheduler de lote por ociosidade e timer, e a forja das Conquistas
 * notáveis. Tudo por portas: banco, advisory lock e o `AgentRuntime` entram
 * por `ports.ts`, e o ESLint garante que o pacote não importa
 * `@dungeon-master/database`.
 */

export * from "./dedup.js";
export * from "./distiller.js";
export * from "./distiller-scheduler.js";
export * from "./forge.js";
export * from "./l0-noise-filter.js";
export * from "./logger.js";
export * from "./ports.js";
export * from "./prompts/dedup-judge.js";
export * from "./prompts/extract-candidates.js";
export * from "./prompts/project-summary.js";
export * from "./sanitize.js";
export * from "./summary-trigger.js";
export * from "./types.js";

export const KNOWLEDGE_PACKAGE = "@dungeon-master/knowledge" as const;
