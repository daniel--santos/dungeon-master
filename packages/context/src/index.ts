/**
 * `@dungeon-master/context` — o Context Engine (planejamento v0.4, Fase 7).
 *
 * O montador de contexto estável ao longo do Run: o resumo do Project, as
 * decisões recentes, as páginas relevantes do Grimório, a Task mãe e as
 * dependências, os artefatos de Runs anteriores e as skills do Loadout, num
 * bloco delimitado, dentro de um orçamento de tokens, sanitizado contra
 * injeção e registrado item a item. Tudo por portas: quem lê as tabelas
 * entra por `ports.ts`, e o ESLint garante que o pacote não importa banco.
 */

export * from "./assembler.js";
export * from "./budget.js";
export * from "./fts-query.js";
export * from "./policy.js";
export * from "./ports.js";
export * from "./render.js";
export * from "./sanitize.js";
export * from "./sections/artifacts.js";
export * from "./sections/decisions.js";
export * from "./sections/knowledge.js";
export * from "./sections/lineage.js";
export * from "./sections/skills.js";
export * from "./sections/summary.js";
export * from "./token-estimate.js";
export * from "./types.js";

export const CONTEXT_PACKAGE = "@dungeon-master/context" as const;
