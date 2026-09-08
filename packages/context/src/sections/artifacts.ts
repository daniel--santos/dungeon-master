import type { ContextStore } from "../ports.js";
import { sanitizeForContext } from "../sanitize.js";
import { fastEstimateTokens } from "../token-estimate.js";
import type { ArtifactSource, EntryDraft, SectionDraft } from "../types.js";
import { cleanTitle } from "./shared.js";

export const ARTIFACTS_SECTION_TITLE = "Artefatos de Runs anteriores";

/**
 * Os artefatos declarados pelos Runs anteriores desta Task e da Task mãe.
 *
 * Uma linha por artefato, do Run mais recente para o mais antigo: o que a
 * tentativa anterior deixou no repositório é o ponto de partida mais barato
 * para a próxima. O caminho passa pela sanitização como todo o resto — ele
 * foi escrito pelo agente.
 */
export async function buildArtifactsSection(
  store: ContextStore,
  input: {
    readonly taskId: string;
    readonly parentTaskId: string | null;
    readonly runId: string;
    readonly limit: number;
  },
): Promise<SectionDraft> {
  const taskIds = input.parentTaskId === null ? [input.taskId] : [input.taskId, input.parentTaskId];
  const artifacts = await store.listPriorArtifacts({
    taskIds,
    excludeRunId: input.runId,
    limit: input.limit,
  });

  const entries: EntryDraft[] = artifacts.map((artifact) => toEntry(artifact, input.taskId));
  return { kind: "ARTIFACTS", title: ARTIFACTS_SECTION_TITLE, tag: "artifacts", entries };
}

function toEntry(artifact: ArtifactSource, taskId: string): EntryDraft {
  const path = cleanTitle(artifact.path);
  const resumo = artifact.summary === null ? "" : cleanTitle(sanitizeForContext(artifact.summary));
  const kind = artifact.kind === null ? "" : ` (${cleanTitle(artifact.kind)})`;
  const origem = artifact.taskId === taskId ? "esta Task" : "Task mãe";

  const prefix = `- \`${path}\`${kind}`;
  const content = resumo.length === 0 ? "" : ` — ${resumo}`;
  const suffix = ` [Run ${artifact.runId}, ${origem}]`;

  return {
    item: {
      id: `${artifact.runId}:${String(artifact.position)}`,
      kind: "ARTIFACT",
      title: path,
      reason: artifact.taskId === taskId ? "PRIOR_RUN_ARTIFACT" : "PARENT_TASK_ARTIFACT",
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
