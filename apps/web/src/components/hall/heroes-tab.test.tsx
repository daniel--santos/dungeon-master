import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeroesTab } from "@/components/hall/heroes-tab";
import { api } from "@/lib/api";
import { useGlossaryStore } from "@/lib/glossary";
import { levelPercent, type HeroStatsRecord } from "@/lib/heroes";
import { ok } from "@/test/execution-fixtures";

/**
 * A aba de Heróis com estatísticas de verdade.
 *
 * A resposta é a do contrato, campo por campo: se um deles mudar de nome, a
 * asserção cai junto. O que é falso é só o cliente HTTP.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

function stats(overrides: Partial<HeroStatsRecord>): HeroStatsRecord {
  return {
    scopeId: "0199aaaa-0000-7000-8000-000000000001",
    name: "Arquiteta",
    xp: 300,
    level: 3,
    xpToNextLevel: 100,
    expeditions: 12,
    victories: 9,
    defeats: 2,
    monstersSlain: 5,
    tokens: 128_000,
    topHarness: "Claude Code",
    ...overrides,
  };
}

const RESPONSE = {
  agents: [stats({})],
  loadouts: [
    stats({
      scopeId: "0199bbbb-0000-7000-8000-000000000001",
      name: "Equipe de ataque",
      level: 2,
      xp: 150,
    }),
  ],
};

function montar(body: unknown) {
  client.GET.mockImplementation((() => Promise.resolve(ok(body))) as never);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <HeroesTab />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

describe("aba de Heróis", () => {
  it("mostra a ficha por Agent e a tabela por Equipamento", async () => {
    montar(RESPONSE);

    expect(await screen.findByText("Arquiteta")).toBeTruthy();
    expect(screen.getByText(`${dnd["hero.level"]} 3`)).toBeTruthy();
    expect(screen.getByText(dnd["hero.byLoadout"])).toBeTruthy();
    expect(screen.getByText("Equipe de ataque")).toBeTruthy();

    // Os rótulos de número são do glossário, e mudam com o tema.
    expect(screen.getAllByText(dnd["hero.monstersSlain"]).length).toBeGreaterThan(0);
    expect(screen.getAllByText(dnd["hero.victories"]).length).toBeGreaterThan(0);

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });

    expect(screen.getAllByText(plain["hero.monstersSlain"]).length).toBeGreaterThan(0);
    expect(screen.queryByText(dnd["hero.monstersSlain"])).toBeNull();
  });

  it("uma entidade apagada continua na lista, com o nome vazio", async () => {
    montar({ agents: [stats({ name: null, topHarness: null })], loadouts: [] });

    expect(await screen.findByText(`${dnd["hero.level"]} 3`)).toBeTruthy();
    expect(screen.getByText(dnd["hero.topHarness"])).toBeTruthy();
  });

  it("sem nenhuma execução terminada, diz isso em vez de mostrar zeros", async () => {
    montar({ agents: [], loadouts: [] });

    expect(await screen.findByText(dnd["hall.tab.heroes"])).toBeTruthy();
  });
});

describe("barra de experiência", () => {
  it("é a fração do nível corrente, e nunca passa de cem", () => {
    expect(levelPercent(stats({ xp: 300, xpToNextLevel: 100 }))).toBe(75);
    expect(levelPercent(stats({ xp: 0, xpToNextLevel: 0 }))).toBe(0);
    expect(levelPercent(stats({ xp: 500, xpToNextLevel: 0 }))).toBe(100);
  });
});
