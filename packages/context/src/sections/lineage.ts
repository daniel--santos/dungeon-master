import type { ContextStore } from "../ports.js";
import { sanitizeForContext } from "../sanitize.js";
import { fastEstimateTokens } from "../token-estimate.js";
import type { EntryDraft, SectionDraft, TaskContextSource } from "../types.js";
import { attrs, cleanTitle } from "./shared.js";

export const LINEAGE_SECTION_TITLE = "Task mãe e dependências";

/** Teto do resumo de resultado de uma Task relacionada, em caracteres. */
export const LINEAGE_RESULT_MAX_LENGTH = 1_500;

/**
 * A Task mãe e as Tasks das quais esta depende, cada uma com o resumo do
 * último Run bem-sucedido.
 *
 * A mãe vem primeiro: é o "porquê" desta Task. As dependências vêm na ordem
 * em que a porta as entregou (a de criação), que é a ordem em que o trabalho
 * anterior aconteceu.
 */
export async function buildLineageSection(
  store: ContextStore,
  input: {
    readonly taskId: string;
    readonly includeParent: boolean;
    readonly includeDependencies: boolean;
  },
): Promise<SectionDraft> {
  const lineage = await store.loadTaskLineage({ taskId: input.taskId });
  const entries: EntryDraft[] = [];

  if (input.includeParent && lineage.parent !== null) {
    entries.push(toEntry(lineage.parent, "parent"));
  }
  if (input.includeDependencies) {
    for (const dependency of lineage.dependencies) {
      entries.push(toEntry(dependency, "dependency"));
    }
  }

  return { kind: "LINEAGE", title: LINEAGE_SECTION_TITLE, tag: "related-tasks", entries };
}

function toEntry(task: TaskContextSource, relation: "parent" | "dependency"): EntryDraft {
  const title = cleanTitle(task.title);
  const descricao = task.description === null ? "" : sanitizeForContext(task.description);
  const resultado =
    task.latestResultSummary === null ? "" : sanitizeForContext(task.latestResultSummary);

  const partes: string[] = [];
  if (descricao.length > 0) partes.push(descricao);
  if (resultado.length > 0) partes.push(`Último resultado: ${limitar(resultado)}`);

  const prefix = `<task${attrs([
    ["relation", relation],
    ["id", task.id],
    ["kind", task.kind],
    ["status", task.status],
  ])}>\nTítulo: ${title}`;
  const content = partes.length === 0 ? "" : `\n\n${partes.join("\n\n")}`;
  const suffix = "\n</task>";

  return {
    item: {
      id: task.id,
      kind: "TASK",
      title,
      reason: relation === "parent" ? "PARENT_TASK" : "DEPENDENCY",
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

function limitar(text: string): string {
  return text.length <= LINEAGE_RESULT_MAX_LENGTH
    ? text
    : `${text.slice(0, LINEAGE_RESULT_MAX_LENGTH - 1).trimEnd()}…`;
}
