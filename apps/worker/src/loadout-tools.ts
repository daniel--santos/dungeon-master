import type { LoadoutSnapshot, ToolSnapshot } from "@dungeon-master/contracts";
import type { McpServerSpec } from "@dungeon-master/runtime";

import type { PolicyNote } from "./policy.js";

/**
 * As Tools do Loadout aplicadas ao Run (planejamento v0.4, Fase 8B).
 *
 * Duas espécies, dois destinos:
 *
 * - **`COMMAND`** é um prefixo de argv, no mesmo formato da allow-list do
 *   ExecutionProfile. Ele se **soma** à lista do perfil — união, sem repetir
 *   —, e a tradução por harness continua sendo a de `policy.ts`: o Worker
 *   diz o que concede, cada adapter escreve isso no argv dele.
 * - **`MCP_TOOL`** é uma ferramenta de um servidor do registro. Ela só faz
 *   sentido se o servidor está neste Run; senão vira `Diagnostic`, porque
 *   uma Tool que aponta para lugar nenhum é uma promessa que o agente nunca
 *   vai receber. Ela não estreita a allow-list do servidor: o adapter que
 *   libera por ferramenta continua liberando o servidor inteiro (ou as que
 *   ele anuncia), e a Tool é a forma de o Loadout dizer o que espera usar.
 *
 * Tudo aqui lê só o snapshot congelado. Nada é relido do registro.
 */

/** Os prefixos de comando das Tools `COMMAND`, na ordem do Loadout, sem repetição. */
export function commandToolPrefixes(snapshot: LoadoutSnapshot): readonly string[] {
  const vistos = new Set<string>();
  const prefixos: string[] = [];
  for (const tool of snapshot.toolDefinitions ?? []) {
    if (tool.kind !== "COMMAND") continue;
    const comando = tool.command?.trim() ?? "";
    if (comando.length === 0 || vistos.has(comando)) continue;
    vistos.add(comando);
    prefixos.push(comando);
  }
  return prefixos;
}

/** Só as Tools `MCP_TOOL` com servidor e nome preenchidos. */
function mcpTools(
  snapshot: LoadoutSnapshot,
): readonly (ToolSnapshot & { mcpServerName: string; toolName: string })[] {
  return (snapshot.toolDefinitions ?? []).flatMap((tool) =>
    tool.kind === "MCP_TOOL" && tool.mcpServerName !== null && tool.toolName !== null
      ? [{ ...tool, mcpServerName: tool.mcpServerName, toolName: tool.toolName }]
      : [],
  );
}

/**
 * Confere as Tools `MCP_TOOL` contra os servidores que o Run vai subir.
 *
 * Uma nota por problema, e uma só de confirmação para as que casaram: o
 * diário é lido por gente, e dez linhas iguais escondem a que importa.
 */
export function checkMcpToolBindings(
  snapshot: LoadoutSnapshot,
  servers: readonly McpServerSpec[],
): readonly PolicyNote[] {
  const notes: PolicyNote[] = [];
  const porNome = new Map(servers.map((server) => [server.name, server]));
  const ligadas: string[] = [];

  for (const tool of mcpTools(snapshot)) {
    const servidor = porNome.get(tool.mcpServerName);
    if (servidor === undefined) {
      notes.push({
        level: "WARN",
        code: "MCP_TOOL_SERVER_MISSING",
        message:
          `A Tool "${tool.name}" aponta para a ferramenta ${tool.toolName} do servidor MCP ` +
          `"${tool.mcpServerName}", que não está neste Run: ela não terá efeito.`,
        detail:
          "O servidor precisa estar entre os do Loadout (ou ser o Grimório com a política de " +
          "conhecimento ligada) e ter sido aceito na montagem dos servidores deste Run.",
      });
      continue;
    }
    const anunciadas = servidor.tools;
    if (anunciadas !== undefined && !anunciadas.includes(tool.toolName)) {
      notes.push({
        level: "WARN",
        code: "MCP_TOOL_UNKNOWN",
        message:
          `A Tool "${tool.name}" pede a ferramenta ${tool.toolName} do servidor MCP ` +
          `"${tool.mcpServerName}", que não a anuncia (anuncia: ${anunciadas.join(", ")}).`,
      });
      continue;
    }
    ligadas.push(`${tool.name} → ${tool.mcpServerName}.${tool.toolName}`);
  }

  if (ligadas.length > 0) {
    notes.push({
      level: "INFO",
      message: `Tools MCP do Loadout ligadas a servidores deste Run: ${ligadas.join(", ")}.`,
    });
  }

  return notes;
}
