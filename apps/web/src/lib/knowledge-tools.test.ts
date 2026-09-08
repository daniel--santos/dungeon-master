import { describe, expect, it } from "vitest";

import {
  countKnowledgeToolCalls,
  isKnowledgeTool,
  KNOWLEDGE_TOOL_PREFIX,
  knowledgeToolSequences,
  knowledgeToolShortName,
} from "@/lib/knowledge-tools";
import type { RunEvent } from "@/lib/run-events";

/**
 * As consultas ao Grimório são reconhecidas pelo prefixo do servidor MCP, e
 * a resposta é ligada à chamada pelo `toolCallId` ou, sem id, pela ordem.
 */

function event(sequence: number, type: string, payload: unknown): RunEvent {
  return {
    id: `0199dddd-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    runId: "0199cccc-0000-7000-8000-000000000001",
    sequence,
    type,
    timestamp: "2026-09-08T14:02:11.000Z",
    payload,
  };
}

describe("o prefixo das ferramentas do Grimório", () => {
  it("é o do servidor MCP `knowledge`, na convenção mcp__<servidor>__<ferramenta>", () => {
    expect(KNOWLEDGE_TOOL_PREFIX).toBe("mcp__knowledge__");
    expect(isKnowledgeTool("mcp__knowledge__search_knowledge")).toBe(true);
    expect(isKnowledgeTool("mcp__github__search_code")).toBe(false);
    expect(isKnowledgeTool("Bash")).toBe(false);
    expect(isKnowledgeTool(null)).toBe(false);
    expect(isKnowledgeTool(undefined)).toBe(false);
  });

  it("encurta só o nome que tem o prefixo", () => {
    expect(knowledgeToolShortName("mcp__knowledge__get_project_summary")).toBe(
      "get_project_summary",
    );
    expect(knowledgeToolShortName("Bash")).toBe("Bash");
  });
});

describe("chamadas e respostas do Grimório no log", () => {
  it("marca a chamada e liga a resposta pelo toolCallId", () => {
    const marked = knowledgeToolSequences([
      event(1, "ToolCall", {
        toolCallId: "c1",
        name: "mcp__knowledge__search_knowledge",
        arguments: '{"query":"portão"}',
      }),
      event(2, "ToolCall", { toolCallId: "c2", name: "Read", arguments: "a.ts" }),
      event(3, "ToolResult", { toolCallId: "c2", ok: true, output: "…" }),
      event(4, "ToolResult", { toolCallId: "c1", ok: true, output: "2 páginas" }),
    ]);

    expect([...marked].sort()).toEqual([1, 4]);
  });

  it("sem id, a resposta é da última chamada sem resposta", () => {
    const marked = knowledgeToolSequences([
      event(1, "ToolCall", { name: "mcp__knowledge__list_decisions", arguments: "{}" }),
      event(2, "ToolResult", { ok: true, output: "3 decisões" }),
      event(3, "ToolCall", { name: "Bash", arguments: "pnpm test" }),
      event(4, "ToolResult", { ok: false, output: "1 falhou" }),
      event(5, "ToolResult", { ok: true, output: "resposta órfã" }),
    ]);

    expect([...marked].sort()).toEqual([1, 2]);
  });

  it("a resposta que repete o nome decide por ele", () => {
    const marked = knowledgeToolSequences([
      event(1, "ToolCall", { name: "Bash", arguments: "ls" }),
      event(2, "ToolResult", { name: "mcp__knowledge__get_knowledge_item", ok: true, output: "…" }),
    ]);

    expect([...marked]).toEqual([2]);
  });

  it("conta só as chamadas, nunca as respostas", () => {
    expect(
      countKnowledgeToolCalls([
        event(1, "ToolCall", { name: "mcp__knowledge__search_knowledge", arguments: "{}" }),
        event(2, "ToolResult", { ok: true, output: "…" }),
        event(3, "ToolCall", { name: "mcp__knowledge__get_task_context", arguments: "{}" }),
        event(4, "ToolCall", { name: "Edit", arguments: "b.ts" }),
        event(5, "TextDelta", { text: "pronto" }),
      ]),
    ).toBe(2);
    expect(countKnowledgeToolCalls([])).toBe(0);
  });
});
