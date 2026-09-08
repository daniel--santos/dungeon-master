import type { ContextStore } from "../ports.js";
import { sanitizeForContext } from "../sanitize.js";
import { fastEstimateTokens } from "../token-estimate.js";
import type { EntryDraft, SectionDraft } from "../types.js";
import { attrs, cleanTitle } from "./shared.js";

export const SUMMARY_SECTION_TITLE = "Resumo do Project";

/**
 * O resumo corrente do Project: um trecho só, cortável.
 *
 * É o único trecho que o orçamento encolhe em vez de excluir, porque um
 * resumo pela metade ainda orienta; e é o último a ser cortado, porque é a
 * visão de conjunto que nenhuma página substitui.
 */
export async function buildSummarySection(
  store: ContextStore,
  input: { readonly projectId: string },
): Promise<SectionDraft> {
  const summary = await store.loadProjectSummary({ projectId: input.projectId });
  const entries: EntryDraft[] = [];

  if (summary !== null) {
    const title = cleanTitle(summary.title);
    const content = sanitizeForContext(summary.content);
    if (content.length > 0) {
      const prefix = `<project-summary${attrs([
        ["id", summary.id],
        ["version", String(summary.version)],
      ])}>\nTítulo: ${title}\n\n`;
      const suffix = "\n</project-summary>";
      entries.push({
        item: {
          id: summary.id,
          kind: "KNOWLEDGE_ITEM",
          title,
          reason: "PROJECT_SUMMARY",
          score: null,
          tokens: fastEstimateTokens(`${prefix}${content}${suffix}`),
          truncated: false,
        },
        prefix,
        content,
        suffix,
        truncatable: true,
      });
    }
  }

  return { kind: "SUMMARY", title: SUMMARY_SECTION_TITLE, tag: null, entries };
}
