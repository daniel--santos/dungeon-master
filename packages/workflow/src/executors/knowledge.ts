import type {
  KnowledgeCandidateInput,
  KnowledgeStepDefinition,
  RunStep,
} from "@dungeon-master/contracts";

import type { StepAttemptOutcome, StepExecutor } from "./types.js";

/**
 * O executor de um step `knowledge` no modo `collect`.
 *
 * Consolida os `knowledgeCandidates` dos steps de agente que já assentaram
 * neste Run, na ordem topológica. Só isso: a destilação em `KnowledgeItem`,
 * com julgamento de agente, é da Fase 6. Não há I/O, e por isso o step nunca
 * falha — uma lista vazia é um resultado legítimo.
 */
export const knowledgeStepExecutor: StepExecutor<KnowledgeStepDefinition> = {
  execute(context): Promise<StepAttemptOutcome> {
    const candidates = collectKnowledgeCandidates([...context.stepsByKey.values()]);
    return Promise.resolve({
      kind: "succeeded",
      result: { kind: "knowledge", candidates },
      summary: `${String(candidates.length)} candidato(s) a conhecimento consolidado(s).`,
    });
  },
};

/** Os candidatos dos steps de agente bem-sucedidos, na ordem em que vieram. */
export function collectKnowledgeCandidates(steps: readonly RunStep[]): KnowledgeCandidateInput[] {
  const candidates: KnowledgeCandidateInput[] = [];
  for (const step of [...steps].sort((a, b) => a.position - b.position)) {
    if (step.result?.kind !== "agent") continue;
    for (const candidate of step.result.knowledgeCandidates ?? []) candidates.push(candidate);
  }
  return candidates;
}
