import {
  CreateProviderSchema,
  ProblemDetailsSchema,
  ProviderListQuerySchema,
  ProviderPageSchema,
  ProviderSchema,
  UpdateProviderSchema,
} from "@dungeon-master/contracts";
import { createRoute } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";
import { IdParamSchema } from "./registry.js";

/** Providers: quem serve os modelos e como se autentica nele (Fase 8A). */

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const providersListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/providers`,
  tags: ["registry"],
  summary: "Lista os Providers",
  request: { query: ProviderListQuerySchema },
  responses: {
    200: {
      description: "Uma página de Providers, em ordem alfabética.",
      content: { "application/json": { schema: ProviderPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const providersCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/providers`,
  tags: ["registry"],
  summary: "Cria um Provider",
  description:
    "`authEnvKeys` são nomes de variáveis de ambiente; o valor nunca é gravado. O " +
    "preflight só olha se a variável existe no ambiente da API.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateProviderSchema } } },
  },
  responses: {
    201: {
      description: "Provider criado.",
      content: { "application/json": { schema: ProviderSchema } },
    },
    400: problem("Corpo inválido."),
    409: problem("Já existe um Provider com este nome."),
  },
});

export const providersGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/providers/{id}`,
  tags: ["registry"],
  summary: "Um Provider",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "O Provider.",
      content: { "application/json": { schema: ProviderSchema } },
    },
    404: problem("Não existe Provider com este id."),
  },
});

export const providersUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/providers/{id}`,
  tags: ["registry"],
  summary: "Edita o Provider",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateProviderSchema } } },
  },
  responses: {
    200: {
      description: "O Provider depois da edição.",
      content: { "application/json": { schema: ProviderSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Provider com este id."),
    409: problem("Já existe um Provider com este nome."),
  },
});

export const providersDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/providers/{id}`,
  tags: ["registry"],
  summary: "Apaga o Provider",
  description: "Recusa enquanto algum Model aponta para ele.",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Provider apagado." },
    404: problem("Não existe Provider com este id."),
    409: problem("Algum Model ainda aponta para este Provider."),
  },
});
