import { z } from "zod";

import {
  DECISIONS_DEFAULT_LIMIT,
  DECISIONS_MAX_LIMIT,
  formatDecisions,
  formatItem,
  formatNotFound,
  formatSearchResults,
  formatSummary,
  formatTask,
  QUERY_MAX_CHARS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
} from "./format.js";
import type { KnowledgeToolStore } from "./store.js";

/**
 * As cinco ferramentas do Grimório, como funções puras sobre a porta.
 *
 * O servidor MCP (`server.ts`) as registra; os testes de unidade as chamam
 * direto, com o store em memória. A validação dos argumentos acontece aqui,
 * com os mesmos schemas que o servidor publica: quem chamar por fora do MCP
 * recebe a mesma recusa que o agente receberia.
 */

/** Nome canônico do servidor. É o prefixo que o agente vê: `mcp__knowledge__…`. */
export const KNOWLEDGE_MCP_SERVER_NAME = "knowledge" as const;

export const KNOWLEDGE_TOOL_NAMES = [
  "search_knowledge",
  "get_knowledge_item",
  "get_project_summary",
  "list_decisions",
  "get_task_context",
] as const;

export type KnowledgeToolName = (typeof KNOWLEDGE_TOOL_NAMES)[number];

/**
 * Os schemas de entrada, como "raw shape" do Zod: é a forma que o SDK do MCP
 * aceita em `registerTool` e a que vira JSON Schema no `tools/list`.
 */
export const KNOWLEDGE_TOOL_INPUTS = {
  search_knowledge: {
    query: z
      .string()
      .trim()
      .min(1)
      .max(QUERY_MAX_CHARS)
      .describe("Palavras a procurar no título e no conteúdo das páginas."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(SEARCH_MAX_LIMIT)
      .optional()
      .describe(
        `Quantas páginas devolver. Padrão ${String(SEARCH_DEFAULT_LIMIT)}, máximo ${String(SEARCH_MAX_LIMIT)}.`,
      ),
  },
  get_knowledge_item: {
    id: z.uuid().describe("O id da página, como veio em search_knowledge ou list_decisions."),
  },
  get_project_summary: {},
  list_decisions: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(DECISIONS_MAX_LIMIT)
      .optional()
      .describe(
        `Quantas decisões devolver. Padrão ${String(DECISIONS_DEFAULT_LIMIT)}, máximo ${String(DECISIONS_MAX_LIMIT)}.`,
      ),
  },
  get_task_context: {
    taskId: z.uuid().describe("O id da Task, como veio no prompt."),
  },
} as const;

export const KNOWLEDGE_TOOL_DESCRIPTIONS: Readonly<Record<KnowledgeToolName, string>> = {
  search_knowledge:
    "Busca páginas ativas do Grimório deste Project por texto (fatos, decisões, descobertas, " +
    "restrições e procedimentos aprendidos em execuções anteriores). Devolve título, tipo, " +
    "trecho e id de cada página; use get_knowledge_item para ler uma inteira.",
  get_knowledge_item: "Lê uma página inteira do Grimório deste Project pelo id.",
  get_project_summary:
    "Devolve o resumo corrente do Project — a consolidação do que o Grimório sabe — e " +
    "quantas páginas ativas existem.",
  list_decisions:
    "Lista as decisões registradas neste Project, da mais antiga para a mais recente, com " +
    "trecho e id.",
  get_task_context:
    "Mostra título, descrição, estado, Task mãe e dependências de uma Task deste Project.",
};

export interface ToolText {
  readonly text: string;
  /** `true` quando os argumentos foram recusados. Um "não encontrado" não é erro. */
  readonly isError?: boolean;
}

export interface KnowledgeTools {
  searchKnowledge(input: { readonly query: string; readonly limit?: number }): Promise<ToolText>;
  getKnowledgeItem(input: { readonly id: string }): Promise<ToolText>;
  getProjectSummary(): Promise<ToolText>;
  listDecisions(input: { readonly limit?: number }): Promise<ToolText>;
  getTaskContext(input: { readonly taskId: string }): Promise<ToolText>;
}

const SearchSchema = z.object(KNOWLEDGE_TOOL_INPUTS.search_knowledge);
const GetItemSchema = z.object(KNOWLEDGE_TOOL_INPUTS.get_knowledge_item);
const ListDecisionsSchema = z.object(KNOWLEDGE_TOOL_INPUTS.list_decisions);
const GetTaskSchema = z.object(KNOWLEDGE_TOOL_INPUTS.get_task_context);

function rejected(error: z.ZodError): ToolText {
  const motivos = error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "argumentos"}: ${issue.message}`)
    .join("; ");
  return { text: `Argumentos inválidos — ${motivos}.`, isError: true };
}

export function createKnowledgeTools(store: KnowledgeToolStore): KnowledgeTools {
  return {
    async searchKnowledge(input) {
      const parsed = SearchSchema.safeParse(input);
      if (!parsed.success) return rejected(parsed.error);
      const limit = parsed.data.limit ?? SEARCH_DEFAULT_LIMIT;
      const items = await store.searchItems({ query: parsed.data.query, limit });
      return { text: formatSearchResults(parsed.data.query, items) };
    },

    async getKnowledgeItem(input) {
      const parsed = GetItemSchema.safeParse(input);
      if (!parsed.success) return rejected(parsed.error);
      const item = await store.getItem(parsed.data.id);
      if (item === null) return { text: formatNotFound("A página", parsed.data.id) };
      return { text: formatItem(item) };
    },

    async getProjectSummary() {
      const summary = await store.getSummary();
      if (summary === null) {
        return { text: "O Project deste Run não existe mais.", isError: true };
      }
      return { text: formatSummary(summary) };
    },

    async listDecisions(input) {
      const parsed = ListDecisionsSchema.safeParse(input);
      if (!parsed.success) return rejected(parsed.error);
      const items = await store.listDecisions(parsed.data.limit ?? DECISIONS_DEFAULT_LIMIT);
      return { text: formatDecisions(items) };
    },

    async getTaskContext(input) {
      const parsed = GetTaskSchema.safeParse(input);
      if (!parsed.success) return rejected(parsed.error);
      const task = await store.getTask(parsed.data.taskId);
      if (task === null) return { text: formatNotFound("A Task", parsed.data.taskId) };
      return { text: formatTask(task) };
    },
  };
}
