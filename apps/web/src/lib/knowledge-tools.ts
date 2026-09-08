import type { RunEvent } from "@/lib/run-events";

/**
 * As consultas do agente ao Grimório, como elas aparecem no Diário (Fase 7C).
 *
 * O servidor MCP do Grimório (`packages/knowledge-mcp`, Fase 7B) é registrado
 * na CLI com o nome canônico `knowledge`, e toda chamada a uma ferramenta dele
 * chega ao stream como `ToolCall` de nome `mcp__<servidor>__<ferramenta>`,
 * que é a convenção do Claude Code e do Codex. A web reconhece essas chamadas
 * pelo prefixo, e o prefixo mora aqui, num só lugar: se o nome do servidor
 * mudar, muda esta constante e nada mais.
 */
export const KNOWLEDGE_TOOL_PREFIX = "mcp__knowledge__";

/** O nome é de uma ferramenta do Grimório? */
export function isKnowledgeTool(name: string | null | undefined): boolean {
  return typeof name === "string" && name.startsWith(KNOWLEDGE_TOOL_PREFIX);
}

/** `mcp__knowledge__search_knowledge` vira `search_knowledge`. Outros nomes voltam como estão. */
export function knowledgeToolShortName(name: string): string {
  return isKnowledgeTool(name) ? name.slice(KNOWLEDGE_TOOL_PREFIX.length) : name;
}

function toolName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const name = (payload as { name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : null;
}

function toolCallId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { toolCallId?: unknown }).toolCallId;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Quais eventos do log são chamadas ao Grimório, ou as respostas delas.
 *
 * Um `ToolResult` nem sempre repete o nome: quando não repete, ele é ligado
 * à chamada pelo `toolCallId`, e sem id, à última chamada sem resposta, que
 * é como os harnesses emitem os pares hoje. O resultado é um conjunto de
 * `sequence`, e não uma marca no evento, porque o log é dado imutável.
 */
export function knowledgeToolSequences(events: readonly RunEvent[]): ReadonlySet<number> {
  const marked = new Set<number>();
  const byCallId = new Map<string, boolean>();
  let lastCall: boolean | null = null;

  for (const event of events) {
    if (event.type === "ToolCall") {
      const knowledge = isKnowledgeTool(toolName(event.payload));
      const id = toolCallId(event.payload);
      if (id !== null) byCallId.set(id, knowledge);
      lastCall = knowledge;
      if (knowledge) marked.add(event.sequence);
      continue;
    }

    if (event.type === "ToolResult") {
      const name = toolName(event.payload);
      const id = toolCallId(event.payload);
      const knowledge =
        name !== null
          ? isKnowledgeTool(name)
          : id !== null
            ? (byCallId.get(id) ?? false)
            : (lastCall ?? false);
      if (knowledge) marked.add(event.sequence);
      // A resposta fecha a chamada: a próxima resposta sem id não é desta.
      if (name === null && id === null) lastCall = null;
    }
  }

  return marked;
}

/** Quantas vezes o agente consultou o Grimório: só as chamadas, não as respostas. */
export function countKnowledgeToolCalls(events: readonly RunEvent[]): number {
  let count = 0;
  for (const event of events) {
    if (event.type === "ToolCall" && isKnowledgeTool(toolName(event.payload))) count += 1;
  }
  return count;
}
