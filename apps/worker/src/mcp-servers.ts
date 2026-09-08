import type { KnowledgePolicy, LoadoutSnapshot, McpServerRef } from "@dungeon-master/contracts";
import {
  KNOWLEDGE_MCP_CONTAINER_ENTRYPOINT,
  KNOWLEDGE_MCP_ENV_KEYS,
  KNOWLEDGE_MCP_SERVER_NAME,
  KNOWLEDGE_TOOL_NAMES,
  knowledgeMcpArgs,
  knowledgeMcpEntrypoint,
  knowledgeMcpInstruction,
} from "@dungeon-master/knowledge-mcp";
import { isValidMcpServerName, type McpServerSpec } from "@dungeon-master/runtime";

import type { PolicyNote } from "./policy.js";

/**
 * Os servidores MCP de um Run (planejamento v0.4, Fase 7).
 *
 * Dois grupos, montados uma vez por Run e passados nos dois caminhos — o Run
 * simples e cada passo de agente do Ritual:
 *
 * 1. **O servidor do Grimório**, sempre que a política de conhecimento do
 *    Loadout não estiver toda desligada. Uma política com resumo, decisões e
 *    itens em zero é o jeito de o Loadout dizer "este agente não usa o
 *    Grimório" — é o caso do Escriba, que o escreve em vez de o ler — e ele
 *    não ganha ferramenta nenhuma.
 * 2. **Os servidores do Loadout**, repassados como o usuário os declarou: um
 *    comando dividido em palavras para os `STDIO`, a URL para os `HTTP`.
 *
 * O que sai daqui é dado, sem vocabulário de CLI: cada adapter traduz para o
 * `--mcp-config` ou o `-c mcp_servers.*` dele.
 */

/** O nome que o container alcança o host. Combina com o `--add-host` do runtime. */
const CONTAINER_HOST = "host.docker.internal";

/** Hosts do banco que, de dentro do container, são o host. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** O Loadout usa o Grimório? Tudo desligado é a única forma de dizer não. */
export function knowledgeToolsEnabled(policy: KnowledgePolicy): boolean {
  return policy.includeProjectSummary || policy.includeDecisions || policy.maxItems > 0;
}

/**
 * A URL do banco vista de dentro do container.
 *
 * Só o host muda: `127.0.0.1` e `localhost` viram `host.docker.internal`, que
 * o runtime liga com `--add-host`. Uma URL que já aponta para fora da máquina
 * fica como está. O valor continua sendo segredo — ele viaja pelo ambiente do
 * cliente Docker, e o argv leva só `-e DATABASE_URL`.
 */
export function toContainerDatabaseUrl(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) return databaseUrl;
  url.hostname = CONTAINER_HOST;
  return url.toString();
}

/**
 * Quebra o `target` de um servidor `STDIO` do Loadout em comando e argumentos.
 *
 * Por espaço, sem shell: é o que o contrato da Fase 2 permite dizer com uma
 * string só. Um caminho com espaço não sobrevive a isso, e a Fase 8, que
 * transforma o registro de servidores em dado estruturado, é quem resolve.
 */
export function splitCommandTarget(
  target: string,
): { readonly command: string; readonly args: readonly string[] } | undefined {
  const partes = target
    .trim()
    .split(/\s+/)
    .filter((parte) => parte.length > 0);
  const [command, ...args] = partes;
  if (command === undefined) return undefined;
  return { command, args };
}

export interface BuildRunMcpServersInput {
  readonly loadout: LoadoutSnapshot;
  readonly projectId: string;
  readonly userId: string;
  /** A URL do banco deste Worker. Sem ela o Grimório não é oferecido. */
  readonly databaseUrl: string | undefined;
  /** O Node que sobe o servidor no host. Padrão: o do Worker. */
  readonly nodePath?: string;
  /** O arquivo empacotado do servidor. Padrão: o do pacote instalado. */
  readonly knowledgeEntrypoint?: string;
}

