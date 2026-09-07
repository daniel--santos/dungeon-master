import { PingEventResponseSchema, ProblemDetailsSchema } from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

/**
 * Cursor de reconexão, como parâmetro de busca.
 *
 * Declarado como texto com padrão, e não como número coagido: na URL ele **é**
 * texto, e `z.coerce.number()` faria a spec anunciar `integer | null`, o que
 * descreveria mal o que a rota aceita. A conversão fica no handler.
 */
export const StreamQuerySchema = z.object({
  since: z
    .string()
    .max(19)
    .regex(/^\d+$/, "O cursor é um inteiro não negativo em base decimal.")
    .optional()
    .describe(
      "Último `sequence` que o cliente já tem. Ausente ou `0` significa " +
        "'não tenho nada'. O header `Last-Event-ID` tem precedência sobre este valor.",
    ),
});

/**
 * O header que o `EventSource` reenvia sozinho na reconexão automática.
 *
 * Declarado no contrato porque é ele, e não a URL, que carrega o cursor quando
 * o browser reconecta por conta própria: a URL do `EventSource` é a mesma da
 * primeira tentativa e já está desatualizada.
 */
export const StreamHeadersSchema = z.object({
  "last-event-id": z
    .string()
    .optional()
    .describe("Reenviado pelo `EventSource` na reconexão. Tem precedência sobre `since`."),
});

export const eventsStreamRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/events/stream`,
  tags: ["events"],
  summary: "Stream SSE de eventos de dashboard",
  description:
    "Abre um `text/event-stream`. Envia primeiro o replay a partir do cursor e " +
    "depois os eventos ao vivo. O `id` de cada evento é o `sequence`, que o " +
    "cliente devolve em `since` (ou no `Last-Event-ID`) para reconectar sem " +
    "perder nem repetir. Um comentário de heartbeat sai a cada 15 s.",
  request: {
    query: StreamQuerySchema,
    headers: StreamHeadersSchema,
  },
  responses: {
    200: {
      description: "Stream aberto. Cada `data:` é um `DashboardEvent` serializado.",
      content: {
        "text/event-stream": {
          schema: z.string().describe("Quadros SSE, um `DashboardEvent` em JSON por `data:`."),
        },
      },
    },
    400: {
      description: "Cursor inválido.",
      content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
    },
  },
});

export const eventsPingRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/events/ping`,
  tags: ["events"],
  summary: "Grava um evento `system.ping`",
  description:
    "Existe para verificar o caminho completo à mão: INSERT, NOTIFY sem " +
    "payload, drain por cursor e SSE. Responde 404 quando `NODE_ENV` é " +
    "`production`; a rota fica na spec de qualquer forma, para que o cliente " +
    "gerado não dependa do ambiente em que a spec foi gerada.",
  responses: {
    201: {
      description: "Evento gravado.",
      content: { "application/json": { schema: PingEventResponseSchema } },
    },
    404: {
      description: "Endpoint desligado em produção.",
      content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
    },
  },
});
