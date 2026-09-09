import { sanitizeForContext } from "@dungeon-master/context";

import type {
  KnowledgeToolItem,
  KnowledgeToolSummary,
  KnowledgeToolTask,
  KnowledgeToolTaskRef,
} from "./store.js";

/**
 * O texto que volta ao agente.
 *
 * Compacto de propósito: cada chamada de ferramenta entra na janela de
 * contexto do modelo, e uma busca que devolvesse vinte páginas inteiras
 * custaria mais do que a página que o agente queria. A busca traz um trecho
 * e o id; quem quer a página inteira pede por id.
 *
 * Todo texto passa por `sanitizeForContext` **na saída**, mesmo o que já foi
 * escapado ao persistir: a cadeia é idempotente (`&lt;` fica `&lt;`), e a
 * regra "texto escrito por modelo nunca volta a um prompt sem sanitizar"
 * (planejamento v0.4, Fase 7) é mais fácil de provar aqui, numa porta só,
 * do que confiando em quem gravou. É a mesma função do bloco de contexto,
 * de propósito: os dois caminhos montam o mesmo campo e não podem divergir.
 * Título e descrição de Task são texto do usuário e passam igual: um
 * `</system>` numa descrição de Missão fecharia a seção do prompt do mesmo
 * jeito.
 */

/** Trecho de conteúdo que acompanha cada resultado de busca. */
export const SNIPPET_CHARS = 320;
/** Teto do conteúdo de uma página inteira. */
export const CONTENT_CHARS = 8_000;
/** Teto do resumo do Project, que é a maior página do Grimório. */
export const SUMMARY_CHARS = 12_000;
/** Teto da descrição de uma Task. */
export const DESCRIPTION_CHARS = 4_000;

export const SEARCH_DEFAULT_LIMIT = 5;
export const SEARCH_MAX_LIMIT = 20;
export const DECISIONS_DEFAULT_LIMIT = 10;
export const DECISIONS_MAX_LIMIT = 50;
export const QUERY_MAX_CHARS = 200;

/**
 * A mesma cadeia do bloco de contexto. Nunca lança e nunca devolve `null`.
 *
 * post-mortem #21 (2026-09-08): aqui era `escapeXmlTags(text).trim()`, e só.
 * Uma página do Grimório com `ESC[2J` no conteúdo saía limpa pelo montador de
 * contexto (`sanitizeForContext` remove os controles) e saía com os controles
 * intactos por estas ferramentas, direto para o stream do harness — a
 * assimetria "sanitizado no caminho A, não no B, e os dois montam o mesmo
 * campo". Uma função só, importada de onde ela já mora.
 */
export function clean(text: string): string {
  return sanitizeForContext(text);
}

/**
 * Corta em `max` caracteres e marca o corte.
 *
 * O corte é seguro porque `clean` roda antes e nunca deixa um `<` de tag de
 * fronteira cru: partir um `&lt;` ao meio deixa `&l`, que é feio e inerte, e
 * nunca reabre um `<`. (O comentário antigo prometia "sem partir uma tag
 * escapada no meio", o que a implementação não faz — e é o tipo de garantia
 * em que uma mudança futura se apoiaria.)
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Uma linha só, para o trecho da busca. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function itemHeader(item: KnowledgeToolItem): string {
  return `[${item.type}] ${clean(item.title)} (id: ${item.id})`;
}

export function formatSearchResults(query: string, items: readonly KnowledgeToolItem[]): string {
  const q = clean(query);
  if (items.length === 0) {
    return `Nenhuma página ativa do Grimório casa com "${q}". Tente outras palavras ou get_project_summary().`;
  }
  const linhas = items.map(
    (item) => `- ${itemHeader(item)}\n  ${truncate(oneLine(clean(item.content)), SNIPPET_CHARS)}`,
  );
  return `${String(items.length)} página(s) do Grimório para "${q}" (use get_knowledge_item(id) para ler inteira):\n${linhas.join("\n")}`;
}

export function formatItem(item: KnowledgeToolItem): string {
  return [
    itemHeader(item),
    `versão ${String(item.version)} · atualizado em ${item.updatedAt}`,
    "",
    truncate(clean(item.content), CONTENT_CHARS),
  ].join("\n");
}

export function formatSummary(summary: KnowledgeToolSummary): string {
  const cabecalho =
    `Grimório: ${String(summary.activeItemCount)} página(s) ativa(s); ` +
    `${String(summary.promotedSinceSummary)} ativada(s) depois da última regeneração do resumo.`;
  if (summary.item === null) {
    return `${cabecalho}\nAinda não há resumo do Project. Use search_knowledge(query) para achar páginas.`;
  }
  return [
    cabecalho,
    `${clean(summary.item.title)} (id: ${summary.item.id}, versão ${String(summary.item.version)}, atualizado em ${summary.item.updatedAt})`,
    "",
    truncate(clean(summary.item.content), SUMMARY_CHARS),
  ].join("\n");
}

export function formatDecisions(items: readonly KnowledgeToolItem[]): string {
  if (items.length === 0) return "Nenhuma decisão ativa registrada neste Project.";
  const linhas = items.map(
    (item, index) =>
      `${String(index + 1)}. ${clean(item.title)} (id: ${item.id}, ${item.createdAt})\n   ${truncate(oneLine(clean(item.content)), SNIPPET_CHARS)}`,
  );
  return `${String(items.length)} decisão(ões), da mais antiga para a mais recente:\n${linhas.join("\n")}`;
}

function formatRef(ref: KnowledgeToolTaskRef): string {
  return `${clean(ref.title)} [${ref.status}] (id: ${ref.id})`;
}

export function formatTask(task: KnowledgeToolTask): string {
  const descricao =
    task.description === null || task.description.trim().length === 0
      ? "(sem descrição)"
      : truncate(clean(task.description), DESCRIPTION_CHARS);
  const dependencias =
    task.dependencies.length === 0
      ? "- Dependências: nenhuma"
      : `- Dependências (precisam terminar antes):\n${task.dependencies.map((ref) => `  - ${formatRef(ref)}`).join("\n")}`;
  const dependentes =
    task.dependents.length === 0
      ? "- Dependentes: nenhuma"
      : `- Dependentes (esperam por esta):\n${task.dependents.map((ref) => `  - ${formatRef(ref)}`).join("\n")}`;
  return [
    `Task: ${clean(task.title)} (id: ${task.id})`,
    `- Estado: ${task.status} · Tipo: ${task.kind} · Prioridade: ${task.priority}`,
    `- Task mãe: ${task.parent === null ? "nenhuma" : formatRef(task.parent)}`,
    dependencias,
    dependentes,
    "- Descrição:",
    descricao,
  ].join("\n");
}

export function formatNotFound(what: string, id: string): string {
  return `${what} ${id} não existe neste Project, ou não está ativa no Grimório.`;
}
