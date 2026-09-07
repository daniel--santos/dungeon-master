import {
  CreateRunSchema,
  ProblemDetailsSchema,
  RunEventListQuerySchema,
  RunEventListSchema,
  RunListQuerySchema,
  RunPageSchema,
  RunSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";
import { StreamHeadersSchema, StreamQuerySchema } from "./events.js";

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const RunIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 do Run."),
});

export const TaskIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 da Task."),
});

export const runsCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/tasks/{id}/runs`,
  tags: ["runs"],
  summary: "Enfileira uma execução para a Task",
  description:
    "Cria o Run em `QUEUED`, com o Loadout e o ExecutionProfile congelados em " +
    "snapshot, e leva a Task a `QUEUED` na mesma transação. Sem `prompt`, ele é " +
    "montado a partir do título e da descrição da Task. Exige Task em `READY` " +
    "ou `FAILED` (retentativa), dependências `COMPLETED` e um Project com " +
    "`workspacePath`.\n\n" +
    "Com `resumeFromRunId`, o Run continua a sessão do harness de um Run " +
    "anterior: Loadout e ExecutionProfile são herdados dele quando não vierem " +
    "no corpo, e o Run de origem precisa ter `harnessSessionId` capturado e um " +
    "Harness que declare a capability `resume`. A retomada é sempre um Run " +
    "novo, com `attempt` maior.",
  request: {
    params: TaskIdParamSchema,
    body: { required: true, content: { "application/json": { schema: CreateRunSchema } } },
  },
  responses: {
    201: {
      description: "Run criado e enfileirado.",
      content: { "application/json": { schema: RunSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("A Task, o Loadout ou o ExecutionProfile informados não existem."),
    409: problem(
      "A Task não aceita Run agora, o Project não tem workspace, " +
        "há dependência pendente, ou o Harness/perfil está desligado.",
    ),
  },
});

export const runsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/runs`,
  tags: ["runs"],
  summary: "Lista as execuções",
  description:
    "Do Run mais recente para o mais antigo. `status` aceita um valor ou " +
    "vários, repetindo o parâmetro.",
  request: { query: RunListQuerySchema },
  responses: {
    200: {
      description: "Uma página de Runs.",
      content: { "application/json": { schema: RunPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const runsGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/runs/{id}`,
  tags: ["runs"],
  summary: "Uma execução",
  request: { params: RunIdParamSchema },
  responses: {
    200: {
      description: "O Run, com os snapshots do Loadout e do ExecutionProfile.",
      content: { "application/json": { schema: RunSchema } },
    },
    404: problem("Não existe Run com este id."),
  },
});

export const runsCancelRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/runs/{id}/cancel`,
  tags: ["runs"],
  summary: "Pede o cancelamento da execução",
  description:
    "Pedir não é cancelar: a marca em `cancelRequestedAt` é o que o worker " +
    "observa para matar a árvore de processos, e quem transiciona para " +
    "`CANCELLED` é quem confirmou o término. A exceção é o Run que ainda não " +
    "subiu nada: em `CREATED` e `QUEUED` a transição sai na hora e a Task volta " +
    "a `READY`. Idempotente.",
  request: { params: RunIdParamSchema },
  responses: {
    200: {
      description: "O Run com o pedido registrado, ou já cancelado.",
      content: { "application/json": { schema: RunSchema } },
    },
    404: problem("Não existe Run com este id."),
    409: problem("O Run já terminou e não há o que cancelar."),
  },
});

export const runsEventsRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/runs/{id}/events`,
  tags: ["runs"],
  summary: "O log de eventos da execução",
  description:
    "Append-only, em ordem crescente de `sequence`, a partir do cursor `after`. " +
    "É a mesma consulta que o replay do stream usa, então não existe uma " +
    "segunda definição de 'o que o cliente perdeu'.",
  request: { params: RunIdParamSchema, query: RunEventListQuerySchema },
  responses: {
    200: {
      description: "Uma página do log.",
      content: { "application/json": { schema: RunEventListSchema } },
    },
    400: problem("Cursor ou limite inválidos."),
    404: problem("Não existe Run com este id."),
  },
});

export const runsEventStreamRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/runs/{id}/events/stream`,
  tags: ["runs"],
  summary: "Stream SSE dos eventos da execução",
  description:
    "Abre um `text/event-stream` só deste Run. Envia primeiro o replay a partir " +
    "do cursor e depois os eventos ao vivo. O `id` de cada evento é a " +
    "`sequence`, que o cliente devolve em `since` (ou no `Last-Event-ID`) para " +
    "reconectar sem perder nem repetir. O header tem precedência sobre a query: " +
    "numa reconexão automática o browser repete a URL da primeira tentativa, " +
    "que já está velha.",
  request: {
    params: RunIdParamSchema,
    query: StreamQuerySchema,
    headers: StreamHeadersSchema,
  },
  responses: {
    200: {
      description: "Stream aberto. Cada `data:` é um `RunEvent` serializado.",
      content: {
        "text/event-stream": {
          schema: z.string().describe("Quadros SSE, um `RunEvent` em JSON por `data:`."),
        },
      },
    },
    400: problem("Cursor inválido."),
    404: problem("Não existe Run com este id."),
  },
});
