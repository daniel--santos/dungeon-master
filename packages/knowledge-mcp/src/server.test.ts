import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createKnowledgeMcpServer } from "./server.js";
import { createInMemoryKnowledgeToolStore } from "./store-memory.js";
import { KNOWLEDGE_MCP_SERVER_NAME, KNOWLEDGE_TOOL_NAMES } from "./tools.js";

/**
 * O servidor falando o protocolo com o cliente do SDK, pelo par em memória.
 *
 * O que se prova aqui é a costura com o SDK: o `tools/list` publica as cinco
 * ferramentas com JSON Schema e anotações de leitura, e o `tools/call` devolve
 * texto (ou `isError`) no envelope certo. A lógica das ferramentas é dos
 * testes de `tools.test.ts`; o processo e o banco, do teste de stdio.
 */

const USER = "01996d00-0000-7000-8000-000000000001";
const PROJECT = "01996d00-0000-7000-8000-00000000aa01";
const ITEM = "01996d00-0000-7000-8000-0000000000b1";

let client: Client;

beforeEach(async () => {
  const server = createKnowledgeMcpServer({
    projectId: PROJECT,
    store: createInMemoryKnowledgeToolStore({
      userId: USER,
      projectId: PROJECT,
      items: [
        {
          id: ITEM,
          userId: USER,
          projectId: PROJECT,
          type: "FACT",
          status: "ACTIVE",
          title: "Autenticação usa OAuth",
          content: "O login é por OAuth.",
        },
      ],
    }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: "teste", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
});

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as readonly { type: string; text?: string }[];
  return content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

describe("servidor MCP do Grimório", () => {
  it("se apresenta com o nome canônico e publica as cinco ferramentas", async () => {
    expect(client.getServerVersion()?.name).toBe(KNOWLEDGE_MCP_SERVER_NAME);
    expect(client.getInstructions()).toContain(PROJECT);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([...KNOWLEDGE_TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description?.length ?? 0).toBeGreaterThan(0);
    }

    const search = tools.find((tool) => tool.name === "search_knowledge");
    expect(search?.inputSchema.required).toEqual(["query"]);
  });

  it("responde tools/call com texto no envelope do protocolo", async () => {
    const result = await client.callTool({
      name: "search_knowledge",
      arguments: { query: "oauth" },
    });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain(ITEM);
  });

  it("argumento inválido volta como isError, e não como exceção do protocolo", async () => {
    const result = await client.callTool({
      name: "get_knowledge_item",
      arguments: { id: "não-é-uuid" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/validation|inválid/i);
  });

  it("ferramenta desconhecida é recusada pelo protocolo", async () => {
    // O cliente do SDK traduz o erro JSON-RPC (-32602) num resultado com
    // `isError`; o que importa é que não existe porta de escrita para chamar.
    const result = await client.callTool({ name: "write_knowledge", arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/write_knowledge not found/);
  });
});
