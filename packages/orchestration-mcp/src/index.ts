/**
 * `@dungeon-master/orchestration-mcp` — o servidor MCP de delegação
 * Agent-to-Agent (planejamento v0.4, Fase 9B; documento técnico, seção 40,
 * nível 4).
 *
 * Três ferramentas, por stdio, escopadas ao Run mãe, ao Project e ao usuário
 * recebidos na partida do processo: `list_loadouts` lista os Equipamentos a
 * que se pode delegar; `delegate_task` abre um Run filho com um deles, pelo
 * mesmo caminho do step `delegate` do Workflow, e devolve o id;
 * `await_run` espera o desfecho de um filho **deste** Run mãe e devolve o
 * resumo.
 *
 * É um pacote separado do Grimório (`knowledge-mcp`) de propósito: aquele só
 * lê; este **escreve** — cria Task, Run e eventos —, e um agente que ganha o
 * poder de abrir Runs precisa de um servidor cuja simples presença diga isso.
 * O Worker só o oferece quando o nível de autonomia do Project libera
 * `DELEGATE`, e o servidor recusa por conta própria fora desse nível, além
 * da profundidade máxima, e sob os mesmos orçamentos e disjuntores de
 * `POST /runs`.
 */

export * from "./entrypoint.js";
export * from "./format.js";
export * from "./server.js";
export * from "./store.js";
export * from "./store-database.js";
export * from "./store-memory.js";
export * from "./tools.js";
