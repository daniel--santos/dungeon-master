/**
 * `@dungeon-master/events` — transporte SSE, drain por cursor e ponte de NOTIFY.
 *
 * As três peças do padrão de notificação sem payload (documento técnico, seção
 * 10.1), adaptadas do Archon (planejamento v0.4, seção 13.2):
 *
 * ```text
 * INSERT em dashboard_event
 *   → trigger AFTER INSERT → pg_notify('dm_dashboard_event', '')  (sem payload)
 *     → PgNotifyListener.drainNow()
 *       → DashboardEventPoller lê a partir do cursor
 *         → SseTransport entrega a quem está conectado
 * ```
 *
 * Nada aqui conhece Hono, `pg` ou o nosso schema: o writer, a fonte de eventos
 * e o notificador entram por injeção, e o pacote roda inteiro em teste sem
 * infraestrutura.
 *
 * Daqui saem também as duas peças puras dos contratos de escrita de evento
 * (planejamento v0.4, seções 2A e 13.2): o sanitizador de credenciais, aplicado
 * a todo payload antes de persistir, e o erro terminal de escrita de status.
 *
 * **As implementações de `appendRunEvent`, `persistRunEvent` e
 * `writeRunTerminalStatus` moram em `@dungeon-master/database`, não aqui.** As
 * três escrevem em transação — o status terminal grava o Run, a transição da
 * Task, a `activity` e o `dashboard_event` de uma vez — e uma transação não
 * atravessa a fronteira deste pacote, que não conhece `pg`. O que é lógica pura
 * (sanitizar, distinguir o erro terminal) fica aqui e é testado sem
 * infraestrutura; o que é escrita fica onde o schema está.
 */

export * from "./credential-sanitizer.js";
export * from "./dashboard-event-poller.js";
export * from "./logger.js";
export * from "./pg-notify-listener.js";
export * from "./sse-transport.js";
export * from "./terminal-status-write.js";

/**
 * Os dois contratos de escrita de evento (CLAUDE.md, seção 9).
 *
 * `never-throws` é observabilidade pura: perder um evento é ruim, derrubar o
 * Run por causa dele é pior. `propagates` é para a linha sem a qual a execução
 * não pode seguir.
 */
export type EventWriteContract = "never-throws" | "propagates";

export const EVENTS_PACKAGE = "@dungeon-master/events" as const;
