import { dnd } from "@dungeon-master/glossary";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AchievementCard } from "@/components/hall/achievement-card";
import { filterCards, hallSearchSchema, type AchievementCard as Card } from "@/lib/achievements";

/**
 * O filtro do Hall vive nos parâmetros de busca da rota.
 *
 * O teste faz o caminho inteiro que a tela faz: a URL vira filtro tipado pelo
 * schema, o filtro escolhe as cartas, e a grade mostra só o que sobrou.
 */

function card(overrides: Partial<Card> & Pick<Card, "key">): Card {
  return {
    origin: "CATALOG",
    rarity: "COMMON",
    state: "LOCKED",
    icon: "flag",
    name: { theme: overrides.key, plain: overrides.key },
    description: { theme: "…", plain: "…" },
    flavor: undefined,
    tierRarities: undefined,
    ...overrides,
  };
}

const CARDS: Card[] = [
  card({ key: "comum" }),
  card({ key: "epica-uma", rarity: "EPIC" }),
  card({ key: "epica-outra", rarity: "EPIC" }),
  card({ key: "rara", rarity: "RARE" }),
  card({ key: "oculta", rarity: null, state: "HIDDEN", origin: "TEMPLATE", name: null }),
];

afterEach(cleanup);

describe("filtros do Hall", () => {
  it("lê raridade, origem e estado da URL, e ignora o que não conhece", () => {
    expect(hallSearchSchema.parse({ rarity: "EPIC" })).toEqual({ rarity: "EPIC" });
    expect(hallSearchSchema.parse({ origin: "TEMPLATE", state: "HIDDEN" })).toEqual({
      origin: "TEMPLATE",
      state: "HIDDEN",
    });
    // Um valor inválido cai no padrão em vez de derrubar a rota.
    expect(hallSearchSchema.parse({ rarity: "MITICA" })).toEqual({ rarity: undefined });
  });

  it("mostra só as cartas da raridade pedida na URL", () => {
    const filters = hallSearchSchema.parse({ rarity: "EPIC" });
    const shown = filterCards(CARDS, filters);

    render(
      <>
        {shown.map((item) => (
          <AchievementCard key={item.key} card={item} />
        ))}
      </>,
    );

    expect(shown.map((item) => item.key)).toEqual(["epica-uma", "epica-outra"]);
    expect(screen.getAllByText(dnd["achievement.rarity.epic"])).toHaveLength(2);
    expect(screen.queryByText(dnd["achievement.rarity.common"])).toBeNull();
  });

  it("a carta oculta não é alcançada por filtro de raridade, e é pelo de estado", () => {
    expect(filterCards(CARDS, { rarity: "COMMON" }).map((item) => item.key)).toEqual(["comum"]);
    expect(filterCards(CARDS, { state: "HIDDEN" }).map((item) => item.key)).toEqual(["oculta"]);
    expect(filterCards(CARDS, { origin: "TEMPLATE" }).map((item) => item.key)).toEqual(["oculta"]);
  });

  it("sem filtro nenhum, a grade mostra o catálogo inteiro", () => {
    expect(filterCards(CARDS, hallSearchSchema.parse({}))).toHaveLength(CARDS.length);
  });
});
