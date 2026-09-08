import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { McpStdioServerSpec } from "../mcp.js";

/**
 * O servidor MCP falso da suíte de contrato, como `McpServerSpec`.
 *
 * Um arquivo só, sem dependências, que roda no host com o Node do worker e
 * dentro do container montado read-only — a mesma forma de entrega do servidor
 * do Grimório. O marcador é sorteado por suíte: a resposta da ferramenta só
 * pode vir deste processo, e não de um modelo que "lembrou" o texto.
 */

export const FAKE_MCP_SERVER_SCRIPT = fileURLToPath(
  new URL("./fixtures/fake-mcp-server.mjs", import.meta.url),
);

/** Onde o script é montado no container. Fora do home do agente, read-only. */
export const FAKE_MCP_CONTAINER_SCRIPT = "/opt/dungeon-master/testing/fake-mcp-server.mjs";

export const FAKE_MCP_SERVER_NAME = "fake";
export const FAKE_MCP_TOOL_NAME = "echo_marker";

export function newFakeMcpMarker(): string {
  return `dm-mcp-${randomBytes(6).toString("hex")}`;
}

export function fakeMcpServerSpec(input: { readonly marker: string }): McpStdioServerSpec {
  return {
    name: FAKE_MCP_SERVER_NAME,
    transport: "STDIO",
    // `process.execPath` e não `node`: o servidor precisa rodar no Node do
    // worker, e um `node` do PATH pode ser outro.
    command: process.execPath,
    args: [FAKE_MCP_SERVER_SCRIPT, "--marker", input.marker],
    tools: [FAKE_MCP_TOOL_NAME],
    instruction:
      `Servidor MCP \`${FAKE_MCP_SERVER_NAME}\` disponível com a ferramenta ` +
      `${FAKE_MCP_TOOL_NAME}(), que devolve o marcador desta execução.`,
    container: {
      command: "node",
      args: [FAKE_MCP_CONTAINER_SCRIPT, "--marker", input.marker],
      mounts: [
        {
          hostPath: FAKE_MCP_SERVER_SCRIPT,
          containerPath: FAKE_MCP_CONTAINER_SCRIPT,
          readOnly: true,
        },
      ],
    },
  };
}
