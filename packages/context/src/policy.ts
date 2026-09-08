import type { RunContextPolicy } from "@dungeon-master/contracts";

import type { AssembleRunContextInput } from "./types.js";

/**
 * A política efetiva de um Run: as configurações globais são o teto, e o
 * Loadout só aperta.
 *
 * - `budgetTokens`: `context.budgetTokens`, ou o `maxTokens` da política de
 *   contexto do Loadout quando ele é menor (`0` é "sem teto declarado").
 * - `maxKnowledgeItems`: o menor entre `context.maxKnowledgeItems` e o
 *   `maxItems` da política de conhecimento; `0` desliga as páginas.
 * - `maxDecisions`: `context.maxDecisions`, ou zero quando o Loadout não pede
 *   decisões.
 * - `includeProjectSummary`, `includeParentContext` e
 *   `includeDependencyContext` vêm do Loadout.
 * - `maxArtifacts` e `enabled` são só globais: o Loadout não os declara.
 */
export function resolveContextPolicy(
  input: Pick<AssembleRunContextInput, "loadout" | "settings">,
): RunContextPolicy {
  const { loadout, settings } = input;
  const { knowledgePolicy, contextPolicy } = loadout;

  const budgetTokens =
    contextPolicy.maxTokens > 0
      ? Math.min(contextPolicy.maxTokens, settings.budgetTokens)
      : settings.budgetTokens;

  const includeDecisions = knowledgePolicy.includeDecisions && settings.maxDecisions > 0;

  return {
    enabled: settings.enabled,
    budgetTokens,
    maxKnowledgeItems: Math.min(knowledgePolicy.maxItems, settings.maxKnowledgeItems),
    maxDecisions: includeDecisions ? settings.maxDecisions : 0,
    maxArtifacts: settings.maxArtifacts,
    includeProjectSummary: knowledgePolicy.includeProjectSummary,
    includeDecisions,
    includeParentContext: contextPolicy.includeParentContext,
    includeDependencyContext: contextPolicy.includeDependencyContext,
    source: {
      loadout: {
        id: loadout.id,
        version: loadout.version,
        knowledgePolicy: { ...knowledgePolicy },
        contextPolicy: { ...contextPolicy },
      },
      settings: { ...settings },
    },
  };
}
