import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { KnowledgeToolStore } from "./store.js";
import {
  createKnowledgeTools,
  KNOWLEDGE_MCP_SERVER_NAME,
  KNOWLEDGE_TOOL_DESCRIPTIONS,
  KNOWLEDGE_TOOL_INPUTS,
  type ToolText,
} from "./tools.js";

/**
 * O servidor MCP do Grimório: cinco ferramentas, todas de leitura.
 *
 * O transporte fica de fora de propósito. Em produção ele é o stdio
 * (`bin.ts`); nos testes, o par em memória do SDK, que fala o mesmo protocolo
 * sem subir processo. É o que permite provar o `tools/list` e o `tools/call`
 * de ponta a ponta sem depender de um executável.
 */

/** As anotações que todas as ferramentas carregam: só leitura, sem efeito no mundo. */
const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export interface CreateKnowledgeMcpServerOptions {
  readonly store: KnowledgeToolStore;
  /** Só aparece nas instruções do servidor; o escopo de verdade está no `store`. */
  readonly projectId: string;
  /** Versão publicada no `initialize`. Padrão: `0.0.0`. */
  readonly version?: string;
}

function toResult(output: ToolText): CallToolResult {
  return {
    content: [{ type: "text", text: output.text }],
    ...(output.isError === true ? { isError: true } : {}),
  };
}

export function createKnowledgeMcpServer(options: CreateKnowledgeMcpServerOptions): McpServer {
  const tools = createKnowledgeTools(options.store);

  const server = new McpServer(
    { name: KNOWLEDGE_MCP_SERVER_NAME, version: options.version ?? "0.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        `Grimório do Project ${options.projectId}: o conhecimento acumulado em execuções ` +
        "anteriores. Todas as ferramentas são somente leitura e ficam restritas a este Project.",
    },
  );

  server.registerTool(
    "search_knowledge",
    {
      title: "Buscar no Grimório",
      description: KNOWLEDGE_TOOL_DESCRIPTIONS.search_knowledge,
      inputSchema: KNOWLEDGE_TOOL_INPUTS.search_knowledge,
      annotations: READ_ONLY,
    },
    async (args) => toResult(await tools.searchKnowledge(args)),
  );

  server.registerTool(
    "get_knowledge_item",
    {
      title: "Ler uma página do Grimório",
      description: KNOWLEDGE_TOOL_DESCRIPTIONS.get_knowledge_item,
      inputSchema: KNOWLEDGE_TOOL_INPUTS.get_knowledge_item,
      annotations: READ_ONLY,
    },
    async (args) => toResult(await tools.getKnowledgeItem(args)),
  );

  server.registerTool(
    "get_project_summary",
    {
      title: "Resumo do Project",
      description: KNOWLEDGE_TOOL_DESCRIPTIONS.get_project_summary,
      inputSchema: KNOWLEDGE_TOOL_INPUTS.get_project_summary,
      annotations: READ_ONLY,
    },
    async () => toResult(await tools.getProjectSummary()),
  );

  server.registerTool(
    "list_decisions",
    {
      title: "Decisões do Project",
      description: KNOWLEDGE_TOOL_DESCRIPTIONS.list_decisions,
      inputSchema: KNOWLEDGE_TOOL_INPUTS.list_decisions,
      annotations: READ_ONLY,
    },
    async (args) => toResult(await tools.listDecisions(args)),
  );

  server.registerTool(
    "get_task_context",
    {
      title: "Contexto de uma Task",
      description: KNOWLEDGE_TOOL_DESCRIPTIONS.get_task_context,
      inputSchema: KNOWLEDGE_TOOL_INPUTS.get_task_context,
      annotations: READ_ONLY,
    },
    async (args) => toResult(await tools.getTaskContext(args)),
  );

  return server;
}
