import { describe, expect, it } from "vitest";

import { shouldRegenerateSummary, type SummaryTriggerFacts } from "./summary-trigger.js";

const base: SummaryTriggerFacts = {
  requested: false,
  hasSummary: true,
  summaryHasContent: true,
  activeItemCount: 3,
  promotedSinceSummary: 1,
  coveredItemsChanged: 0,
};

describe("shouldRegenerateSummary", () => {
  it("nunca dispara sem item ativo, nem com pedido explícito", () => {
    expect(shouldRegenerateSummary({ ...base, activeItemCount: 0, requested: true })).toEqual({
      should: false,
      reason: "",
    });
  });

  it("P1: o pedido explícito vence tudo", () => {
    expect(shouldRegenerateSummary({ ...base, requested: true }).reason).toBe("pedido explícito");
  });

  it("P2: partida a frio, itens ativos e nenhum resumo", () => {
    expect(
      shouldRegenerateSummary({ ...base, hasSummary: false, summaryHasContent: false }),
    ).toEqual({
      should: true,
      reason: "partida a frio: há itens ativos e nenhum resumo",
    });
  });

  it("P3: recuperação de um resumo sem corpo", () => {
    expect(shouldRegenerateSummary({ ...base, summaryHasContent: false }).reason).toContain(
      "recuperação",
    );
  });

  it("P4: itens cobertos que mudaram na revisão", () => {
    expect(shouldRegenerateSummary({ ...base, coveredItemsChanged: 2 }).reason).toBe(
      "cobertura desatualizada: 2 item(ns) cobertos mudaram na revisão",
    );
  });

  it("P5: o limiar de itens ativos novos, com o padrão 5 e com o valor configurado", () => {
    expect(shouldRegenerateSummary({ ...base, promotedSinceSummary: 4 }).should).toBe(false);
    expect(shouldRegenerateSummary({ ...base, promotedSinceSummary: 5 })).toEqual({
      should: true,
      reason: "limiar: 5 >= 5 itens ativos novos",
    });
    expect(
      shouldRegenerateSummary({ ...base, promotedSinceSummary: 2 }, { everyNItems: 2 }).should,
    ).toBe(true);
  });
});
