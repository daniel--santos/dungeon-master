import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AchievementCard } from "@/components/hall/achievement-card";
import type { AchievementCard as Card } from "@/lib/achievements";
import { useGlossaryStore } from "@/lib/glossary";

const CARD: Card = {
  key: "first_expedition",
  origin: "CATALOG",
  rarity: "COMMON",
  state: "LOCKED",
  icon: "flag",
  name: { theme: "Primeira Expedição", plain: "Primeira execução" },
  description: {
    theme: "Vencer a primeira Expedição. Uma.",
    plain: "Concluir a primeira execução com sucesso.",
  },
  flavor: "O Dungeon Master conferiu duas vezes.",
  tierRarities: undefined,
};

const HIDDEN: Card = {
  key: "__templates__",
  origin: "TEMPLATE",
  rarity: null,
  state: "HIDDEN",
  icon: "help-circle",
  name: null,
  description: null,
  flavor: undefined,
  tierRarities: undefined,
};

afterEach(() => {
  cleanup();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

describe("carta heráldica", () => {
  it("usa o nome, a descrição e o sabor do tema quando ele está ligado", () => {
    render(<AchievementCard card={CARD} />);

    expect(screen.getByText(CARD.name!.theme)).toBeTruthy();
    expect(screen.getByText(CARD.description!.theme)).toBeTruthy();
    expect(screen.getByText(CARD.flavor!)).toBeTruthy();
    expect(screen.getByText(dnd["achievement.rarity.common"])).toBeTruthy();
    expect(screen.getByText(dnd["achievement.state.locked"])).toBeTruthy();
    expect(screen.getByText(dnd["achievement.origin.catalog"])).toBeTruthy();
  });

  it("troca para o nome plain e esconde o sabor quando o tema é desligado", () => {
    render(<AchievementCard card={CARD} />);

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });

    expect(screen.getByText(CARD.name!.plain)).toBeTruthy();
    expect(screen.queryByText(CARD.name!.theme)).toBeNull();
    expect(screen.getByText(CARD.description!.plain)).toBeTruthy();
    // Texto de sabor é só do tema: ele não é escondido, ele não é renderizado.
    expect(screen.queryByText(CARD.flavor!)).toBeNull();
    expect(screen.getByText(plain["achievement.origin.catalog"])).toBeTruthy();
  });

  it("não vaza a raridade de uma carta oculta", () => {
    render(<AchievementCard card={HIDDEN} />);

    expect(screen.getByText("???")).toBeTruthy();
    expect(screen.getByText(dnd["achievement.state.hidden"])).toBeTruthy();
    expect(screen.getByText(dnd["achievement.origin.template"])).toBeTruthy();
    for (const rarity of ["common", "rare", "epic", "legendary"] as const) {
      expect(screen.queryByText(dnd[`achievement.rarity.${rarity}`])).toBeNull();
    }
  });
});
