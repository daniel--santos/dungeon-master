import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { OrchestrationToolStore } from "./store.js";
import {
  createOrchestrationTools,
  type CreateOrchestrationToolsOptions,
  ORCHESTRATION_MCP_SERVER_NAME,
  ORCHESTRATION_TOOL_DESCRIPTIONS,
  ORCHESTRATION_TOOL_INPUTS,
  type ToolText,
} from "./tools.js";

/**
 * O servidor MCP de delegação: três ferramentas, uma delas de escrita.
 *
 * O transporte fica de fora de propósito, como no Grimório: em produção é o
 * stdio (`bin.ts`); nos testes, o par em memória do SDK.
 */

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** `delegate_task` escreve: abre Task, Run e eventos. A anotação diz isso ao cliente. */
const WRITES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export interface CreateOrchestrationMcpServerOptions {
  readonly store: OrchestrationToolStore;
  /** Só aparecem nas instruções do servidor; o escopo de verdade está no `store`. */
  readonly runId: string;
  readonly projectId: string;
  /** Versão publicada no `initialize`. Padrão: `0.0.0`. */
  readonly version?: string;
  readonly tools?: CreateOrchestrationToolsOptions;
}

function toResult(output: ToolText): CallToolResult {
  return {
    content: [{ type: "text", text: output.text }],
    ...(output.isError === true ? { isError: true } : {}),
  };
}

export function createOrchestrationMcpServer(
  options: CreateOrchestrationMcpServerOptions,
): McpServer {
  const tools = createOrchestrationTools(options.store, options.tools);

  const server = new McpServer(
    { name: ORCHESTRATION_MCP_SERVER_NAME, version: options.version ?? "0.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        `Delegação do Run ${options.runId} no Project ${options.projectId}: abra Runs filhos ` +
        "com outros Loadouts e espere o desfecho deles. delegate_task escreve de verdade; " +
        "list_loadouts e await_run só leem. Tudo fica restrito a este Run mãe e a este Project.",
    },
  );

  server.registerTool(
    "list_loadouts",
    {
      title: "Loadouts a que se pode delegar",
      description: ORCHESTRATION_TOOL_DESCRIPTIONS.list_loadouts,
      inputSchema: ORCHESTRATION_TOOL_INPUTS.list_loadouts,
      annotations: READ_ONLY,
    },
    async () => toResult(await tools.listLoadouts()),
  );

  server.registerTool(
    "delegate_task",
    {
      title: "Delegar a outro Loadout",
      description: ORCHESTRATION_TOOL_DESCRIPTIONS.delegate_task,
      inputSchema: ORCHESTRATION_TOOL_INPUTS.delegate_task,
      annotations: WRITES,
    },
    async (args) => toResult(await tools.delegateTask(args)),
  );

  server.registerTool(
    "await_run",
    {
      title: "Esperar um Run filho",
      description: ORCHESTRATION_TOOL_DESCRIPTIONS.await_run,
      inputSchema: ORCHESTRATION_TOOL_INPUTS.await_run,
      annotations: READ_ONLY,
    },
    async (args) => toResult(await tools.awaitRun(args)),
  );

  return server;
}
