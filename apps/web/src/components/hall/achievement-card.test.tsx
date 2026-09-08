import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AchievementCard } from "@/components/hall/achievement-card";
import { toCard, type AchievementCard as Card, type AchievementListItem } from "@/lib/achievements";
import { useGlossaryStore } from "@/lib/glossary";

/**
 * Os quatro estados da carta Heráldica, com o dado que a API manda em cada um.
 *
 * As cartas nascem de `toCard`, e não escritas à mão, porque a normalização —
 * "uma carta oculta não vaza nada" — faz parte do que está sob prova.
 */

function item(overrides: Partial<AchievementListItem>): AchievementListItem {
  return {
    id: "0199aaaa-0000-7000-8000-000000000001",
    origin: "CATALOG",
    key: "first_expedition",
    scopeType: "GLOBAL",
    scopeId: null,
    scopeLabel: null,
    name: { theme: "Primeira Expedição", plain: "Primeira execução" },
    description: {
      theme: "Vencer a primeira Expedição. Uma.",
      plain: "Concluir a primeira execução com sucesso.",
    },
    flavor: "O Dungeon Master conferiu duas vezes.",
    icon: "flag",
    rarity: "COMMON",
    hidden: false,
    state: "LOCKED",
    tier: { current: 0, total: 1, label: null },
    progress: { current: 0, target: 1, percent: 0 },
    unlockedAt: null,
    ...overrides,
  };
}

const LOCKED: Card = toCard(item({ state: "LOCKED" }));

const HIDDEN: Card = toCard(
  item({
    id: "0199aaaa-0000-7000-8000-000000000002",
    key: "campaign_guardian",
    origin: "TEMPLATE",
    hidden: true,
    state: "HIDDEN",
    rarity: "EPIC",
    name: { theme: "Guardião da Forja", plain: "Guardião da Forja" },
  }),
);

const IN_PROGRESS: Card = toCard(
  item({
    id: "0199aaaa-0000-7000-8000-000000000003",
    key: "monster_slayer",
    name: { theme: "Caçador de Monstros", plain: "Caçador de bugs" },
    description: { theme: "Derrotar Monstros.", plain: "Resolver bugs." },
    state: "IN_PROGRESS",
    tier: { current: 0, total: 3, label: null },
    progress: { current: 1, target: 10, percent: 10 },
  }),
);

const UNLOCKED: Card = toCard(
  item({
    state: "UNLOCKED",
    tier: { current: 1, total: 1, label: null },
    progress: { current: 1, target: 1, percent: 100 },
    unlockedAt: "2026-09-07T14:02:11.000Z",
  }),
);

const TIERED_UNLOCKED: Card = toCard(
  item({
    id: "0199aaaa-0000-7000-8000-000000000004",
    key: "monster_slayer",
    name: { theme: "Caçador de Monstros", plain: "Caçador de bugs" },
    description: { theme: "Derrotar Monstros.", plain: "Resolver bugs." },
    state: "UNLOCKED",
    rarity: "RARE",
    tier: { current: 2, total: 3, label: "II" },
    progress: { current: 50, target: 200, percent: 25 },
    unlockedAt: "2026-09-07T14:02:11.000Z",
  }),
);

afterEach(() => {
  cleanup();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

describe("carta heráldica", () => {
  it("bloqueada: nome, descrição e sabor do tema, sem barra de progresso", () => {
    const { container } = render(<AchievementCard card={LOCKED} />);

    expect(screen.getByText("Primeira Expedição")).toBeTruthy();
    expect(screen.getByText("Vencer a primeira Expedição. Uma.")).toBeTruthy();
    expect(screen.getByText("O Dungeon Master conferiu duas vezes.")).toBeTruthy();
    expect(screen.getByText(dnd["achievement.rarity.common"])).toBeTruthy();
    expect(screen.getByText(dnd["achievement.state.locked"])).toBeTruthy();
    expect(screen.getByText(dnd["achievement.origin.catalog"])).toBeTruthy();
    // Uma barra vazia repetida quinze vezes não diz nada: ela só existe em progresso.
    expect(container.querySelector("[data-achievement-progress]")).toBeNull();
  });

  it("oculta: nada da definição vaza, nem a raridade", () => {
    render(<AchievementCard card={HIDDEN} />);

    expect(screen.getByText("???")).toBeTruthy();
    expect(screen.queryByText("Guardião da Forja")).toBeNull();
    expect(screen.getByText(dnd["achievement.state.hidden"])).toBeTruthy();
    expect(screen.getByText(dnd["achievement.origin.template"])).toBeTruthy();
    for (const rarity of ["common", "rare", "epic", "legendary"] as const) {
      expect(screen.queryByText(dnd[`achievement.rarity.${rarity}`])).toBeNull();
    }
  });

  it("em progresso: barra e o quanto falta, sem numeral de grau", () => {
    const { container } = render(<AchievementCard card={IN_PROGRESS} />);

    expect(screen.getByText(dnd["achievement.state.inProgress"])).toBeTruthy();
    expect(screen.getByText("1 de 10")).toBeTruthy();
    expect(container.querySelector("[data-achievement-progress]")).not.toBeNull();
    // `label` nulo é a API dizendo que nenhum degrau foi vencido ainda.
    expect(screen.getByRole("heading")).toHaveProperty("textContent", "Caçador de Monstros");
  });

  it("desbloqueada: o sinal de confirmação, e o grau quando existe mais de um", () => {
    const { rerender } = render(<AchievementCard card={UNLOCKED} />);
    expect(screen.getByText(dnd["achievement.state.unlocked"])).toBeTruthy();
    expect(screen.getByRole("heading")).toHaveProperty("textContent", "Primeira Expedição");

    rerender(<AchievementCard card={TIERED_UNLOCKED} />);
    expect(screen.getByRole("heading")).toHaveProperty("textContent", "Caçador de Monstros II");
    expect(screen.getByText(dnd["achievement.rarity.rare"])).toBeTruthy();
  });

  it("marca o desbloqueio que o usuário ainda não viu", () => {
    const { container } = render(<AchievementCard card={UNLOCKED} unseen />);
    expect(container.querySelector("[data-achievement-unseen]")).not.toBeNull();

    cleanup();
    const plainCard = render(<AchievementCard card={UNLOCKED} />);
    expect(plainCard.container.querySelector("[data-achievement-unseen]")).toBeNull();
  });

  it("troca para o nome plain e esconde o sabor quando o tema é desligado", () => {
    render(<AchievementCard card={LOCKED} />);

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });

    expect(screen.getByText("Primeira execução")).toBeTruthy();
    expect(screen.queryByText("Primeira Expedição")).toBeNull();
    expect(screen.getByText("Concluir a primeira execução com sucesso.")).toBeTruthy();
    // Texto de sabor é só do tema: ele não é escondido, ele não é renderizado.
    expect(screen.queryByText("O Dungeon Master conferiu duas vezes.")).toBeNull();
    expect(screen.getByText(plain["achievement.origin.catalog"])).toBeTruthy();
  });
});
