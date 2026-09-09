import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionEvent } from "@dungeon-master/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createAgentRuntime, resolveMcpServers } from "./agent-runtime.js";
import type { ExecutionRequest } from "./execution-request.js";
import type { HarnessAdapter, HarnessExecutionRequest } from "./harness.js";
import type { McpServerSpec } from "./mcp.js";
import { createHarnessRegistry } from "./registry.js";
import { fakeHarness } from "./testing/fake-harness.js";
import { createWorkspaceManager } from "./workspace.js";
import { createWorkspaceResolver } from "./workspace-resolver.js";

/**
 * Os servidores MCP atravessando o runtime.
 *
 * O que se prova aqui é a decisão do runtime, e não a CLI: a capability
 * decide se a lista chega ao adapter, a allow-list de ambiente só abre quando
 * ela chega, e a linha de instrução entra no prompt na posição certa. O
 * adapter falso observa o pedido resolvido, que é a forma de ler isso sem
 * abrir o argv de um processo.
 */

const servidor: McpServerSpec = {
  name: "knowledge",
  transport: "STDIO",
  command: process.execPath,
  args: ["servidor.mjs", "--project", "p1"],
  envKeys: ["DM_MCP_DATABASE_URL"],
  tools: ["search_knowledge"],
  instruction: "Ferramentas do Grimório disponíveis: search_knowledge(query).",
};

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "dm-runtime-mcp-"));
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
    () => undefined,
  );
});

function runtimeFor(adapter: HarnessAdapter) {
  return createAgentRuntime({
    registry: createHarnessRegistry([adapter]),
    workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
    envSource: { ...process.env, DM_MCP_DATABASE_URL: "postgresql://u:p@127.0.0.1:1/x" },
  });
}

function request(runId: string, overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    runId,
    taskId: "task-1",
    workspace: { repoPath: workdir },
    harness: { key: "CLAUDE_CODE" },
    loadout: { harness: { key: "CLAUDE_CODE" } },
    executionProfile: { mode: "HOST", workspaceStrategy: "CURRENT" },
    prompt: "@@fake:text OK",
    timeouts: { idleMs: 15_000, completionMs: 30_000 },
    ...overrides,
  };
}

async function collect(adapter: HarnessAdapter, req: ExecutionRequest): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of runtimeFor(adapter).execute(req)) events.push(event);
  return events;
}

