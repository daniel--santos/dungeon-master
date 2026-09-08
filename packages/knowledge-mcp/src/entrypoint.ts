import { fileURLToPath } from "node:url";

import { KNOWLEDGE_MCP_SERVER_NAME, KNOWLEDGE_TOOL_NAMES } from "./tools.js";

/**
 * O que o Worker precisa saber para subir o servidor sem conhecer o seu código.
 *
 * O servidor é entregue como **um arquivo só**, empacotado pelo esbuild
 * (`scripts/bundle.mjs`), e é esse arquivo que roda no host e é montado
 * read-only dentro do container. Um arquivo só porque o `node_modules` do pnpm
 * é uma floresta de links simbólicos que não sobrevive a um bind mount, e
 * porque o que roda dentro do container precisa ser exatamente o que roda no
 * host — "o que muda é o spawn".
 */

/** Nome do arquivo empacotado, dentro de `dist/bundle/`. */
export const KNOWLEDGE_MCP_BUNDLE_FILE = "knowledge-mcp.mjs" as const;

/**
 * Onde o arquivo empacotado é montado dentro da imagem do agente.
 *
 * Fora do home do agente e read-only: o agente executa o servidor e não o
 * reescreve. `/opt` porque a imagem não o cria e um bind mount de arquivo cria
 * o diretório pai como `root:root`, o que é indiferente para um arquivo que só
 * precisa ser lido.
 */
export const KNOWLEDGE_MCP_CONTAINER_ENTRYPOINT =
  "/opt/dungeon-master/knowledge-mcp/knowledge-mcp.mjs" as const;

/** A única variável de ambiente que o servidor lê. Vai por allow-list, nunca no argv. */
export const KNOWLEDGE_MCP_ENV_KEYS = ["DATABASE_URL"] as const;

/**
 * O caminho absoluto do arquivo empacotado nesta máquina.
 *
 * Resolvido a partir deste módulo, e não do `cwd`: o Worker roda de qualquer
 * diretório, e `dist/` e `src/` ficam à mesma distância do `dist/bundle/`.
 */
export function knowledgeMcpEntrypoint(): string {
  return fileURLToPath(new URL(`../dist/bundle/${KNOWLEDGE_MCP_BUNDLE_FILE}`, import.meta.url));
}

/** Os argumentos de partida: só ids, que não são segredo e podem ir no argv. */
export function knowledgeMcpArgs(input: {
  readonly projectId: string;
  readonly userId: string;
}): readonly string[] {
  return ["--project", input.projectId, "--user", input.userId];
}

/**
 * A linha que o runtime acrescenta ao prompt quando o servidor está ligado.
 *
 * Uma linha fixa, igual em todo Run: o system prompt estável é o que preserva
 * o cache do provedor (documento técnico, seção 20.1). Ela diz o que existe e
 * quando usar, e mais nada — o recall é decisão do agente, não nossa.
 */
export function knowledgeMcpInstruction(): string {
  return (
    `Ferramentas do Grimório disponíveis pelo servidor MCP \`${KNOWLEDGE_MCP_SERVER_NAME}\` ` +
    "(somente leitura, restritas a este Project): " +
    "search_knowledge(query, limit?) busca páginas por texto; " +
    "get_knowledge_item(id) lê uma página inteira; " +
    "get_project_summary() devolve o resumo corrente do Project; " +
    "list_decisions(limit?) lista as decisões registradas; " +
    "get_task_context(taskId) mostra título, descrição, estado, Task mãe e dependências. " +
    "Consulte-as antes de agir quando precisar de contexto do Project. Elas não escrevem nada."
  );
}

export { KNOWLEDGE_MCP_SERVER_NAME, KNOWLEDGE_TOOL_NAMES };
