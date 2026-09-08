import type { ContextStore } from "../ports.js";
import { sanitizeForContext } from "../sanitize.js";
import { fastEstimateTokens } from "../token-estimate.js";
import type { EntryDraft, RankedKnowledgeItemSource, SectionDraft } from "../types.js";
import { attrs, cleanTitle } from "./shared.js";

export const KNOWLEDGE_SECTION_TITLE = "Páginas relevantes";

/**
 * As páginas do Grimório relevantes para a Task, pela busca textual.
 *
 * A porta já devolve por `ts_rank`; a ordenação é refeita aqui, com o
 * desempate por data e id, para a saída não depender de como o store
 * implementou a consulta. É a prioridade do orçamento: a menos relevante sai
 * primeiro.
 */
export async function buildKnowledgeSection(
  store: ContextStore,
  input: { readonly projectId: string; readonly query: string; readonly limit: number },
): Promise<SectionDraft> {
  const encontradas = await store.searchKnowledgeItems({
    projectId: input.projectId,
    query: input.query,
    limit: input.limit,
  });

  const ordenadas = [...encontradas].sort(compareByRelevance);
  const entries: EntryDraft[] = ordenadas
    .map((item) => toEntry(item))
    .filter((entry): entry is EntryDraft => entry !== null);

  return { kind: "KNOWLEDGE", title: KNOWLEDGE_SECTION_TITLE, tag: "knowledge", entries };
}

export function compareByRelevance(
  a: RankedKnowledgeItemSource,
  b: RankedKnowledgeItemSource,
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function toEntry(item: RankedKnowledgeItemSource): EntryDraft | null {
  const content = sanitizeForContext(item.content);
  if (content.length === 0) return null;
  const title = cleanTitle(item.title);
  const prefix = `<knowledge-item${attrs([
    ["id", item.id],
    ["type", item.type],
  ])}>\nTítulo: ${title}\n\n`;
  const suffix = "\n</knowledge-item>";
  return {
    item: {
      id: item.id,
      kind: "KNOWLEDGE_ITEM",
      title,
      reason: "FTS_MATCH",
      score: item.score,
      tokens: fastEstimateTokens(`${prefix}${content}${suffix}`),
      truncated: false,
    },
    prefix,
    content,
    suffix,
    truncatable: false,
  };
}
