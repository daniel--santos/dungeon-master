import type { RuleFacts } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  type ConditionedRule,
  inRuleScope,
  matchesConditions,
  selectRule,
  tieDecider,
} from "./rule-matching.js";

const FACTS: RuleFacts = {
  projectId: "P1",
  loadoutId: "L1",
  taskKind: "BUG",
  taskPriority: "HIGH",
  executionMode: "HOST",
  harnessKey: "CLAUDE_CODE",
  enforcement: "HARNESS_NATIVE",
  hasCommandTools: true,
  estimatedTokens: 1_200,
  budgetPressure: 0.5,
};

function rule(id: string, overrides: Partial<ConditionedRule> = {}): ConditionedRule {
  return { id, priority: 100, conditions: {}, enabled: true, projectId: null, ...overrides };
}

describe("matchesConditions", () => {
  it("sem condições casa com qualquer fato, inclusive nenhum", () => {
    expect(matchesConditions({}, FACTS)).toBe(true);
    expect(matchesConditions({}, {})).toBe(true);
  });

  it("um valor ou uma lista: a lista é 'qualquer um destes'", () => {
    expect(matchesConditions({ taskKind: "BUG" }, FACTS)).toBe(true);
    expect(matchesConditions({ taskKind: "CHORE" }, FACTS)).toBe(false);
    expect(matchesConditions({ taskKind: ["CHORE", "BUG"] }, FACTS)).toBe(true);
    expect(matchesConditions({ harnessKey: ["PI", "CODEX"] }, FACTS)).toBe(false);
  });

  it("é uma conjunção: uma condição falsa derruba a regra", () => {
    expect(matchesConditions({ taskKind: "BUG", executionMode: "DOCKER" }, FACTS)).toBe(false);
    expect(matchesConditions({ taskKind: "BUG", executionMode: "HOST" }, FACTS)).toBe(true);
  });

  it("fail-closed: condição sobre fato não medido não casa", () => {
    expect(matchesConditions({ stepType: "agent" }, FACTS)).toBe(false);
    expect(matchesConditions({ maxEstimatedTokens: 10_000 }, { ...FACTS, estimatedTokens: undefined })).toBe(
      false,
    );
    expect(matchesConditions({ minBudgetPressure: 0 }, { ...FACTS, budgetPressure: undefined })).toBe(
      false,
    );
    expect(matchesConditions({ hasCommandTools: false }, {})).toBe(false);
  });

  it("maxEstimatedTokens é um teto inclusivo; minBudgetPressure um piso inclusivo", () => {
    expect(matchesConditions({ maxEstimatedTokens: 1_200 }, FACTS)).toBe(true);
    expect(matchesConditions({ maxEstimatedTokens: 1_199 }, FACTS)).toBe(false);
    expect(matchesConditions({ minBudgetPressure: 0.5 }, FACTS)).toBe(true);
    expect(matchesConditions({ minBudgetPressure: 0.8 }, FACTS)).toBe(false);
  });

  it("hasCommandTools compara o booleano", () => {
    expect(matchesConditions({ hasCommandTools: true }, FACTS)).toBe(true);
    expect(matchesConditions({ hasCommandTools: false }, FACTS)).toBe(false);
  });
});

describe("inRuleScope", () => {
  it("global vale sempre; a do Project só nele; sem Project nos fatos, só as globais", () => {
    expect(inRuleScope({ projectId: null }, FACTS)).toBe(true);
    expect(inRuleScope({ projectId: "P1" }, FACTS)).toBe(true);
    expect(inRuleScope({ projectId: "P2" }, FACTS)).toBe(false);
    expect(inRuleScope({ projectId: "P1" }, {})).toBe(false);
    expect(inRuleScope({ projectId: null }, {})).toBe(true);
  });
});

describe("selectRule", () => {
  it("sem regra que case é NONE", () => {
    expect(selectRule([rule("a", { conditions: { taskKind: "CHORE" } })], FACTS)).toEqual({
      outcome: "NONE",
    });
    expect(selectRule([], FACTS)).toEqual({ outcome: "NONE" });
  });

  it("a de maior prioridade que casa decide, independente da ordem", () => {
    const baixa = rule("baixa", { priority: 10 });
    const alta = rule("alta", { priority: 500 });
    const naoCasa = rule("nao-casa", { priority: 900, conditions: { executionMode: "DOCKER" } });
    expect(selectRule([baixa, naoCasa, alta], FACTS)).toEqual({ outcome: "MATCHED", rule: alta });
    expect(selectRule([alta, baixa], FACTS)).toEqual({ outcome: "MATCHED", rule: alta });
  });

  it("regra desligada e regra de outro Project não participam", () => {
    const desligada = rule("desligada", { priority: 900, enabled: false });
    const outroProject = rule("outro", { priority: 900, projectId: "P2" });
    const valida = rule("valida", { priority: 1 });
    expect(selectRule([desligada, outroProject, valida], FACTS)).toEqual({
      outcome: "MATCHED",
      rule: valida,
    });
  });

  it("empate na prioridade máxima é TIE, com as regras em ordem de id", () => {
    const b = rule("b", { priority: 100 });
    const a = rule("a", { priority: 100 });
    const menor = rule("c", { priority: 50 });
    const escolha = selectRule([b, menor, a], FACTS);
    expect(escolha.outcome).toBe("TIE");
    if (escolha.outcome !== "TIE") return;
    expect(escolha.priority).toBe(100);
    expect(escolha.rules.map((r) => r.id)).toEqual(["a", "b"]);
    expect(tieDecider(escolha.rules)).toBe("TIE:a,b");
  });
});
