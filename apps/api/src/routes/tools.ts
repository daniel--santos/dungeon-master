import {
  CreateToolSchema,
  ProblemDetailsSchema,
  ToolListQuerySchema,
  ToolPageSchema,
  ToolSchema,
  UpdateToolSchema,
} from "@dungeon-master/contracts";
import { createRoute } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";
import { IdParamSchema } from "./registry.js";

/** Tools: comando liberado ou ferramenta de um servidor MCP (Fase 8A). */

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const toolsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/tools`,
  tags: ["registry"],
  summary: "Lista as Tools",
  request: { query: ToolListQuerySchema },
  responses: {
    200: {
      description: "Uma página de Tools, em ordem alfabética.",
      content: { "application/json": { schema: ToolPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const toolsCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/tools`,
  tags: ["registry"],
  summary: "Cria uma Tool",
  description:
    "`COMMAND` leva um prefixo de argv, no formato da allow-list do ExecutionProfile " +
    "(`git add`). `MCP_TOOL` leva o servidor do registro e o nome que ele anuncia.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateToolSchema } } },
  },
  responses: {
    201: { description: "Tool criada.", content: { "application/json": { schema: ToolSchema } } },
    400: problem("Corpo inválido."),
    404: problem("O servidor MCP informado não existe."),
    409: problem("Já existe uma Tool com este nome."),
  },
});

export const toolsGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/tools/{id}`,
  tags: ["registry"],
  summary: "Uma Tool",
  request: { params: IdParamSchema },
  responses: {
    200: { description: "A Tool.", content: { "application/json": { schema: ToolSchema } } },
    404: problem("Não existe Tool com este id."),
  },
});

export const toolsUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/tools/{id}`,
  tags: ["registry"],
  summary: "Edita a Tool",
  description: "`kind` não muda. Um campo da outra espécie é recusado com `409`.",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateToolSchema } } },
  },
  responses: {
    200: {
      description: "A Tool depois da edição.",
      content: { "application/json": { schema: ToolSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Tool com este id, ou o servidor informado não existe."),
    409: problem("Nome já usado, ou campo que não pertence à espécie da Tool."),
  },
});

export const toolsDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/tools/{id}`,
  tags: ["registry"],
  summary: "Apaga a Tool",
  description: "Recusa enquanto algum Loadout a referencia.",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Tool apagada." },
    404: problem("Não existe Tool com este id."),
    409: problem("Algum Loadout ainda referencia esta Tool."),
  },
});
