import { z } from "zod";

import { ACTIVITY_TYPE_VALUES } from "./activity.js";

/**
 * Evento de dashboard: a unidade que a API empurra por SSE para a web.
 *
 * O modelo é o da seção 10.1 do documento técnico: o produtor grava a linha em
 * `dashboard_event` e o PostgreSQL emite um `NOTIFY` **sem payload**. A API faz
 * o *drain* a partir do último cursor e empurra o que leu. Cursor, mapeamento e
 * deduplicação ficam num lugar só, então uma notificação perdida ou coalescida
 * nunca dessincroniza o browser.
 *
 * `sequence` é a chave de reconexão: o browser guarda o último que recebeu e o
 * devolve em `?since=` (ou no header `Last-Event-ID`) quando reconecta.
 */

/**
 * Tipos de evento que o sistema emite hoje.
 *
 * O enum é fechado no **lado de quem escreve**: `appendDashboardEvent` só
 * aceita um destes. Reservados para as fases seguintes, sem entrar ainda:
 * `achievement.unlocked` e `hero_stats.updated` (planejamento v0.4, Fase 2.5).
 *
 * Os tipos de domínio são exatamente os de `ActivityType`, reaproveitados em
 * vez de reescritos: cada mudança de Project ou de Task grava uma linha de
 * `activity` e um evento deste tipo na mesma transação, e dois vocabulários
 * para o mesmo fato divergiriam na primeira adição.
 */
export const DASHBOARD_EVENT_TYPE_VALUES = [
  "system.ping",
  "settings.changed",
  ...ACTIVITY_TYPE_VALUES,
] as const;

export const DashboardEventTypeSchema = z
  .enum(DASHBOARD_EVENT_TYPE_VALUES)
  .meta({ id: "DashboardEventType", description: "Tipos de evento de dashboard emitidos hoje." });

export type DashboardEventType = z.infer<typeof DashboardEventTypeSchema>;

/**
 * Corpo de um evento no stream.
 *
 * `type` é `string`, e não o enum, de propósito: quem **lê** o stream precisa
 * tolerar um tipo que ainda não conhece. Um cliente de uma versão anterior
 * continua funcionando quando a API passa a emitir um tipo novo, em vez de
 * quebrar a validação da resposta inteira. O fechamento vale na escrita.
 */
export const DashboardEventSchema = z
  .object({
    sequence: z
      .number()
      .int()
      .positive()
      .describe("Cursor do evento. Estritamente crescente; é o `id` do evento SSE."),
    type: z.string().describe("Tipo do evento. Os emitidos hoje estão em `DashboardEventType`."),
    payload: z.unknown().describe("Dados do evento, em JSON. A forma depende do `type`."),
    createdAt: z.iso.datetime().describe("Instante da gravação, em UTC (ISO 8601)."),
  })
  .meta({ id: "DashboardEvent", description: "Um evento entregue pelo stream SSE." });

export type DashboardEvent = z.infer<typeof DashboardEventSchema>;

/** Canal de `LISTEN`/`NOTIFY` do PostgreSQL. O `NOTIFY` não carrega payload. */
export const DASHBOARD_EVENT_CHANNEL = "dm_dashboard_event" as const;

/** Resposta de `POST /api/v1/events/ping`. */
export const PingEventResponseSchema = z
  .object({
    event: DashboardEventSchema,
  })
  .meta({ id: "PingEventResponse", description: "O evento `system.ping` recém-gravado." });

export type PingEventResponse = z.infer<typeof PingEventResponseSchema>;
