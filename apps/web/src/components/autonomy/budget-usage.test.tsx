import { dnd } from "@dungeon-master/glossary";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetUsagePanel, UsageBars } from "@/components/autonomy/budget-usage";
import { api } from "@/lib/api";
import { BUDGET, BUDGET_USAGE, BUDGET_USAGE_UNKNOWN } from "@/test/autonomy-fixtures";
import { ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * O painel de consumo de um Tesouro (Fase 9C): uma barra por teto definido,
 * com a razão consumo/teto, a pressão colorida, o teto atingido marcado e a
 * incerteza dita quando algum Run terminou sem reportar tokens.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

afterEach(() => {
  cleanup();
});

describe("as barras de consumo", () => {
  it("desenha uma barra por teto definido, com a razão sobre o limite", () => {
    render(
      <UsageBars
        exceeded={[]}
        limits={BUDGET.limits}
        pressure={0.85}
        runsWithoutUsage={0}
        tokensKnown
        values={{ maxTokens: 85_000, maxRuns: 4, maxWallClockMs: 0, maxConcurrentRuns: 1 }}
      />,
    );

    // Três tetos definidos (tempo é nulo), três barras.
    expect(document.querySelectorAll("[data-budget-limit]")).toHaveLength(3);
    expect(document.querySelector('[data-budget-limit="maxWallClockMs"]')).toBeNull();

    const tokens = document.querySelector('[data-budget-limit="maxTokens"]') as HTMLElement;
    expect(tokens.getAttribute("data-budget-limit-ratio")).toBe("0.85");
    expect(tokens.textContent).toContain(dnd["budget.limit.maxTokens"]);
    expect((tokens.querySelector("[data-budget-bar]") as HTMLElement).style.width).toBe("85%");

    const runs = document.querySelector('[data-budget-limit="maxRuns"]') as HTMLElement;
    expect(runs.getAttribute("data-budget-limit-ratio")).toBe("0.40");
    expect(runs.textContent).toContain("4 / 10");

    expect(document.querySelector("[data-budget-pressure]")?.textContent).toContain("85%");
    expect(document.querySelector("[data-budget-tokens-unknown]")).toBeNull();
    expect(document.querySelector("[data-budget-exceeded]")).toBeNull();
  });

  it("com tokensKnown falso diz consumo incerto e quantos Runs ficaram sem medida", () => {
    render(
      <UsageBars
        exceeded={["maxRuns"]}
        limits={BUDGET.limits}
        pressure={1}
        runsWithoutUsage={2}
        tokensKnown={false}
        values={{ maxTokens: 20_000, maxRuns: 10, maxWallClockMs: 0, maxConcurrentRuns: 1 }}
      />,
    );

    const unknown = document.querySelector("[data-budget-tokens-unknown]") as HTMLElement;
    expect(unknown.getAttribute("data-budget-tokens-unknown")).toBe("2");
    expect(unknown.textContent).toContain(dnd["budget.usage.unknown"]);
    expect(unknown.getAttribute("title")).toContain("2 Expedições terminaram sem reportar tokens");

    // O teto atingido é marcado, e a barra dele é a de destruição.
    expect(document.querySelector("[data-budget-exceeded]")?.getAttribute("data-budget-exceeded")).toBe(
      "maxRuns",
    );
    const runs = document.querySelector('[data-budget-limit="maxRuns"]') as HTMLElement;
    expect(runs.getAttribute("data-budget-limit-ratio")).toBe("1.00");
    expect((runs.querySelector("[data-budget-bar]") as HTMLElement).style.backgroundColor).toBe(
      "var(--destructive)",
    );
    // A barra da razão nunca passa de 100%, mesmo além do teto.
    expect((runs.querySelector("[data-budget-bar]") as HTMLElement).style.width).toBe("100%");
  });
});

describe("o painel do Tesouro", () => {
  it("lê GET /budgets/{id}/usage e mostra a janela", async () => {
    client.GET.mockResolvedValue(ok(BUDGET_USAGE) as never);

    renderInRouter(<BudgetUsagePanel budget={BUDGET} />);

    await waitFor(() => {
      expect(client.GET).toHaveBeenCalledWith("/api/v1/budgets/{id}/usage", {
        params: { path: { id: BUDGET.id } },
      });
    });
    const panel = await waitFor(() => {
      const element = document.querySelector("[data-budget-usage]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(panel.textContent).toContain(dnd["budget.usage.window"]);
    expect(panel.querySelector("[data-budget-tokens-unknown]")).toBeNull();
  });

  it("um consumo incerto chega do servidor com o número de Runs sem medida", async () => {
    client.GET.mockResolvedValue(ok(BUDGET_USAGE_UNKNOWN) as never);

    renderInRouter(<BudgetUsagePanel budget={BUDGET} />);

    await waitFor(() => {
      expect(
        document.querySelector("[data-budget-tokens-unknown]")?.getAttribute("data-budget-tokens-unknown"),
      ).toBe("2");
    });
  });
});
