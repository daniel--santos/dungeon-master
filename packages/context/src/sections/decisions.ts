import type { ContextStore } from "../ports.js";
import { sanitizeForContext } from "../sanitize.js";
import { fastEstimateTokens } from "../token-estimate.js";
import type { EntryDraft, KnowledgeItemSource, SectionDraft } from "../types.js";
import { attrs, cleanTitle, dateOnly } from "./shared.js";

export const DECISIONS_SECTION_TITLE = "Decisões recentes";

/**
 * As N decisões mais recentes do Project, da mais nova para a mais antiga.
 *
 * A ordem é a prioridade: a mais recente é a que mais provavelmente ainda
 * vale, e quando falta orçamento a mais antiga é a primeira a sair. A
 * ordenação é refeita aqui, com desempate por id, para a saída não depender
 * de como o store implementou a consulta.
 */
export async function buildDecisionsSection(
  store: ContextStore,
  input: { readonly projectId: string; readonly limit: number },
): Promise<SectionDraft> {
  const recentes = await store.listRecentDecisions({
    projectId: input.projectId,
    limit: input.limit,
  });

  const entries: EntryDraft[] = [...recentes]
    .sort(compareNewestFirst)
    .map((decision) => toEntry(decision))
    .filter((entry): entry is EntryDraft => entry !== null);

  return { kind: "DECISIONS", title: DECISIONS_SECTION_TITLE, tag: "decisions", entries };
}

export function compareNewestFirst(a: KnowledgeItemSource, b: KnowledgeItemSource): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function toEntry(decision: KnowledgeItemSource): EntryDraft | null {
  const content = sanitizeForContext(decision.content);
  if (content.length === 0) return null;
  const title = cleanTitle(decision.title);
  const prefix = `<decision${attrs([
    ["id", decision.id],
    ["date", dateOnly(decision.createdAt)],
  ])}>\nTítulo: ${title}\n\n`;
  const suffix = "\n</decision>";
  return {
    item: {
      id: decision.id,
      kind: "KNOWLEDGE_ITEM",
      title,
      reason: "RECENT_DECISION",
      score: null,
      tokens: fastEstimateTokens(`${prefix}${content}${suffix}`),
      truncated: false,
    },
    prefix,
    content,
    suffix,
    truncatable: false,
  };
}
