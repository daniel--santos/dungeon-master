import { describe, expect, it } from "vitest";

import { addDays, daysEndingAt, monthBounds, monthOf, utcDay } from "./day.js";
import { buildSeries, windowRange } from "./series.js";
import { average, percentile, successRate } from "./stats.js";
import { countToolCallsByServer, NATIVE_TOOL_SERVER, toolServerOf } from "./tool-calls.js";

describe("dias em UTC", () => {
  it("o dia vem do instante em UTC, e não do fuso do processo", () => {
    // 23:30 de 15/09 em UTC ainda é dia 15, mesmo num processo em UTC-3.
    expect(utcDay(new Date("2026-09-15T23:30:00.000Z"))).toBe("2026-09-15");
    expect(utcDay(new Date("2026-09-16T00:30:00.000Z"))).toBe("2026-09-16");
  });

  it("anda por cima da virada de mês e de ano", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("o mês civil traz o primeiro e o último dia", () => {
    expect(monthOf("2026-09-15")).toBe("2026-09");
    expect(monthBounds("2026-09-15")).toEqual({ first: "2026-09-01", last: "2026-09-30" });
    expect(monthBounds("2024-02-10").last).toBe("2024-02-29");
  });

  it("a janela inclui os dois extremos", () => {
    expect(daysEndingAt("2026-09-15", 3)).toEqual(["2026-09-13", "2026-09-14", "2026-09-15"]);
  });

  it("uma janela de 7 dias tem 7 pontos, e o último é hoje", () => {
    const range = windowRange("7d", "2026-09-15");
    expect(range.days).toHaveLength(7);
    expect(range.from).toBe("2026-09-09");
    expect(range.to).toBe("2026-09-15");
  });
});

describe("buildSeries", () => {
  it("preenche com zero os dias sem dado, para a série ser contínua", () => {
    const range = windowRange("7d", "2026-09-15");
    const valores = new Map([["ALL", new Map([["2026-09-15", 4]])]]);

    const [linha] = buildSeries({ days: range.days, values: valores });
    expect(linha?.points).toHaveLength(7);
    expect(linha?.points.map((ponto) => ponto.value)).toEqual([0, 0, 0, 0, 0, 0, 4]);
    expect(linha?.total).toBe(4);
  });

  it("ordena da maior soma para a menor, com desempate estável pela chave", () => {
    const days = ["2026-09-15"];
    const valores = new Map([
      ["b", new Map([["2026-09-15", 1]])],
      ["a", new Map([["2026-09-15", 1]])],
      ["c", new Map([["2026-09-15", 9]])],
    ]);
    expect(buildSeries({ days, values: valores }).map((linha) => linha.key)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("estatísticas", () => {
  it("o p95 é um valor que existiu na amostra", () => {
    const amostra = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(amostra, 0.95)).toBe(10);
    expect(percentile(amostra, 0.5)).toBe(5);
  });

  it("sem amostra o resultado é nulo, e não zero", () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(average(0, 0)).toBeNull();
    expect(successRate(0, 0)).toBeNull();
  });

  it("a taxa de sucesso é uma fração de zero a um", () => {
    expect(successRate(3, 4)).toBe(0.75);
  });
});

describe("chamadas de ferramenta por servidor", () => {
  it("tira o servidor do prefixo `mcp__<servidor>__`", () => {
    expect(toolServerOf("mcp__knowledge__search_knowledge")).toBe("knowledge");
    expect(toolServerOf("mcp__orchestration__delegate")).toBe("orchestration");
  });

  it("o que não tem o prefixo é nativo do harness", () => {
    expect(toolServerOf("Bash")).toBe(NATIVE_TOOL_SERVER);
    expect(toolServerOf("mcp__sem_separador")).toBe(NATIVE_TOOL_SERVER);
  });

  it("conta por servidor, do mais chamado para o menos", () => {
    expect(
      countToolCallsByServer([
        "Bash",
        "mcp__knowledge__search_knowledge",
        "Read",
        "mcp__knowledge__get_item",
        "Write",
      ]),
    ).toEqual([
      { server: "native", calls: 3 },
      { server: "knowledge", calls: 2 },
    ]);
  });
});
