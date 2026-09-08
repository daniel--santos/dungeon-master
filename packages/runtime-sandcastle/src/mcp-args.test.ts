import type { HarnessExecutionRequest, McpServerSpec } from "@dungeon-master/runtime";
import { describe, expect, it } from "vitest";

import {
  buildClaudeCodeArgs,
  claudeMcpConfig,
  mcpAllowedToolsFor,
  parseClaudeLine,
} from "./claude-code.js";
import { codexDefinition, codexMcpArgs, parseCodexLine, tomlString } from "./codex.js";
import { piDefinition } from "./pi.js";

/**
 * A tradução dos servidores MCP para o argv de cada CLI.
 *
 * O que estes testes protegem é o que a suíte de contrato com a CLI real não
 * consegue ler: que o segredo não está no argv, que o comando viaja em array,
 * e que a allow-list libera exatamente as ferramentas do pedido. Os valores
 * das flags são os medidos em 08/09/2026 (Claude Code 2.1.263, Codex 0.147.0).
 */

const knowledge: McpServerSpec = {
  name: "knowledge",
  transport: "STDIO",
  command: "C:\\nvm4w\\nodejs\\node.exe",
  args: ["D:\\dm\\knowledge-mcp.mjs", "--project", "p1", "--user", "u1"],
  envKeys: ["DATABASE_URL"],
  tools: ["search_knowledge", "get_knowledge_item"],
  instruction: "Ferramentas do Grimório.",
};

const doLoadout: McpServerSpec = {
  name: "filesystem",
  transport: "STDIO",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/work"],
};

const remoto: McpServerSpec = {
  name: "docs",
  transport: "HTTP",
  url: "https://mcp.example.com/mcp",
};

function request(overrides: Partial<HarnessExecutionRequest> = {}): HarnessExecutionRequest {
  return {
    executionId: "run-1",
    cwd: "D:\\repo",
    prompt: "oi",
    env: { DATABASE_URL: "postgresql://u:senha-secreta@127.0.0.1:5433/dm" },
    permission: { mode: "DEFAULT", enforcement: "HARNESS_NATIVE" },
    mcpServers: [knowledge, doLoadout, remoto],
    ...overrides,
  };
}

describe("Claude Code", () => {
  it("passa a configuração como JSON no argv, estrita, sem nenhum bloco env", () => {
    const { args } = buildClaudeCodeArgs(request());

    const config = args[args.indexOf("--mcp-config") + 1] ?? "";
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(config)).toEqual({
      mcpServers: {
        knowledge: {
          type: "stdio",
          command: "C:\\nvm4w\\nodejs\\node.exe",
          args: ["D:\\dm\\knowledge-mcp.mjs", "--project", "p1", "--user", "u1"],
        },
        filesystem: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/work"],
        },
        docs: { type: "http", url: "https://mcp.example.com/mcp" },
      },
    });
    // O segredo fica no ambiente da CLI, que o servidor herda.
    expect(args.join(" ")).not.toContain("senha-secreta");
    expect(config).not.toContain("env");
  });

  it("libera as ferramentas declaradas e o servidor inteiro de quem não declara", () => {
    expect(mcpAllowedToolsFor([knowledge, doLoadout, remoto])).toEqual([
      "mcp__knowledge__search_knowledge",
      "mcp__knowledge__get_knowledge_item",
      "mcp__filesystem",
      "mcp__docs",
    ]);
  });

  it("no modo padrão a allow-list existe só pelas ferramentas MCP", () => {
    const { args } = buildClaudeCodeArgs(request());

    const allowed = args[args.indexOf("--allowedTools") + 1] ?? "";
    expect(allowed.split(",")).toEqual([
      "mcp__knowledge__search_knowledge",
      "mcp__knowledge__get_knowledge_item",
      "mcp__filesystem",
      "mcp__docs",
    ]);
    expect(args).toContain("--permission-prompts");
  });

  it("no modo configurado as ferramentas MCP se somam à concessão, numa flag só", () => {
    const { args } = buildClaudeCodeArgs(
      request({
        permission: {
          mode: "CONFIGURED",
          enforcement: "HARNESS_NATIVE",
          grant: {
            workspaceWrite: true,
            commandExecution: "ALLOWLIST",
            allowedCommands: ["git status"],
            deniedCommands: [],
          },
        },
      }),
    );

    expect(args.filter((arg) => arg === "--allowedTools")).toHaveLength(1);
    const allowed = (args[args.indexOf("--allowedTools") + 1] ?? "").split(",");
    expect(allowed).toContain("Read");
    expect(allowed).toContain("Bash(git status:*)");
    expect(allowed).toContain("mcp__knowledge__search_knowledge");
    expect(allowed).toContain("mcp__filesystem");
  });

  it("em BYPASS a configuração vai e a allow-list não", () => {
    const { args } = buildClaudeCodeArgs(
      request({ permission: { mode: "BYPASS", enforcement: "SANDBOX_ENFORCED" } }),
    );
    expect(args).toContain("--mcp-config");
    expect(args).not.toContain("--allowedTools");
  });

  it("sem servidores, nenhuma flag de MCP entra e o modo padrão continua sem allow-list", () => {
    const { args } = buildClaudeCodeArgs(request({ mcpServers: undefined }));
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--allowedTools");
  });

  it("claudeMcpConfig é o que a CLI leu no spike", () => {
    expect(claudeMcpConfig([remoto])).toEqual({
      mcpServers: { docs: { type: "http", url: "https://mcp.example.com/mcp" } },
    });
  });

  it("o init diz qual servidor não conectou, e isso vira aviso", () => {
    const signals = parseClaudeLine(
      '{"type":"system","subtype":"init","session_id":"s1","mcp_servers":[{"name":"knowledge","status":"connected"},{"name":"docs","status":"failed"}]}',
    );

    expect(signals[0]).toEqual({ kind: "session", id: "s1" });
    expect(signals[1]).toMatchObject({
      kind: "diagnostic",
      level: "WARN",
      code: "MCP_SERVER_NOT_CONNECTED",
    });
    expect(signals).toHaveLength(2);
  });
});

