import {
  CaptureInboxSchema,
  InboxListQuerySchema,
  InboxPageSchema,
  ProblemDetailsSchema,
  PromoteInboxSchema,
  TaskSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

/**
 * A Inbox não é uma entidade: é o recorte das Tasks em `INBOX` (documento
 * técnico, seção 38). As rotas existem separadas porque a operação é outra —
 * capturar precisa custar um campo de texto, e promover é o único caminho de
 * `INBOX` para `READY` que também escolhe o Project.
 */

export const InboxIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 da Task capturada."),
});

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const inboxCaptureRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/inbox`,
  tags: ["inbox"],
  summary: "Captura uma intenção",
  description:
    "Cria uma Task em `INBOX`, sem Project, com o texto como título. É a única " +
    "forma de existir uma Task sem Project: o `CHECK` da tabela recusa " +
    "`project_id` nulo em qualquer outro estado.",
  request: {
    body: { required: true, content: { "application/json": { schema: CaptureInboxSchema } } },
  },
  responses: {
    201: {
      description: "A captura, como Task em `INBOX`.",
      content: { "application/json": { schema: TaskSchema } },
    },
    400: problem("Texto vazio ou longo demais."),
  },
});

export const inboxListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/inbox`,
  tags: ["inbox"],
  summary: "Lista a Inbox",
  description: "As Tasks em `INBOX`, da captura mais recente para a mais antiga.",
  request: { query: InboxListQuerySchema },
  responses: {
    200: {
      description: "Uma página da Inbox.",
      content: { "application/json": { schema: InboxPageSchema } },
    },
    400: problem("Paginação inválida."),
  },
});

export const inboxPromoteRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/inbox/{id}/promote`,
  tags: ["inbox"],
  summary: "Promove a captura a trabalho",
  description:
    "Atribui o Project e leva para `READY`, opcionalmente ajustando título, " +
    "tipo e prioridade. `projectId` é obrigatório porque `READY` sem Project é " +
    "um estado que o banco recusa.",
  request: {
    params: InboxIdParamSchema,
    body: { required: true, content: { "application/json": { schema: PromoteInboxSchema } } },
  },
  responses: {
    200: {
      description: "A Task promovida, em `READY`.",
      content: { "application/json": { schema: TaskSchema } },
    },
    400: problem("Corpo inválido: sem `projectId`, por exemplo."),
    404: problem("A Task ou o Project informados não existem."),
    409: problem("A Task não está em `INBOX`, ou o Project está arquivado."),
  },
});

export const inboxDiscardRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/inbox/{id}/discard`,
  tags: ["inbox"],
  summary: "Descarta a captura",
  description:
    "Leva para `CANCELLED` sem apagar a linha: o que foi capturado continua " +
    "auditável, e uma captura descartada não vira um buraco no histórico.",
  request: { params: InboxIdParamSchema },
  responses: {
    200: {
      description: "A Task descartada, em `CANCELLED`.",
      content: { "application/json": { schema: TaskSchema } },
    },
    404: problem("Não existe Task com este id."),
    409: problem("A Task não está em `INBOX`."),
  },
});
