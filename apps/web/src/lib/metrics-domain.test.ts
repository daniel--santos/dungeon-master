import { describe, expect, it } from "vitest";

import {
  dimensionKeyLabel,
  formatDay,
  formatDuration,
  formatMoney,
  formatSeriesValue,
  seriesColor,
  seriesShape,
  SERIES_COLORS,
  SERIES_SHAPES,
} from "@/lib/metrics-domain";

/**
 * A regra da Fase 10A, provada na camada que a renderiza: ausência de medida
 * nunca vira zero.
 *
 * O contrato já garante que `amount` chega nulo num `NOT_MEASURED`; o que estes
 * testes impedem é a formatação "consertar" o nulo por conveniência — um
 * `?? 0` no caminho do dinheiro reintroduziria em uma linha o erro que a fase
 * inteira existe para não cometer.
 */

describe("dinheiro", () => {
  it("um custo não medido não vira zero", () => {
    expect(formatMoney({ amount: null, currency: null })).toBeNull();
    expect(formatMoney({ amount: null, currency: "USD" })).toBeNull();
  });

  it("formata na moeda que veio junto", () => {
    const texto = formatMoney({ amount: 12.5, currency: "USD" });
    expect(texto).not.toBeNull();
    expect(texto).toContain("12,50");
  });

  it("uma moeda malformada cai no código puro, e não derruba a tela", () => {
    // `ZZZ` não existe na ISO 4217, mas o `Intl` aceita qualquer código de três
    // letras e o formata; quem lança é um código fora desse formato. O `catch`
    // existe para este caso — um dado torto no banco não pode apagar o painel.
    expect(formatMoney({ amount: 3, currency: "ABCD" })).toBe("ABCD 3");
  });

  it("valor pequeno ganha casas decimais em vez de virar zero na tela", () => {
    const texto = formatMoney({ amount: 0.0012, currency: "USD" });
    expect(texto).toContain("0,0012");
  });
});

describe("duração", () => {
  it("nulo é ausência de medida, não zero", () => {
    expect(formatDuration(null)).toBeNull();
  });

  it("sobe de unidade conforme cresce", () => {
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(3_000)).toBe("3 s");
    expect(formatDuration(90_000)).toBe("1 min 30 s");
    expect(formatDuration(5_400_000)).toBe("1 h 30 min");
  });
});

describe("série", () => {
  it("o dia vira dia/mês", () => {
    expect(formatDay("2026-09-15")).toBe("15/09");
  });

  it("um dia fora do formato passa intacto em vez de virar NaN", () => {
    expect(formatDay("nada")).toBe("nada");
  });

  it("cada medida se formata pela unidade dela", () => {
    expect(formatSeriesValue("runs", 1200, null)).toBe("1.200");
    expect(formatSeriesValue("duration", 3_000, null)).toBe("3 s");
    expect(formatSeriesValue("cost", 2, "USD")).toContain("2,00");
  });

  it("custo sem moeda ainda mostra o número, e não um erro", () => {
    expect(formatSeriesValue("cost", 7, null)).toBe("7");
  });

  it("cor e forma dão a volta na paleta, e nunca devolvem indefinido", () => {
    expect(seriesColor(0)).toBe(SERIES_COLORS[0]);
    expect(seriesColor(SERIES_COLORS.length)).toBe(SERIES_COLORS[0]);
    expect(seriesShape(SERIES_SHAPES.length + 1)).toBe(SERIES_SHAPES[1]);
  });
});

describe("rótulo de dimensão", () => {
  it("as três dimensões de enum têm chave de glossário", () => {
    expect(dimensionKeyLabel("CREATED_BY", "USER")).toBe("run.origin.user");
    expect(dimensionKeyLabel("TASK_KIND", "BUG")).toBe("entity.task.kind.bug");
    expect(dimensionKeyLabel("EXECUTION_MODE", "HOST")).toBe("env.host");
  });

  it("as dimensões de entidade usam o nome que a API resolveu", () => {
    expect(dimensionKeyLabel("PROJECT", "qualquer-id")).toBeUndefined();
    expect(dimensionKeyLabel("MODEL", "claude-opus-5")).toBeUndefined();
  });

  it("um valor de enum que a web não conhece cai no rótulo do servidor", () => {
    expect(dimensionKeyLabel("TASK_KIND", "INVENTADO")).toBeUndefined();
  });
});
