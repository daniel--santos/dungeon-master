/**
 * `@dungeon-master/knowledge-mcp` — o servidor MCP somente leitura do Grimório
 * (planejamento v0.4, Fase 7).
 *
 * Cinco ferramentas de consulta, por stdio, escopadas ao `user_id` e ao
 * `project_id` recebidos na partida do processo. Nenhuma escreve. É a
 * alternativa ao recall automático por turno: um system prompt estável diz
 * ao agente que as ferramentas existem, e ele decide quando buscar
 * (documento técnico, seção 20.1).
 *
 * O Worker importa daqui o nome canônico do servidor, os nomes das
 * ferramentas, o caminho do arquivo empacotado e a linha de instrução; o
 * servidor em si roda como processo separado, subido pelo harness.
 */

export * from "./entrypoint.js";
export * from "./format.js";
export * from "./server.js";
export * from "./store.js";
export * from "./store-database.js";
export * from "./store-memory.js";
export * from "./tools.js";
