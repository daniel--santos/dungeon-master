import type { BudgetLimits } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  allowedLimitKeys,
  type BudgetConsumption,
  budgetPressure,
  budgetWindowBounds,
  checkBudgetForNewRun,
  evaluateBudget,
  runTokenUsage,
} from "./budgets.js";

const SEM_TETO: BudgetLimits = {
  maxTokens: null,
  maxRuns: null,
  maxWallClockMs: null,
  maxConcurrentRuns: null,
};

function consumo(overrides: Partial<BudgetConsumption> = {}): BudgetConsumption {
  return {
    tokens: 0,
    tokensKnown: true,
    runsWithoutUsage: 0,
    runs: 0,
    wallClockMs: 0,
    concurrentRuns: 0,
    ...overrides,
  };
}

describe("budgetWindowBounds", () => {
  it("DAY é a meia-noite UTC de hoje até a de amanhã", () => {
    const bounds = budgetWindowBounds("DAY", new Date("2026-09-14T15:30:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("WEEK começa na segunda-feira ISO, inclusive num domingo", () => {
    // 2026-09-14 é segunda; 2026-09-20 é domingo.
    const segunda = budgetWindowBounds("WEEK", new Date("2026-09-14T00:00:00.000Z"));
    expect(segunda.start.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(segunda.end.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    const domingo = budgetWindowBounds("WEEK", new Date("2026-09-20T23:59:59.000Z"));
    expect(domingo.start.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(domingo.end.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("MONTH vira o ano em dezembro", () => {
    const bounds = budgetWindowBounds("MONTH", new Date("2026-12-31T10:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("runTokenUsage", () => {
  it("totalTokens vence; senão soma o que houver; sem número é desconhecido", () => {
    expect(runTokenUsage({ totalTokens: 500, inputTokens: 1 })).toBe(500);
    expect(runTokenUsage({ inputTokens: 100, outputTokens: 50 })).toBe(150);
    expect(
      runTokenUsage({ inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 20, cacheCreationInputTokens: 1 }),
    ).toBe(36);
    expect(runTokenUsage({})).toBeNull();
    expect(runTokenUsage(null)).toBeNull();
    expect(runTokenUsage(undefined)).toBeNull();
    expect(runTokenUsage({ inputTokens: "muitos" })).toBeNull();
    expect(runTokenUsage({ inputTokens: -1 })).toBeNull();
  });
});

describe("evaluateBudget", () => {
  it("sem tetos a pressão é zero e nada estoura", () => {
    expect(evaluateBudget(SEM_TETO, consumo({ tokens: 1_000_000, runs: 99 }))).toEqual({
      pressure: 0,
      exceeded: [],
    });
  });

  it("a pressão é a maior razão; no teto conta como atingido", () => {
    const limits: BudgetLimits = { ...SEM_TETO, maxTokens: 1_000, maxRuns: 10 };
    expect(evaluateBudget(limits, consumo({ tokens: 800, runs: 2 }))).toEqual({
      pressure: 0.8,
      exceeded: [],
    });
    expect(evaluateBudget(limits, consumo({ tokens: 1_000, runs: 12 }))).toEqual({
      pressure: 1.2,
      exceeded: ["maxRuns", "maxTokens"],
    });
  });

  it("budgetPressure é o máximo entre orçamentos, zero sem nenhum", () => {
    expect(budgetPressure([])).toBe(0);
    expect(budgetPressure([{ pressure: 0.3 }, { pressure: 0.9 }, { pressure: 0.1 }])).toBe(0.9);
  });
});

describe("checkBudgetForNewRun", () => {
  const budget = (limits: Partial<BudgetLimits>, action: "BLOCK" | "WARN" = "BLOCK") => ({
    id: "B1",
    name: "diário",
    window: "DAY" as const,
    limits: { ...SEM_TETO, ...limits },
    action,
  });

  it("maxRuns conta o Run pedido: com teto 2, o terceiro estoura", () => {
    expect(checkBudgetForNewRun({ budget: budget({ maxRuns: 2 }), consumption: consumo({ runs: 1 }) })).toEqual(
      { admit: true, breach: null },
    );
    const terceiro = checkBudgetForNewRun({
      budget: budget({ maxRuns: 2 }),
      consumption: consumo({ runs: 2 }),
    });
    expect(terceiro.admit).toBe(false);
    if (terceiro.admit) return;
    expect(terceiro.breach).toMatchObject({ limit: "maxRuns", limitValue: 2, current: 3 });
    expect(terceiro.breach.reason).toContain("maxRuns");
  });

  it("maxConcurrentRuns conta o Run pedido; maxTokens e maxWallClockMs olham o já consumido", () => {
    expect(
      checkBudgetForNewRun({
        budget: budget({ maxConcurrentRuns: 1 }),
        consumption: consumo({ concurrentRuns: 1 }),
      }).admit,
    ).toBe(false);
    expect(
      checkBudgetForNewRun({ budget: budget({ maxTokens: 1_000 }), consumption: consumo({ tokens: 999 }) })
        .admit,
    ).toBe(true);
    expect(
      checkBudgetForNewRun({ budget: budget({ maxTokens: 1_000 }), consumption: consumo({ tokens: 1_000 }) })
        .admit,
    ).toBe(false);
    expect(
      checkBudgetForNewRun({
        budget: budget({ maxWallClockMs: 60_000 }),
        consumption: consumo({ wallClockMs: 60_000 }),
      }).admit,
    ).toBe(false);
  });

  it("WARN admite e devolve o teto atingido", () => {
    const check = checkBudgetForNewRun({
      budget: budget({ maxRuns: 1 }, "WARN"),
      consumption: consumo({ runs: 1 }),
    });
    expect(check.admit).toBe(true);
    expect(check.breach).toMatchObject({ limit: "maxRuns", current: 2 });
  });

  it("fail-closed: teto de tokens com consumo desconhecido não libera, e diz quantos Runs faltaram", () => {
    const check = checkBudgetForNewRun({
      budget: budget({ maxTokens: 1_000_000 }),
      consumption: consumo({ tokens: 10, tokensKnown: false, runsWithoutUsage: 2 }),
    });
    expect(check.admit).toBe(false);
    if (check.admit) return;
    expect(check.breach).toMatchObject({ limit: null, limitValue: 1_000_000, current: 10 });
    expect(check.breach.reason).toContain("2 Run(s)");

    // Sem teto de tokens, consumo desconhecido não importa.
    expect(
      checkBudgetForNewRun({
        budget: budget({ maxRuns: 10 }),
        consumption: consumo({ tokensKnown: false, runsWithoutUsage: 2 }),
      }).admit,
    ).toBe(true);
  });

  it("PER_RUN não tem o que medir na criação e sempre admite", () => {
    expect(
      checkBudgetForNewRun({
        budget: { ...budget({ maxTokens: 1 }), window: "PER_RUN" },
        consumption: consumo({ tokens: 999 }),
      }),
    ).toEqual({ admit: true, breach: null });
    expect(allowedLimitKeys("PER_RUN")).toEqual(["maxTokens", "maxWallClockMs"]);
    expect(allowedLimitKeys("DAY")).toHaveLength(4);
  });
});
