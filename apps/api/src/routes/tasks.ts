import {
  ChangeTaskStatusSchema,
  CreateTaskSchema,
  ProblemDetailsSchema,
  TaskDetailSchema,
  TaskListQuerySchema,
  TaskPageSchema,
  TaskSchema,
  UpdateTaskSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

export const TaskIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 da Task."),
});

export const TaskDependencyParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 da Task que espera."),
  dependsOnId: z.uuid().describe("UUIDv7 da Task esperada."),
});

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const tasksListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/tasks`,
  tags: ["tasks"],
  summary: "Lista as Tasks",
  description:
    "Da última editada para a mais antiga. `status` aceita um valor ou vários, " +
    "repetindo o parâmetro. `q` busca por trecho do título, sem diferenciar " +
    "maiúsculas, e os curingas do SQL são escapados.",
  request: { query: TaskListQuerySchema },
  responses: {
    200: {
      description: "Uma página de Tasks.",
      content: { "application/json": { schema: TaskPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const tasksCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/tasks`,
  tags: ["tasks"],
  summary: "Cria uma Task",
  description:
    "Nasce em `READY`, com Project obrigatório. `INBOX` é alcançado só pela " +
    "captura da Inbox. Um Project arquivado recusa a criação com `409`.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateTaskSchema } } },
  },
  responses: {
    201: {
      description: "Task criada.",
      content: { "application/json": { schema: TaskSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("O Project ou a Task mãe informados não existem."),
    409: problem("Project arquivado, ou Task mãe em outro Project ou na Inbox."),
  },
});

export const tasksGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/tasks/{id}`,
  tags: ["tasks"],
  summary: "Uma Task, com filhas, dependências e dependentes",
  request: { params: TaskIdParamSchema },
  responses: {
    200: {
      description: "A Task e suas ligações.",
      content: { "application/json": { schema: TaskDetailSchema } },
    },
    404: problem("Não existe Task com este id."),
  },
});

export const tasksUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/tasks/{id}`,
  tags: ["tasks"],
  summary: "Edita os campos editáveis",
  description:
    "`status` nunca passa por aqui: a transição tem rota própria, que valida a " +
    "máquina de estados e as regras de filhas e dependências. Trocar o Project " +
    "só vale para uma Task sem mãe e sem filhas.",
  request: {
    params: TaskIdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateTaskSchema } } },
  },
  responses: {
    200: {
      description: "A Task depois da edição.",
      content: { "application/json": { schema: TaskDetailSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("A Task, o Project ou a Task mãe informados não existem."),
    409: problem("A edição quebraria uma regra: hierarquia, Project arquivado ou ciclo."),
  },
});

export const tasksChangeStatusRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/tasks/{id}/status`,
  tags: ["tasks"],
  summary: "Move a Task na máquina de estados",
  description:
    "Valida a aresta e as regras que dependem de outras Tasks: concluir exige " +
    "toda subtarefa `COMPLETED` ou `CANCELLED`, e enfileirar exige toda " +
    "dependência `COMPLETED`. Recusa vira `409` com o motivo em `detail`.",
  request: {
    params: TaskIdParamSchema,
    body: { required: true, content: { "application/json": { schema: ChangeTaskStatusSchema } } },
  },
  responses: {
    200: {
      description: "A Task no estado novo.",
      content: { "application/json": { schema: TaskDetailSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Task com este id."),
    409: problem("A transição não é permitida a partir do estado atual."),
  },
});

export const tasksAddDependencyRoute = createRoute({
  method: "put",
  path: `${API_BASE_PATH}/tasks/{id}/dependencies/{dependsOnId}`,
  tags: ["tasks"],
  summary: "Declara que esta Task espera outra",
  description:
    "Idempotente: repetir devolve o mesmo estado e não grava um segundo fato. " +
    "Auto-dependência e ciclo, direto ou indireto, viram `409` com o caminho " +
    "do impasse em `detail`.",
  request: { params: TaskDependencyParamSchema },
  responses: {
    200: {
      description: "A Task com a dependência incluída.",
      content: { "application/json": { schema: TaskDetailSchema } },
    },
    404: problem("Alguma das duas Tasks não existe."),
    409: problem("Auto-dependência, ciclo, ou Task na Inbox."),
  },
});

export const tasksRemoveDependencyRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/tasks/{id}/dependencies/{dependsOnId}`,
  tags: ["tasks"],
  summary: "Remove a dependência",
  description:
    "Idempotente: remover o que não existe devolve o estado atual sem gravar " +
    "fato nenhum. `404` só quando alguma das duas Tasks não existe.",
  request: { params: TaskDependencyParamSchema },
  responses: {
    200: {
      description: "A Task sem a dependência.",
      content: { "application/json": { schema: TaskDetailSchema } },
    },
    404: problem("Alguma das duas Tasks não existe."),
  },
});