describe("servidores MCP no runtime", () => {
  it("entrega os servidores ao adapter, abre a allow-list e acrescenta a linha ao prompt", async () => {
    const pedidos: HarnessExecutionRequest[] = [];
    const adapter = fakeHarness({ onRequest: (r) => pedidos.push(r) });

    const events = await collect(
      adapter,
      request("mcp-ok", {
        mcpServers: [servidor],
        outputSchema: { schema: z.object({ answer: z.string() }), maxRetries: 0 },
        prompt: '@@fake:block {"answer":"ok"}',
      }),
    );

    expect(events.at(-1)?.type, JSON.stringify(events)).toBe("RunCompleted");
    expect(events.some((event) => event.type === "Diagnostic" && /MCP/.test(event.message))).toBe(
      false,
    );

    const pedido = pedidos[0];
    expect(pedido?.mcpServers).toEqual([servidor]);
    // A chave pedida pelo servidor atravessou a allow-list; o valor é o da origem.
    expect(pedido?.env["DM_MCP_DATABASE_URL"]).toBe("postgresql://u:p@127.0.0.1:1/x");
    // A linha entra depois do prompt e antes da instrução do bloco `<result>`.
    const prompt = pedido?.prompt ?? "";
    const posLinha = prompt.indexOf("Ferramentas do Grimório disponíveis");
    const posResult = prompt.indexOf("<result>");
    expect(posLinha).toBeGreaterThan(prompt.indexOf("@@fake:block"));
    expect(posResult).toBeGreaterThan(posLinha);
  });

  it("adapter sem a capability: avisa no diário, não abre a allow-list e o Run segue", async () => {
    const pedidos: HarnessExecutionRequest[] = [];
    const adapter = fakeHarness({
      capabilities: { mcpServers: false },
      onRequest: (r) => pedidos.push(r),
    });

    const events = await collect(adapter, request("mcp-sem", { mcpServers: [servidor] }));

    const aviso = events.find((event) => event.type === "Diagnostic" && /MCP/.test(event.message));
    expect(aviso?.type).toBe("Diagnostic");
    if (aviso?.type === "Diagnostic") {
      expect(aviso.level).toBe("WARN");
      expect(aviso.message).toContain("knowledge");
    }
    expect(events.at(-1)?.type).toBe("RunCompleted");

    const pedido = pedidos[0];
    expect(pedido?.mcpServers).toBeUndefined();
    expect(pedido?.env["DM_MCP_DATABASE_URL"]).toBeUndefined();
    expect(pedido?.prompt).not.toContain("Ferramentas do Grimório");
  });

  it("a variável com valor do servidor entra no ambiente do harness sem estar na origem", async () => {
    const pedidos: HarnessExecutionRequest[] = [];
    const adapter = fakeHarness({ onRequest: (r) => pedidos.push(r) });
    const runtime = createAgentRuntime({
      registry: createHarnessRegistry([adapter]),
      workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
      // Sem DM_MCP_DATABASE_URL na origem: o valor vem do próprio servidor.
      envSource: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "" },
    });

    const events: ExecutionEvent[] = [];
    for await (const event of runtime.execute(
      request("mcp-env", {
        mcpServers: [
          { ...servidor, envKeys: [], env: { DM_MCP_DATABASE_URL: "postgresql://valor" } },
        ],
      }),
    )) {
      events.push(event);
    }

    expect(events.at(-1)?.type, JSON.stringify(events)).toBe("RunCompleted");
    expect(pedidos[0]?.env["DM_MCP_DATABASE_URL"]).toBe("postgresql://valor");
  });

  it("sem servidores no pedido, nada muda", async () => {
    const pedidos: HarnessExecutionRequest[] = [];
    const adapter = fakeHarness({ onRequest: (r) => pedidos.push(r) });

    const events = await collect(adapter, request("mcp-nenhum"));

    expect(events.at(-1)?.type).toBe("RunCompleted");
    expect(pedidos[0]?.mcpServers).toBeUndefined();
    expect(pedidos[0]?.prompt).toBe("@@fake:text OK");
  });

  it("resolveMcpServers nomeia os servidores perdidos no aviso", () => {
    const adapter = fakeHarness({ capabilities: { mcpServers: false } });

    const r = resolveMcpServers([servidor, { ...servidor, name: "docs" }], adapter);

    expect(r.servers).toBeUndefined();
    expect(r.notes.join(" ")).toContain("knowledge, docs");
    expect(resolveMcpServers([], adapter)).toEqual({ servers: undefined, notes: [] });
    expect(resolveMcpServers([servidor], fakeHarness()).servers).toEqual([servidor]);
  });

  it("recusa um servidor HTTP cuja URL leva credencial para o argv", () => {
    // A URL de um servidor `HTTP` é escrita na linha de comando do harness
    // (`--mcp-config` no Claude Code, `-c mcp_servers.x.url` no Codex), e a
    // linha de comando de um processo é legível por qualquer processo da
    // máquina — é a razão de existir da regra `-e NOME` do modo Docker.
    const comSegredo: McpServerSpec = {
      name: "remoto",
      transport: "HTTP",
      url: "https://tok_ab12cd:x@mcp.exemplo.com/sse",
    };

    const r = resolveMcpServers([servidor, comSegredo], fakeHarness());

    expect(r.servers).toEqual([servidor]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toContain("remoto");
    // O aviso não pode repetir o que ele acusa.
    expect(r.notes.join(" ")).not.toContain("tok_ab12cd");
  });

  it("avisa quando a URL de um servidor HTTP tem query, que também vai ao argv", () => {
    const comQuery: McpServerSpec = {
      name: "remoto",
      transport: "HTTP",
      url: "https://mcp.exemplo.com/sse?tenant=acme",
    };

    const r = resolveMcpServers([comQuery], fakeHarness());

    // O servidor segue: uma query não é prova de segredo. O que o diário passa
    // a dizer é que ela fica visível.
    expect(r.servers).toEqual([comQuery]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toContain("remoto");
  });
});
