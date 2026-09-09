import {
  CreateMcpServerSchema,
  McpServerListQuerySchema,
  McpServerPageSchema,
  McpServerSchema,
  ProblemDetailsSchema,
  UpdateMcpServerSchema,
} from "@dungeon-master/contracts";
import { createRoute } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";
import { IdParamSchema } from "./registry.js";

/**
 * Servidores MCP: a forma de subi-los, sem segredo (Fase 8A).
 *
 * `envKeys` são só nomes de variáveis; o valor nunca é gravado nem vai ao
 * argv. O `knowledge` do Grimório é `builtIn`: não se apaga e só a descrição
 * dele se edita.
 */

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const mcpServersListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/mcp-servers`,
  tags: ["registry"],
  summary: "Lista os servidores MCP",
  request: { query: McpServerListQuerySchema },
  responses: {
    200: {
      description: "Uma página de servidores, em ordem alfabética.",
      content: { "application/json": { schema: McpServerPageSchema } },
    },
    400: problem("Paginação inválida."),
  },
});

export const mcpServersCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/mcp-servers`,
  tags: ["registry"],
  summary: "Cria um servidor MCP",
  description:
    "`STDIO` leva comando e argumentos separados; `HTTP` leva a URL, sem credencial. " +
    "Segredos entram por `envKeys`, que são nomes de variáveis de ambiente.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateMcpServerSchema } } },
  },
  responses: {
    201: {
      description: "Servidor criado.",
      content: { "application/json": { schema: McpServerSchema } },
    },
    400: problem("Corpo inválido."),
    409: problem("Já existe um servidor com este nome."),
  },
});

export const mcpServersGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/mcp-servers/{id}`,
  tags: ["registry"],
  summary: "Um servidor MCP",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "O servidor.",
      content: { "application/json": { schema: McpServerSchema } },
    },
    404: problem("Não existe servidor MCP com este id."),
  },
});

export const mcpServersUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/mcp-servers/{id}`,
  tags: ["registry"],
  summary: "Edita o servidor MCP",
  description:
    "`transport` não muda. Num `builtIn` só `description` é editável; o resto é do Worker.",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateMcpServerSchema } } },
  },
  responses: {
    200: {
      description: "O servidor depois da edição.",
      content: { "application/json": { schema: McpServerSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe servidor MCP com este id."),
    409: problem("Nome já usado, campo do outro transporte, ou servidor `builtIn`."),
  },
});

export const mcpServersDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/mcp-servers/{id}`,
  tags: ["registry"],
  summary: "Apaga o servidor MCP",
  description:
    "Um `builtIn` nunca se apaga. Os demais recusam enquanto uma Tool ou um Loadout os " +
    "referenciam.",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Servidor apagado." },
    404: problem("Não existe servidor MCP com este id."),
    409: problem("Servidor `builtIn`, ou ainda referenciado por Tool ou Loadout."),
  },
});
