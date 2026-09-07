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
 * Ainda faltam para as fases seguintes os dois contratos de escrita de evento
 * (`appendEvent`, que nunca lança, e `persistEvent`, que propaga), o erro
 * terminal de escrita de status e o sanitizador de credenciais (seções 2A e
 * 13.2 do planejamento).
 */

export * from "./dashboard-event-poller.js";
export * from "./logger.js";
export * from "./pg-notify-listener.js";
export * from "./sse-transport.js";

/** Os dois contratos de escrita de evento. */
export type EventWriteContract = "never-throws" | "propagates";

/** O pacote ainda não exporta writers. */
export const EVENTS_PACKAGE = "@dungeon-master/events" as const;
