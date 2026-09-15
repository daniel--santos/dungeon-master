/**
 * De qual servidor MCP veio uma chamada de ferramenta.
 *
 * Os harnesses nomeiam as ferramentas de um servidor MCP com o prefixo
 * `mcp__<servidor>__<ferramenta>` — é assim que o Grimório aparece como
 * `mcp__knowledge__search_knowledge` no diário de um Run. O resto são as
 * ferramentas nativas da CLI (ler arquivo, rodar comando), e elas vão para um
 * balde próprio.
 *
 * O balde nativo tem nome fixo e canônico, e não "(sem servidor)": ele aparece
 * numa tabela ao lado dos servidores de verdade, e um rótulo entre parênteses
 * ficaria ordenado no meio deles como se fosse mais um.
 */

export const NATIVE_TOOL_SERVER = "native" as const;

const MCP_PREFIX = "mcp__";

export function toolServerOf(toolName: string): string {
  if (!toolName.startsWith(MCP_PREFIX)) return NATIVE_TOOL_SERVER;

  const resto = toolName.slice(MCP_PREFIX.length);
  const fim = resto.indexOf("__");
  // `mcp__` sem o segundo separador não é o formato: fica como nativo em vez de
  // virar um servidor de nome estranho na tabela.
  if (fim <= 0) return NATIVE_TOOL_SERVER;

  return resto.slice(0, fim);
}

/** Conta as chamadas por servidor, preservando a ordem de maior para menor. */
export function countToolCallsByServer(
  toolNames: Iterable<string>,
): { readonly server: string; readonly calls: number }[] {
  const contagem = new Map<string, number>();
  for (const name of toolNames) {
    const server = toolServerOf(name);
    contagem.set(server, (contagem.get(server) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([server, calls]) => ({ server, calls }))
    .sort((a, b) => b.calls - a.calls || a.server.localeCompare(b.server));
}
