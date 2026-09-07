import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Term, useGlossary, useGlossaryStore } from "@/lib/glossary";

function Probe() {
  const { theme, t } = useGlossary();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="nav">{t("nav.tasks")}</span>
      <span data-testid="term">
        <Term k="entity.task" />
      </span>
    </div>
  );
}

function text(id: string): string | null {
  return screen.getByTestId(id).textContent;
}

afterEach(() => {
  cleanup();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

describe("store de glossário", () => {
  it("nasce no tema padrão, que é o interruptor ligado", () => {
    expect(useGlossaryStore.getState().theme).toBe(DEFAULT_THEME);
    expect(DEFAULT_THEME).toBe("dnd");
  });

  it("trocar o tema troca o label sem remontar a árvore", () => {
    render(<Probe />);

    expect(text("theme")).toBe("dnd");
    expect(text("nav")).toBe(dnd["nav.tasks"]);
    expect(text("term")).toBe(dnd["entity.task"]);

    const rendered = screen.getByTestId("nav");

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });

    expect(text("theme")).toBe("plain");
    expect(text("nav")).toBe(plain["nav.tasks"]);
    expect(text("term")).toBe(plain["entity.task"]);
    // O mesmo nó do DOM: só o texto mudou, não o layout.
    expect(screen.getByTestId("nav")).toBe(rendered);
  });

  it("os dois temas dizem coisas diferentes na mesma chave", () => {
    expect(dnd["nav.tasks"]).not.toBe(plain["nav.tasks"]);
  });

  it("gravar o mesmo tema não cria estado novo", () => {
    const before = useGlossaryStore.getState();
    act(() => {
      before.setTheme(DEFAULT_THEME);
    });
    expect(useGlossaryStore.getState()).toBe(before);
  });
});

describe("format", () => {
  it("interpola placeholders no label resolvido", () => {
    function Formatted() {
      const { format } = useGlossary();
      return <span data-testid="fmt">{format("Guardião de {project}", { project: "DM" })}</span>;
    }

    render(<Formatted />);
    expect(text("fmt")).toBe("Guardião de DM");
  });
});
