import { describe, expect, it } from "vitest";

import {
  applyMcpInstruction,
  isValidMcpServerName,
  mcpEnv,
  mcpEnvKeys,
  mcpServersForContainer,
  mcpServersWithoutContainerLaunch,
  type McpServerSpec,
} from "./mcp.js";

const knowledge: McpServerSpec = {
  name: "knowledge",
  transport: "STDIO",
  command: "C:\\node\\node.exe",
  args: ["C:\\dm\\knowledge-mcp.mjs", "--project", "p1", "--user", "u1"],
  envKeys: ["DATABASE_URL"],
  tools: ["search_knowledge"],
  instruction: "Ferramentas do Grimório disponíveis.",
  container: {
    command: "node",
    args: [
      "/opt/dungeon-master/knowledge-mcp/knowledge-mcp.mjs",
      "--project",
      "p1",
      "--user",
      "u1",
    ],
    mounts: [
      {
        hostPath: "C:\\dm\\knowledge-mcp.mjs",
        containerPath: "/opt/dungeon-master/knowledge-mcp/knowledge-mcp.mjs",
        readOnly: true,
      },
    ],
    env: { DATABASE_URL: "postgresql://u:p@host.docker.internal:5433/dm" },
  },
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
  instruction: "Servidor de documentação.",
};

describe("isValidMcpServerName", () => {
  it("aceita nomes que viram `mcp__<nome>__<tool>` sem ambiguidade", () => {
    expect(isValidMcpServerName("knowledge")).toBe(true);
    expect(isValidMcpServerName("my-server_2")).toBe(true);
  });

  it("recusa maiúscula, espaço, vazio e o que começa com dígito", () => {
    expect(isValidMcpServerName("Knowledge")).toBe(false);
    expect(isValidMcpServerName("meu servidor")).toBe(false);
    expect(isValidMcpServerName("")).toBe(false);
    expect(isValidMcpServerName("1abc")).toBe(false);
  });
});

describe("mcpEnvKeys", () => {
  it("junta as chaves dos servidores stdio, sem repetir", () => {
    const outro: McpServerSpec = { ...doLoadout, envKeys: ["DATABASE_URL", "HOME"] };
    expect(mcpEnvKeys([knowledge, outro, remoto])).toEqual(["DATABASE_URL", "HOME"]);
  });

  it("sem servidores, nada entra na allow-list", () => {
    expect(mcpEnvKeys(undefined)).toEqual([]);
    expect(mcpEnvKeys([doLoadout])).toEqual([]);
  });

  it("as chaves de `env` contam como declaradas, e os valores saem em mcpEnv", () => {
    const comValor: McpServerSpec = { ...doLoadout, env: { DATABASE_URL: "postgresql://v" } };
    expect(mcpEnvKeys([comValor])).toEqual(["DATABASE_URL"]);
    expect(mcpEnv([comValor, knowledge, remoto])).toEqual({ DATABASE_URL: "postgresql://v" });
    expect(mcpEnv(undefined)).toEqual({});
  });
});

describe("applyMcpInstruction", () => {
  it("acrescenta uma linha por servidor com instrução, depois do prompt", () => {
    const prompt = applyMcpInstruction("Faça a tarefa.", [knowledge, doLoadout, remoto]);

    expect(prompt).toBe(
      "Faça a tarefa.\n\nFerramentas do Grimório disponíveis.\nServidor de documentação.",
    );
  });

  it("não toca no prompt sem servidores ou sem instrução", () => {
    expect(applyMcpInstruction("Faça a tarefa.", undefined)).toBe("Faça a tarefa.");
    expect(applyMcpInstruction("Faça a tarefa.", [doLoadout])).toBe("Faça a tarefa.");
  });
});

describe("mcpServersForContainer", () => {
  it("troca comando e argumentos pelos do container e apaga o bloco `container`", () => {
    const [servidor] = mcpServersForContainer([knowledge]);

    expect(servidor).toEqual({
      name: "knowledge",
      transport: "STDIO",
      command: "node",
      args: [
        "/opt/dungeon-master/knowledge-mcp/knowledge-mcp.mjs",
        "--project",
        "p1",
        "--user",
        "u1",
      ],
      envKeys: ["DATABASE_URL"],
      tools: ["search_knowledge"],
      instruction: "Ferramentas do Grimório disponíveis.",
    });
  });

  it("repassa como está quem não tem comando de container, e o aponta como pendente", () => {
    expect(mcpServersForContainer([doLoadout, remoto])).toEqual([doLoadout, remoto]);
    expect(mcpServersWithoutContainerLaunch([knowledge, doLoadout, remoto])).toEqual([doLoadout]);
  });
});
