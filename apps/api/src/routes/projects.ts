import {
  ActivityListQuerySchema,
  ActivityPageSchema,
  CreateProjectSchema,
  ProblemDetailsSchema,
  ProjectDetailSchema,
  ProjectListQuerySchema,
  ProjectPageSchema,
  ProjectSchema,
  UpdateProjectSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

/** O `id` de um Project no caminho. Um id que não existe é sempre 404. */
export const ProjectIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 do Project."),
});

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const projectsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/projects`,
  tags: ["projects"],
  summary: "Lista os Projects",
  description:
    "Do último editado para o mais antigo. `total` é a contagem sem paginação, " +
    "para a tela desenhar o paginador sem uma segunda requisição.",
  request: { query: ProjectListQuerySchema },
  responses: {
    200: {
      description: "Uma página de Projects.",
      content: { "application/json": { schema: ProjectPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const projectsCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/projects`,
  tags: ["projects"],
  summary: "Cria um Project",
  description: "Nasce `ACTIVE`. Grava `project.created` no diário e no stream, na mesma transação.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateProjectSchema } } },
  },
  responses: {
    201: {
      description: "Project criado.",
      content: { "application/json": { schema: ProjectSchema } },
    },
    400: problem("Corpo inválido."),
  },
});

export const projectsGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/projects/{id}`,
  tags: ["projects"],
  summary: "Um Project, com a contagem de Tasks por estado",
  request: { params: ProjectIdParamSchema },
  responses: {
    200: {
      description: "O Project e suas contagens.",
      content: { "application/json": { schema: ProjectDetailSchema } },
    },
    404: problem("Não existe Project com este id."),
  },
});

export const projectsUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/projects/{id}`,
  tags: ["projects"],
  summary: "Edita título e descrição",
  description:
    "`status` não passa por aqui: arquivar e desarquivar têm rotas próprias, " +
    "que também escrevem `archived_at`. Um PATCH que não muda nada não vira " +
    "linha no diário.",
  request: {
    params: ProjectIdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateProjectSchema } } },
  },
  responses: {
    200: {
      description: "O Project depois da edição.",
      content: { "application/json": { schema: ProjectDetailSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Project com este id."),
  },
});

export const projectsArchiveRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/projects/{id}/archive`,
  tags: ["projects"],
  summary: "Arquiva o Project",
  description:
    "Idempotente: arquivar o que já está arquivado devolve o Project e não " +
    "grava um segundo fato. Um Project arquivado não aceita Task nova.",
  request: { params: ProjectIdParamSchema },
  responses: {
    200: {
      description: "O Project arquivado.",
      content: { "application/json": { schema: ProjectDetailSchema } },
    },
    404: problem("Não existe Project com este id."),
  },
});

export const projectsUnarchiveRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/projects/{id}/unarchive`,
  tags: ["projects"],
  summary: "Desarquiva o Project",
  description: "Idempotente, e limpa `archived_at`.",
  request: { params: ProjectIdParamSchema },
  responses: {
    200: {
      description: "O Project ativo de novo.",
      content: { "application/json": { schema: ProjectDetailSchema } },
    },
    404: problem("Não existe Project com este id."),
  },
});

export const projectsActivityRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/projects/{id}/activity`,
  tags: ["projects"],
  summary: "O diário do Project",
  description:
    "Append-only, do registro mais recente para o mais antigo. Cada criação, " +
    "edição e transição de status gravou uma linha aqui na mesma transação da " +
    "mudança.",
  request: { params: ProjectIdParamSchema, query: ActivityListQuerySchema },
  responses: {
    200: {
      description: "Uma página do diário.",
      content: { "application/json": { schema: ActivityPageSchema } },
    },
    400: problem("Paginação inválida."),
    404: problem("Não existe Project com este id."),
  },
});
