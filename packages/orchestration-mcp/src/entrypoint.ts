import { fileURLToPath } from "node:url";

import { ORCHESTRATION_MCP_SERVER_NAME, ORCHESTRATION_TOOL_NAMES } from "./tools.js";

/**
 * O que o Worker precisa saber para subir o servidor sem conhecer o seu código.
 *
 * Um arquivo só, empacotado pelo esbuild (`scripts/bundle.mjs`), que roda no
 * host e é montado read-only dentro do container — a mesma forma de entrega
 * do Grimório, pelos mesmos motivos (`packages/knowledge-mcp/src/entrypoint.ts`).
 */

/** Nome do arquivo empacotado, dentro de `dist/bundle/`. */
export const ORCHESTRATION_MCP_BUNDLE_FILE = "orchestration-mcp.mjs" as const;

/** Onde o arquivo empacotado é montado dentro da imagem do agente. */
export const ORCHESTRATION_MCP_CONTAINER_ENTRYPOINT =
  "/opt/dungeon-master/orchestration-mcp/orchestration-mcp.mjs" as const;

/** A única variável de ambiente que o servidor lê. Vai por allow-list, nunca no argv. */
export const ORCHESTRATION_MCP_ENV_KEYS = ["DATABASE_URL"] as const;

/** O caminho absoluto do arquivo empacotado nesta máquina. */
export function orchestrationMcpEntrypoint(): string {
  return fileURLToPath(new URL(`../dist/bundle/${ORCHESTRATION_MCP_BUNDLE_FILE}`, import.meta.url));
}

/**
 * Os argumentos de partida: só ids, que não são segredo e podem ir no argv.
 *
 * O Run mãe, o Project e o usuário são **fixados aqui**, na partida do
 * processo, e nenhuma ferramenta os aceita por argumento: um agente não
 * delega em nome de outro Run nem consulta um filho que não é seu.
 */
export function orchestrationMcpArgs(input: {
  readonly runId: string;
  readonly projectId: string;
  readonly userId: string;
}): readonly string[] {
  return ["--run", input.runId, "--project", input.projectId, "--user", input.userId];
}

/**
 * A linha que o runtime acrescenta ao prompt quando o servidor está ligado.
 *
 * Uma linha fixa, igual em todo Run de nível 4: diz o que existe, quando
 * usar e o que custa. Delegar continua sendo decisão do agente.
 */
export function orchestrationMcpInstruction(): string {
  return (
    `Ferramentas de delegação disponíveis pelo servidor MCP \`${ORCHESTRATION_MCP_SERVER_NAME}\` ` +
    "(escrevem: abrem Runs de verdade neste Project): " +
    "list_loadouts() lista os Loadouts a que você pode delegar; " +
    "delegate_task(loadout, prompt, taskStrategy?) abre um Run filho com esse Loadout e devolve o id; " +
    "await_run(runId, timeoutMs?) espera o filho terminar e devolve o resumo dele. " +
    "Delegue só trabalho que outro Loadout faz melhor, dê ao filho um prompt completo e " +
    "autocontido, e espere o desfecho antes de usar o resultado. A profundidade é limitada e " +
    "o consumo do filho conta no orçamento deste Run."
  );
}

export { ORCHESTRATION_MCP_SERVER_NAME, ORCHESTRATION_TOOL_NAMES };
