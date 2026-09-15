import { describe, expect, it } from "vitest";

import { NOT_MEASURED, type RunCost } from "./cost.js";
import { dimensionsOf } from "./dimensions.js";
import { UNKNOWN_TOKENS, type RunMetricFacts } from "./facts.js";
import { EMPTY_DAILY_MEASURES, rollupDaily, sumMeasures } from "./rollup.js";

function run(overrides: Partial<RunMetricFacts> = {}): RunMetricFacts {
  return {
    runId: "01996d00-0000-7000-8000-000000000001",
    projectId: "01996d00-0000-7000-8000-0000000000a1",
    taskKind: "FEATURE",
    harnessKey: "CLAUDE_CODE",
    modelKey: "sonnet",
    providerId: "01996d00-0000-7000-8000-0000000000b1",
    loadoutId: "01996d00-0000-7000-8000-0000000000c1",
    executionMode: "HOST",
    createdBy: "USER",
    status: "SUCCEEDED",
    day: "2026-09-15",
    durationMs: 1_000,
    tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1 },
    toolCalls: 3,
    ...overrides,
  };
}

const precificado: RunCost = { status: "PRICED", currency: "USD", amount: 0.5 };

describe("dimensionsOf", () => {
  it("um Run completo alimenta as nove dimensões", () => {
    expect(
      dimensionsOf(run())
        .map((entrada) => entrada.dimension)
        .sort(),
    ).toEqual([
      "ALL",
      "CREATED_BY",
      "EXECUTION_MODE",
      "HARNESS",
      "LOADOUT",
      "MODEL",
      "PROJECT",
      "PROVIDER",
      "TASK_KIND",
    ]);
  });

  it("uma dimensão sem valor não vira linha, em vez de virar uma chave inventada", () => {
    const sem = dimensionsOf(run({ projectId: null, modelKey: null, providerId: null }));
    expect(sem.map((entrada) => entrada.dimension).sort()).toEqual([
      "ALL",
      "CREATED_BY",
      "EXECUTION_MODE",
      "HARNESS",
      "LOADOUT",
      "TASK_KIND",
    ]);
  });
});

describe("rollupDaily", () => {
  it("soma por dimensão e mantém `ALL` como total verdadeiro", () => {
    const baldes = rollupDaily([
      { facts: run({ runId: "a" }), cost: precificado },
      { facts: run({ runId: "b", projectId: null, status: "FAILED" }), cost: NOT_MEASURED },
    ]);

    const todos = baldes.find((balde) => balde.dimension === "ALL");
    expect(todos?.measures.runsTotal).toBe(2);
    expect(todos?.measures.runsSucceeded).toBe(1);
    expect(todos?.measures.runsFailed).toBe(1);
    expect(todos?.measures.pricedRuns).toBe(1);
    expect(todos?.measures.unpricedRuns).toBe(1);
    expect(todos?.measures.costByCurrency).toEqual({ USD: 0.5 });

    const porProject = baldes.filter((balde) => balde.dimension === "PROJECT");
    expect(porProject).toHaveLength(1);
    expect(porProject[0]?.measures.runsTotal).toBe(1);
  });

  it("tokens desconhecidos não entram como zero no denominador", () => {
    const baldes = rollupDaily([
      { facts: run({ runId: "a" }), cost: precificado },
      { facts: run({ runId: "b", tokens: UNKNOWN_TOKENS }), cost: NOT_MEASURED },
    ]);
    const todos = baldes.find((balde) => balde.dimension === "ALL");
    expect(todos?.measures.runsTotal).toBe(2);
    expect(todos?.measures.tokensKnownRuns).toBe(1);
    expect(todos?.measures.inputTokens).toBe(100);
  });

  it("a duração máxima é a maior, e a contagem de medidos ignora quem não começou", () => {
    const baldes = rollupDaily([
      { facts: run({ runId: "a", durationMs: 1_000 }), cost: NOT_MEASURED },
      { facts: run({ runId: "b", durationMs: 9_000 }), cost: NOT_MEASURED },
      { facts: run({ runId: "c", durationMs: null }), cost: NOT_MEASURED },
    ]);
    const todos = baldes.find((balde) => balde.dimension === "ALL");
    expect(todos?.measures.durationMsMax).toBe(9_000);
    expect(todos?.measures.durationMsTotal).toBe(10_000);
    expect(todos?.measures.durationRuns).toBe(2);
  });

  it("a ordem da saída é estável, para o rebuild poder ser comparado linha a linha", () => {
    const entradas = [
      { facts: run({ runId: "a", day: "2026-09-16" }), cost: NOT_MEASURED },
      { facts: run({ runId: "b", day: "2026-09-15" }), cost: NOT_MEASURED },
    ];
    const primeiro = rollupDaily(entradas).map((balde) => [
      balde.day,
      balde.dimension,
      balde.dimensionKey,
    ]);
    const segundo = rollupDaily([...entradas].reverse()).map((balde) => [
      balde.day,
      balde.dimension,
      balde.dimensionKey,
    ]);
    expect(primeiro).toEqual(segundo);
    expect(primeiro[0]?.[0]).toBe("2026-09-15");
  });
});

describe("sumMeasures", () => {
  it("soma dias e preserva o máximo em vez de somá-lo", () => {
    const baldes = rollupDaily([
      { facts: run({ runId: "a", day: "2026-09-15", durationMs: 5_000 }), cost: precificado },
      { facts: run({ runId: "b", day: "2026-09-16", durationMs: 2_000 }), cost: precificado },
    ]).filter((balde) => balde.dimension === "ALL");

    const total = sumMeasures(baldes.map((balde) => balde.measures));
    expect(total.runsTotal).toBe(2);
    expect(total.durationMsMax).toBe(5_000);
    expect(total.durationMsTotal).toBe(7_000);
    expect(total.costByCurrency).toEqual({ USD: 1 });
  });

  it("somar nada devolve as medidas vazias", () => {
    expect(sumMeasures([])).toEqual(EMPTY_DAILY_MEASURES);
  });
});
