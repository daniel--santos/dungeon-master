/**
 * `@dungeon-master/workflow/testing` — as portas em memória.
 *
 * Um store com a semântica de CAS do banco, um runtime de agente com
 * respostas roteirizadas por chave de step, e dublês do executor de comando
 * e do snapshot. Nada aqui importa Vitest: os dublês servem a qualquer
 * suíte, inclusive à do Worker.
 */

export * from "./fakes.js";
export * from "./memory-store.js";
export * from "./scripted-agent.js";
