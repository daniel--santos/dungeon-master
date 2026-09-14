import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOrchestrationMcpServer } from "./server.js";
import { createInMemoryOrchestrationStore } from "./store-memory.js";
import { ORCHESTRATION_MCP_SERVER_NAME, ORCHESTRATION_TOOL_NAMES } from "./tools.js";

/**
 * O servidor falando o protocolo com o cliente do SDK, pelo par em memória:
 * `tools/list` com as anotações certas — só `delegate_task` escreve — e o
 * `tools/call` no envelope certo.
 */

const RUN = "01996d00-0000-7000-8000-00000000c001";
const PROJECT = "01996d00-0000-7000-8000-00000000aa01";

let client: Client;

beforeEach(async () => {
  const server = createOrchestrationMcpServer({
    runId: RUN,
    projectId: PROJECT,
    store: createInMemoryOrchestrationStore({
      runId: RUN,
      projectId: PROJECT,
      loadouts: [
        {
          id: "01996d00-0000-7000-8000-00000000d002",
          name: "Revisor",
          agentName: "Revisora",
          agentRole: "REVIEWER",
          harnessKey: "CLAUDE_CODE",
          isDefault: false,
        },
      ],
    }),
    tools: { sleep: () => Promise.resolve(), pollIntervalMs: 1 },
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

describe("servidor MCP de delegação", () => {
  it("se apresenta com o nome canônico e publica as três ferramentas com as anotações certas", async () => {
    expect(client.getServerVersion()?.name).toBe(ORCHESTRATION_MCP_SERVER_NAME);
    expect(client.getInstructions()).toContain(RUN);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...ORCHESTRATION_TOOL_NAMES].sort());

    const porNome = new Map(tools.map((tool) => [tool.name, tool]));
    expect(porNome.get("list_loadouts")?.annotations?.readOnlyHint).toBe(true);
    expect(porNome.get("await_run")?.annotations?.readOnlyHint).toBe(true);
    // A ferramenta que abre Runs se declara de escrita: o cliente sabe o que ela custa.
    expect(porNome.get("delegate_task")?.annotations?.readOnlyHint).toBe(false);
    expect(porNome.get("delegate_task")?.inputSchema.required).toEqual(["loadout", "prompt"]);
  });

  it("delega e espera pelo protocolo", async () => {
    const aberto = await client.callTool({
      name: "delegate_task",
      arguments: { loadout: "Revisor", prompt: "Revise o plano." },
    });
    expect(aberto.isError).toBeFalsy();
    const runId = /Run filho aberto: (\S+) /.exec(textOf(aberto))![1]!;

    const espera = await client.callTool({
      name: "await_run",
      arguments: { runId, timeoutMs: 1_000 },
    });
    expect(espera.isError).toBeFalsy();
    expect(textOf(espera)).toContain("QUEUED");
  });

  it("argumento inválido volta como isError, e não como exceção do protocolo", async () => {
    const result = await client.callTool({
      name: "await_run",
      arguments: { runId: "não-é-uuid" },
    });
    expect(result.isError).toBe(true);
  });
});
