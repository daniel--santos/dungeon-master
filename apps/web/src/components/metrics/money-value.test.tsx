import { dnd, plain, THEME_IDS, type ThemeId } from "@dungeon-master/glossary";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MoneyList, MoneyValue } from "@/components/metrics/money-value";
import { useGlossaryStore } from "@/lib/glossary";

/**
 * A regra do custo, provada na tela: um valor não medido nunca aparece como
 * zero, e a procedência acompanha o número em qualquer estado.
 *
 * Nos dois temas, porque o interruptor troca só texto: a informação de que
 * aquilo é uma estimativa não pode depender do tema estar ligado.
 */

afterEach(() => {
  cleanup();
  useGlossaryStore.setState({ theme: "dnd" });
});

function comTema(theme: ThemeId, ui: React.ReactElement) {
  useGlossaryStore.setState({ theme });
  return render(ui);
}

describe("valor de custo", () => {
  it.each(THEME_IDS)("um NOT_MEASURED mostra travessão e o rótulo, em %s", (theme) => {
    const glossary = theme === "dnd" ? dnd : plain;

    comTema(theme, <MoneyValue money={{ amount: null, currency: null, status: "NOT_MEASURED" }} />);

    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getByText(glossary["metrics.cost.status.notMeasured"])).toBeDefined();
    expect(screen.queryByText("0")).toBeNull();
  });

  it.each(THEME_IDS)("uma assinatura rateada se declara estimativa, em %s", (theme) => {
    const glossary = theme === "dnd" ? dnd : plain;

    comTema(
      theme,
      <MoneyValue money={{ amount: 20, currency: "USD", status: "ESTIMATED_SUBSCRIPTION" }} />,
    );

    expect(screen.getByText(glossary["metrics.cost.status.estimated"])).toBeDefined();
  });

  it("um PRICED continua dizendo de onde veio", () => {
    render(<MoneyValue money={{ amount: 4.2, currency: "USD", status: "PRICED" }} />);
    expect(screen.getByText(dnd["metrics.cost.status.priced"])).toBeDefined();
  });
});

describe("lista de custos", () => {
  it("sem nenhuma moeda, diz que nada foi precificado", () => {
    render(<MoneyList costs={[]} notMeasuredRuns={3} />);

    expect(screen.getByText(dnd["metrics.cost.nothingPriced"])).toBeDefined();
    expect(screen.queryByText("R$ 0,00")).toBeNull();
  });

  it("uma linha por moeda, sem somar as duas", () => {
    render(
      <MoneyList
        costs={[
          { amount: 10, currency: "USD", status: "PRICED" },
          { amount: 30, currency: "BRL", status: "PRICED" },
        ]}
        notMeasuredRuns={0}
      />,
    );

    const lista = document.querySelector("[data-cost-list]");
    expect(lista?.getAttribute("data-cost-list")).toBe("2");
    expect(document.querySelectorAll("[data-cost-currency='USD']")).toHaveLength(1);
    expect(document.querySelectorAll("[data-cost-currency='BRL']")).toHaveLength(1);
  });

  it("a contagem de não medidos aparece ao lado do total", () => {
    render(
      <MoneyList costs={[{ amount: 10, currency: "USD", status: "PRICED" }]} notMeasuredRuns={7} />,
    );

    expect(document.querySelector("[data-cost-not-measured]")?.textContent).toContain("7");
  });
});
