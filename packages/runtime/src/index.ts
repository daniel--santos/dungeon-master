/**
 * `@dungeon-master/runtime` — a abstração de execução de agentes.
 *
 * O domínio pede um Run; este pacote garante que ele termina. Aqui moram o
 * `AgentRuntime`, o contrato de `HarnessAdapter`, a matriz de capabilities, o
 * preflight, os dois relógios, o kill de árvore com confirmação, o worktree por
 * Run e o resultado estruturado (planejamento v0.4, Fase 2A e 2B).
 *
 * O que **não** mora aqui: banco (o store entra por injeção de contrato), HTTP,
 * fila, e qualquer conhecimento de CLI específica — isso é de
 * `@dungeon-master/runtime-sandcastle` e dos adapters seguintes.
 */

export * from "./async-queue.js";
export * from "./bounded-tail.js";
export * from "./capabilities.js";
export * from "./clock.js";
export * from "./env.js";
export * from "./execution-request.js";
export * from "./harness.js";
export * from "./mcp.js";
export * from "./process.js";
export * from "./registry.js";
export * from "./standard-schema.js";
export * from "./types.js";
export * from "./workspace.js";
export * from "./workspace-resolver.js";
export * from "./structured-output.js";
export * from "./agent-runtime.js";
export * from "./host-adapter.js";
export * from "./docker.js";
export * from "./docker-adapter.js";
