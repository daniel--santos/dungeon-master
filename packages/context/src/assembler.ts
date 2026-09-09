import type { RunContext, RunContextPolicy } from "@dungeon-master/contracts";

import { applyBudget, emptySectionBudget, type BudgetOutcome } from "./budget.js";
import { buildFtsQuery } from "./fts-query.js";
import { resolveContextPolicy } from "./policy.js";
import type { ContextStore } from "./ports.js";
import { frameTokens, renderContext, toContextSection } from "./render.js";
import { buildArtifactsSection } from "./sections/artifacts.js";
import { buildDecisionsSection } from "./sections/decisions.js";
import { buildKnowledgeSection } from "./sections/knowledge.js";
import { buildLineageSection } from "./sections/lineage.js";
import { buildSkillsSection } from "./sections/skills.js";
import { buildSummarySection } from "./sections/summary.js";
import { fastEstimateTokens } from "./token-estimate.js";
import type { AssembleRunContextInput, SectionDraft, SkillSource } from "./types.js";

/**
 * O montador (planejamento v0.4, Fase 7: `ContextAssembler`).
 *
 * Uma chamada por Run, quando o Worker o reclama; o resultado é gravado e
 * reusado por todos os passos e por qualquer retomada. Aqui dentro não há
 * modelo, relógio de parede no texto nem aleatoriedade: a mesma entrada
 * produz o mesmo `RunContext`, e o mesmo texto.
 *
 * As seções entram na ordem fixa — resumo, decisões, páginas, linhagem,
 * artefatos, Habilidades — e só as que a política permite são consultadas. As
 * portas são lidas em série: dentro de uma transação elas partilhariam a
 * mesma conexão, e o `pg` não aceita duas consultas ao mesmo tempo nela.
 *
 * **Nunca lança.** Uma porta que falha vira `FAILED`, com o erro no registro
 * e sem nenhuma seção que veio de porta: o Run segue sem contexto do
 * Grimório, e o diário diz por quê. Um contexto parcial em silêncio seria
 * pior que nenhum.
 *
 * **As Habilidades não vêm de porta** (Fase 8B): são o conteúdo congelado no
 * snapshot do Loadout, montadas antes de qualquer consulta. Por isso elas
 * entram mesmo com o Context Engine desligado — o registro sai `ASSEMBLED`
 * com `policy.enabled` falso e só a seção delas — e mesmo quando uma porta
 * falha. Um interruptor de recuperação e uma queda do banco não podem apagar
 * uma instrução que o usuário prendeu ao Loadout.
 */
export async function assembleRunContext(
  input: AssembleRunContextInput,
  store: ContextStore,
): Promise<RunContext> {
  const policy = resolveContextPolicy(input);
  const base = baseRecord(input, policy);
  const budget = { totalTokens: policy.budgetTokens, frameTokens: frameTokens() };
  const skills = buildSkillsSection(skillSources(input.loadout));

  if (!policy.enabled) {
    if (skills.entries.length === 0) return { ...base, status: "DISABLED" };
    return finish(base, null, applyBudget([skills], budget));
  }

  try {
    const query = buildFtsQuery(`${input.task.title}\n${input.task.description ?? ""}`);
    const drafts = await collectSections(input, policy, query, store);
    const outcome = applyBudget([...drafts, skills], budget);
    return finish(base, query, outcome);
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    if (skills.entries.length === 0) return { ...base, status: "FAILED", error: mensagem };
    return {
      ...finish(base, null, applyBudget([skills], budget)),
      status: "FAILED",
      error: mensagem,
    };
  }
}

/** As Habilidades com conteúdo quando o snapshot as tem; só os nomes quando não. */
function skillSources(loadout: AssembleRunContextInput["loadout"]): readonly SkillSource[] {
  if (loadout.skillVersions !== undefined) return loadout.skillVersions;
  return loadout.skills.map((name) => ({ name }));
}

async function collectSections(
  input: AssembleRunContextInput,
  policy: RunContextPolicy,
  query: string | null,
  store: ContextStore,
): Promise<SectionDraft[]> {
  const { task, run } = input;
  const drafts: SectionDraft[] = [];

  if (policy.includeProjectSummary) {
    drafts.push(await buildSummarySection(store, { projectId: task.projectId }));
  }
  if (policy.includeDecisions && policy.maxDecisions > 0) {
    drafts.push(
      await buildDecisionsSection(store, { projectId: task.projectId, limit: policy.maxDecisions }),
    );
  }
  if (policy.maxKnowledgeItems > 0 && query !== null) {
    drafts.push(
      await buildKnowledgeSection(store, {
        projectId: task.projectId,
        query,
        limit: policy.maxKnowledgeItems,
      }),
    );
  }
  if (policy.includeParentContext || policy.includeDependencyContext) {
    drafts.push(
      await buildLineageSection(store, {
        taskId: task.id,
        includeParent: policy.includeParentContext,
        includeDependencies: policy.includeDependencyContext,
      }),
    );
  }
  if (policy.maxArtifacts > 0) {
    drafts.push(
      await buildArtifactsSection(store, {
        taskId: task.id,
        parentTaskId: task.parentTaskId,
        runId: run.id,
        limit: policy.maxArtifacts,
      }),
    );
  }
  return drafts;
}

function finish(
  base: ReturnType<typeof baseRecord>,
  query: string | null,
  outcome: BudgetOutcome,
): RunContext {
  const text = renderContext(outcome.sections);
  const sections = outcome.sections.map(toContextSection);
  const itemCount = sections.reduce((soma, section) => soma + section.items.length, 0);

  return {
    ...base,
    status: itemCount === 0 ? "EMPTY" : "ASSEMBLED",
    text,
    query,
    sections,
    excluded: [...outcome.excluded],
    budget: outcome.budget,
    usage: {
      // A mesma conta com que o teto foi aplicado. `fastEstimateMessages`
      // serializa em JSON antes de estimar e dava um número diferente do
      // orçamento (uns 7% a mais no texto do quadro, e para menos em outros):
      // o painel podia passar de 100% sem o orçamento ter sido estourado.
      estimatedTokens: fastEstimateTokens(text),
      itemCount,
      excludedCount: outcome.excluded.length,
    },
  };
}

function baseRecord(input: AssembleRunContextInput, policy: RunContextPolicy): RunContext {
  const instante = input.now.toISOString();
  return {
    runId: input.run.id,
    taskId: input.task.id,
    projectId: input.task.projectId,
    status: "EMPTY",
    text: "",
    query: null,
    sections: [],
    excluded: [],
    budget: {
      totalTokens: policy.budgetTokens,
      frameTokens: 0,
      summaryMinTokens: 0,
      sections: emptySectionBudget(),
    },
    usage: { estimatedTokens: 0, itemCount: 0, excludedCount: 0 },
    policy,
    inheritedFromRunId: null,
    error: null,
    assembledAt: instante,
    createdAt: instante,
  };
}
