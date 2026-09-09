import { describe, expect, it } from "vitest";

import type { LoadoutDefinitionRecord } from "@/lib/api-types";
import { loadoutChanges } from "@/lib/loadout-changes";

const BASE: LoadoutDefinitionRecord = {
  name: "Forja",
  agentId: "agent-1",
  harnessId: "harness-1",
  modelId: null,
  executionProfileId: "profile-1",
  skillRefs: [
    { skillId: "skill-1", pinnedVersion: null },
    { skillId: "skill-2", pinnedVersion: 2 },
  ],
  toolIds: ["tool-1"],
  mcpServerIds: ["mcp-1"],
  knowledgePolicy: { includeProjectSummary: true, includeDecisions: true, maxItems: 20 },
  contextPolicy: { includeParentContext: true, includeDependencyContext: true, maxTokens: 0 },
  isDefault: false,
};

describe("o que mudou entre duas versões do Loadout", () => {
  it("nada mudou é uma lista vazia", () => {
    expect(loadoutChanges(BASE, { ...BASE })).toEqual([]);
  });

  it("aponta o campo, a Skill que entrou, a que saiu e o pin que mudou", () => {
    const after: LoadoutDefinitionRecord = {
      ...BASE,
      harnessId: "harness-2",
      modelId: "model-1",
      skillRefs: [
        { skillId: "skill-1", pinnedVersion: 3 },
        { skillId: "skill-3", pinnedVersion: null },
      ],
      toolIds: [],
      mcpServerIds: ["mcp-1", "mcp-2"],
      isDefault: true,
    };

    expect(loadoutChanges(BASE, after)).toEqual([
      { kind: "field", field: "harness", from: "harness-1", to: "harness-2" },
      { kind: "field", field: "model", from: null, to: "model-1" },
      { kind: "added", collection: "skills", ids: ["skill-3"] },
      { kind: "removed", collection: "skills", ids: ["skill-2"] },
      { kind: "pin", skillId: "skill-1", from: null, to: 3 },
      { kind: "removed", collection: "tools", ids: ["tool-1"] },
      { kind: "added", collection: "mcpServers", ids: ["mcp-2"] },
      { kind: "default", on: true },
    ]);
  });

  it("uma política diferente é um fato só, sem listar cada campo", () => {
    const after: LoadoutDefinitionRecord = {
      ...BASE,
      knowledgePolicy: { ...BASE.knowledgePolicy, maxItems: 5 },
    };
    expect(loadoutChanges(BASE, after)).toEqual([{ kind: "policy" }]);
  });
});
