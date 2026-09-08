import { describe, expect, it } from "vitest";

import { resolveContextPolicy } from "./policy.js";

const LOADOUT_ID = "01990000-0000-7000-8000-000000000001";

const settings = {
  enabled: true,
  budgetTokens: 6000,
  maxKnowledgeItems: 8,
  maxDecisions: 5,
  maxArtifacts: 10,
};

function loadout(overrides: {
  maxItems?: number;
  includeDecisions?: boolean;
  includeProjectSummary?: boolean;
  maxTokens?: number;
  includeParentContext?: boolean;
  includeDependencyContext?: boolean;
}) {
  return {
    id: LOADOUT_ID,
    version: 3,
    skills: [],
    knowledgePolicy: {
      includeProjectSummary: overrides.includeProjectSummary ?? true,
      includeDecisions: overrides.includeDecisions ?? true,
      maxItems: overrides.maxItems ?? 20,
    },
    contextPolicy: {
      includeParentContext: overrides.includeParentContext ?? true,
      includeDependencyContext: overrides.includeDependencyContext ?? true,
      maxTokens: overrides.maxTokens ?? 0,
    },
  };
}

describe("resolveContextPolicy", () => {
  it("as configurações globais são o teto; o Loadout só aperta", () => {
    const politica = resolveContextPolicy({
      loadout: loadout({ maxItems: 20, maxTokens: 0 }),
      settings,
    });
    expect(politica.budgetTokens).toBe(6000);
    expect(politica.maxKnowledgeItems).toBe(8);
    expect(politica.maxDecisions).toBe(5);
    expect(politica.maxArtifacts).toBe(10);
    expect(politica.enabled).toBe(true);
  });

  it("um Loadout mais restrito vence: maxTokens menor e maxItems menor", () => {
    const politica = resolveContextPolicy({
      loadout: loadout({ maxItems: 3, maxTokens: 2000 }),
      settings,
    });
    expect(politica.budgetTokens).toBe(2000);
    expect(politica.maxKnowledgeItems).toBe(3);
  });

  it("um Loadout mais folgado não passa do teto global", () => {
    const politica = resolveContextPolicy({
      loadout: loadout({ maxItems: 50, maxTokens: 50_000 }),
      settings,
    });
    expect(politica.budgetTokens).toBe(6000);
    expect(politica.maxKnowledgeItems).toBe(8);
  });

  it("maxItems 0 desliga as páginas; includeDecisions falso zera as decisões", () => {
    const politica = resolveContextPolicy({
      loadout: loadout({ maxItems: 0, includeDecisions: false, includeProjectSummary: false }),
      settings,
    });
    expect(politica.maxKnowledgeItems).toBe(0);
    expect(politica.includeDecisions).toBe(false);
    expect(politica.maxDecisions).toBe(0);
    expect(politica.includeProjectSummary).toBe(false);
  });

  it("context.maxDecisions = 0 desliga as decisões mesmo com o Loadout pedindo", () => {
    const politica = resolveContextPolicy({
      loadout: loadout({ includeDecisions: true }),
      settings: { ...settings, maxDecisions: 0 },
    });
    expect(politica.includeDecisions).toBe(false);
    expect(politica.maxDecisions).toBe(0);
  });

  it("guarda a origem: o Loadout e as configurações como estavam", () => {
    const l = loadout({ maxItems: 4, maxTokens: 1000, includeParentContext: false });
    const politica = resolveContextPolicy({
      loadout: l,
      settings: { ...settings, enabled: false },
    });
    expect(politica.enabled).toBe(false);
    expect(politica.includeParentContext).toBe(false);
    expect(politica.includeDependencyContext).toBe(true);
    expect(politica.source).toEqual({
      loadout: {
        id: LOADOUT_ID,
        version: 3,
        knowledgePolicy: l.knowledgePolicy,
        contextPolicy: l.contextPolicy,
      },
      settings: { ...settings, enabled: false },
    });
    // Cópias, não referências.
    expect(politica.source.loadout.knowledgePolicy).not.toBe(l.knowledgePolicy);
  });
});
