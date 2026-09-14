import type { RuleFacts } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import { routeTarget, type RoutingRuleLike } from "./routing.js";

const FACTS: RuleFacts = { projectId: "P1", taskKind: "BUG", budgetPressure: 0.2 };

const MODELOS: Record<string, { id: string; name: string }> = {
  M_CARO: { id: "M_CARO", name: "opus" },
  M_BARATO: { id: "M_BARATO", name: "haiku" },
};

function rule(id: string, overrides: Partial<RoutingRuleLike> = {}): RoutingRuleLike {
  return {
    id,
    name: `regra ${id}`,
    kind: "MODEL",
    projectId: null,
    priority: 100,
    conditions: {},
    targetId: "M_CARO",
    fallbackIds: [],
    enabled: true,
    ...overrides,
  };
}

const resolve = (targetId: string) => {
  const model = MODELOS[targetId];
  return model === undefined
    ? { ok: false as const, reason: "O Model não pertence ao Harness do Loadout." }
    : { ok: true as const, candidate: model };
};

const PADRAO = { id: "M_PADRAO", name: "sonnet" };

describe("routeTarget", () => {
  it("sem regra que case, o padrão do sistema decide", () => {
    const decision = routeTarget({
      kind: "MODEL",
      rules: [rule("bugs", { conditions: { taskKind: "CHORE" } })],
      facts: FACTS,
      resolve,
      fallback: PADRAO,
      fallbackReason: "Vale o Model padrão do Harness.",
    });
    expect(decision).toMatchObject({
      kind: "MODEL",
      selectedId: "M_PADRAO",
      selectedName: "sonnet",
      ruleId: null,
      decidedBy: "DEFAULT",
      attempts: [],
    });
    expect(decision.reason).toContain("Vale o Model padrão");
  });

  it("a regra que casa escolhe o alvo preferido", () => {
    const decision = routeTarget({
      kind: "MODEL",
      rules: [rule("bugs", { conditions: { taskKind: "BUG" } })],
      facts: FACTS,
      resolve,
      fallback: PADRAO,
      fallbackReason: "",
    });
    expect(decision).toMatchObject({
      selectedId: "M_CARO",
      selectedName: "opus",
      ruleId: "bugs",
      decidedBy: "ROUTING:bugs",
    });
    expect(decision.attempts).toEqual([
      { targetId: "M_CARO", accepted: true, reason: "Alvo válido neste contexto." },
    ]);
  });

  it("alvo inválido cai no fallback seguinte, e a resposta conta as tentativas", () => {
    const decision = routeTarget({
      kind: "MODEL",
      rules: [rule("bugs", { targetId: "M_SUMIDO", fallbackIds: ["M_OUTRO", "M_BARATO"] })],
      facts: FACTS,
      resolve,
      fallback: PADRAO,
      fallbackReason: "",
    });
    expect(decision.selectedId).toBe("M_BARATO");
    expect(decision.attempts.map((a) => a.accepted)).toEqual([false, false, true]);
    expect(decision.reason).toContain("fallback 2");
  });

  it("sem alvo válido, o padrão decide e o motivo diz que a regra casou", () => {
    const decision = routeTarget({
      kind: "MODEL",
      rules: [rule("bugs", { targetId: "M_SUMIDO" })],
      facts: FACTS,
      resolve,
      fallback: null,
      fallbackReason: "Não há Model padrão.",
    });
    expect(decision).toMatchObject({ selectedId: null, selectedName: null, decidedBy: "DEFAULT" });
    expect(decision.reason).toContain("nenhum dos 1 alvo(s) serviu");
    expect(decision.attempts).toHaveLength(1);
  });

  it("pressão de orçamento escolhe o Model barato só quando a janela aperta", () => {
    const rules = [
      rule("caro", { priority: 10, targetId: "M_CARO" }),
      rule("barato", { priority: 500, targetId: "M_BARATO", conditions: { minBudgetPressure: 0.8 } }),
    ];
    const folgado = routeTarget({ kind: "MODEL", rules, facts: FACTS, resolve, fallback: PADRAO, fallbackReason: "" });
    expect(folgado.selectedId).toBe("M_CARO");
    const apertado = routeTarget({
      kind: "MODEL",
      rules,
      facts: { ...FACTS, budgetPressure: 0.85 },
      resolve,
      fallback: PADRAO,
      fallbackReason: "",
    });
    expect(apertado.selectedId).toBe("M_BARATO");
    expect(apertado.decidedBy).toBe("ROUTING:barato");
  });

  it("empate é o padrão, com as regras nomeadas; regras de outra espécie não entram", () => {
    const decision = routeTarget({
      kind: "MODEL",
      rules: [rule("a"), rule("b"), rule("w", { kind: "WORKFLOW", priority: 999 })],
      facts: FACTS,
      resolve,
      fallback: PADRAO,
      fallbackReason: "",
    });
    expect(decision).toMatchObject({ selectedId: "M_PADRAO", decidedBy: "TIE:a,b" });
  });
});