export interface RunMcpServers {
  readonly servers: readonly McpServerSpec[];
  /** Diagnósticos a gravar no diário, na ordem. */
  readonly notes: readonly PolicyNote[];
}

export function buildRunMcpServers(input: BuildRunMcpServersInput): RunMcpServers {
  const servers: McpServerSpec[] = [];
  const notes: PolicyNote[] = [];
  const nomes = new Set<string>();

  // ------------------------------------------------------------- Grimório
  if (knowledgeToolsEnabled(input.loadout.knowledgePolicy)) {
    if (input.databaseUrl === undefined || input.databaseUrl.trim().length === 0) {
      notes.push({
        level: "WARN",
        message:
          "O servidor do Grimório não foi oferecido ao agente: o Worker não conhece a URL do banco.",
      });
    } else {
      const entrypoint = input.knowledgeEntrypoint ?? knowledgeMcpEntrypoint();
      const args = knowledgeMcpArgs({ projectId: input.projectId, userId: input.userId });
      servers.push({
        name: KNOWLEDGE_MCP_SERVER_NAME,
        transport: "STDIO",
        // O Node do Worker, e não `node` do PATH: é o mesmo executável que o
        // runtime resolve para as CLIs, e um `node` do PATH pode ser outro.
        command: input.nodePath ?? process.execPath,
        args: [entrypoint, ...args],
        envKeys: [...KNOWLEDGE_MCP_ENV_KEYS],
        env: { DATABASE_URL: input.databaseUrl },
        tools: [...KNOWLEDGE_TOOL_NAMES],
        instruction: knowledgeMcpInstruction(),
        container: {
          command: "node",
          args: [KNOWLEDGE_MCP_CONTAINER_ENTRYPOINT, ...args],
          mounts: [
            {
              hostPath: entrypoint,
              containerPath: KNOWLEDGE_MCP_CONTAINER_ENTRYPOINT,
              readOnly: true,
            },
          ],
          env: { DATABASE_URL: toContainerDatabaseUrl(input.databaseUrl) },
        },
      });
      nomes.add(KNOWLEDGE_MCP_SERVER_NAME);
    }
  }

  // -------------------------------------------------------------- Loadout
  for (const ref of input.loadout.mcpServers) {
    const spec = fromLoadoutRef(ref, nomes, notes);
    if (spec === undefined) continue;
    servers.push(spec);
    nomes.add(spec.name);
  }

  return { servers, notes };
}

function fromLoadoutRef(
  ref: McpServerRef,
  nomes: ReadonlySet<string>,
  notes: PolicyNote[],
): McpServerSpec | undefined {
  const name = ref.name.trim();
  if (!isValidMcpServerName(name)) {
    notes.push({
      level: "WARN",
      message:
        `O servidor MCP "${ref.name}" do Loadout foi ignorado: o nome precisa ter só letras ` +
        "minúsculas, dígitos, hífen e sublinhado, começando por letra.",
    });
    return undefined;
  }
  if (nomes.has(name)) {
    notes.push({
      level: "WARN",
      message:
        `O servidor MCP "${name}" do Loadout foi ignorado: o nome já está em uso neste Run` +
        (name === KNOWLEDGE_MCP_SERVER_NAME ? " (é o nome reservado do Grimório)." : "."),
    });
    return undefined;
  }

  if (ref.transport === "HTTP") {
    const url = ref.target.trim();
    if (!/^https?:\/\//i.test(url)) {
      notes.push({
        level: "WARN",
        message: `O servidor MCP "${name}" do Loadout foi ignorado: "${ref.target}" não é uma URL http(s).`,
      });
      return undefined;
    }
    return { name, transport: "HTTP", url };
  }

  const comando = splitCommandTarget(ref.target);
  if (comando === undefined) {
    notes.push({
      level: "WARN",
      message: `O servidor MCP "${name}" do Loadout foi ignorado: o comando está vazio.`,
    });
    return undefined;
  }
  return { name, transport: "STDIO", command: comando.command, args: comando.args };
}