describe("Codex", () => {
  it("tomlString usa literal com aspas simples, que preserva a barra invertida", () => {
    expect(tomlString("C:\\nvm4w\\node.exe")).toBe("'C:\\nvm4w\\node.exe'");
    // Aspas duplas e barras sobrevivem na literal, que é o caso dos caminhos.
    expect(tomlString('a"b\\c')).toBe("'a\"b\\c'");
    // Só a aspa simples obriga a string básica, com os escapes dela.
    expect(tomlString("it's")).toBe('"it\'s"');
    expect(tomlString('it\'s "x"\\y')).toBe('"it\'s \\"x\\"\\\\y"');
  });

  it("monta os overrides de config sem gravar nada no ~/.codex e sem segredo", () => {
    const args = codexMcpArgs([knowledge, doLoadout, remoto]);

    expect(args).toEqual([
      "-c",
      "mcp_servers.knowledge.command='C:\\nvm4w\\nodejs\\node.exe'",
      "-c",
      "mcp_servers.knowledge.args=['D:\\dm\\knowledge-mcp.mjs', '--project', 'p1', '--user', 'u1']",
      "-c",
      "mcp_servers.knowledge.env_vars=['DATABASE_URL']",
      "-c",
      "mcp_servers.knowledge.enabled_tools=['search_knowledge', 'get_knowledge_item']",
      "-c",
      'mcp_servers.knowledge.default_tools_approval_mode="approve"',
      "-c",
      "mcp_servers.filesystem.command='npx'",
      "-c",
      "mcp_servers.filesystem.args=['-y', '@modelcontextprotocol/server-filesystem', '/work']",
      "-c",
      'mcp_servers.filesystem.default_tools_approval_mode="approve"',
      "-c",
      "mcp_servers.docs.url='https://mcp.example.com/mcp'",
      "-c",
      'mcp_servers.docs.default_tools_approval_mode="approve"',
    ]);
    expect(args.join(" ")).not.toContain("senha-secreta");
  });

  it("o buildArgs do adapter leva os overrides antes do `-` do stdin", () => {
    const { args } = codexDefinition().buildArgs(request({ mcpServers: [knowledge] }));

    expect(args.at(-1)).toBe("-");
    expect(args).toContain("mcp_servers.knowledge.env_vars=['DATABASE_URL']");
    expect(args.join(" ")).not.toContain("senha-secreta");
  });

  it("uma chamada MCP no stream vira ToolCall/ToolResult com o nome do servidor", () => {
    const inicio = parseCodexLine(
      '{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"knowledge","tool":"search_knowledge","arguments":{"query":"oauth"},"result":null,"error":null,"status":"in_progress"}}',
    );
    expect(inicio).toEqual([
      {
        kind: "tool_call",
        id: "item_1",
        name: "mcp__knowledge__search_knowledge",
        args: '{"query":"oauth"}',
      },
    ]);

    const fim = parseCodexLine(
      '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"knowledge","tool":"search_knowledge","arguments":{"query":"oauth"},"result":{"content":[{"type":"text","text":"1 página do Grimório"}],"structured_content":null},"error":null,"status":"completed"}}',
    );
    expect(fim).toEqual([
      {
        kind: "tool_result",
        id: "item_1",
        name: "mcp__knowledge__search_knowledge",
        ok: true,
        output: "1 página do Grimório",
      },
    ]);

    const falha = parseCodexLine(
      '{"type":"item.completed","item":{"id":"item_2","type":"mcp_tool_call","server":"probe","tool":"env_probe","arguments":{},"result":null,"error":{"message":"user cancelled MCP tool call"},"status":"failed"}}',
    );
    expect(falha).toEqual([
      {
        kind: "tool_result",
        id: "item_2",
        name: "mcp__probe__env_probe",
        ok: false,
        output: "user cancelled MCP tool call",
      },
    ]);
  });
});

describe("Pi", () => {
  it("declara que não sobe servidor MCP e ignora a lista sem tocar no argv", () => {
    const definition = piDefinition();
    expect(definition.capabilities.mcpServers).toBe(false);

    const { args } = definition.buildArgs(request());
    expect(args.join(" ")).not.toContain("mcp");
    expect(args.join(" ")).not.toContain("senha-secreta");
  });
});
