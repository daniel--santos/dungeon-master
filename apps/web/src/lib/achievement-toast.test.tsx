import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import {
  ACHIEVEMENT_UNLOCKED,
  HERO_STATS_UPDATED,
  useAchievementToasts,
  unlockToastContent,
  type UnlockPayload,
} from "@/lib/achievement-toast";
import { achievementKeys, heroKeys } from "@/lib/achievements";
import { useEventsStore } from "@/lib/events";
import { useGlossary, useGlossaryStore } from "@/lib/glossary";

/**
 * O toast de desbloqueio, do quadro SSE até a tela.
 *
 * O caminho é o de verdade: um `EventSource` de mentira entrega o quadro, a
 * store distribui aos ouvintes, o ouvinte do layout raiz invalida as queries do
 * Hall e manda a carta em miniatura para o `Toaster`. O que é falso é só o
 * transporte, porque o que está sob prova é a regra, e não o `EventSource` do
 * browser.
 */

const PAYLOAD: UnlockPayload = {
  unlockId: "0199bbbb-0000-7000-8000-000000000001",
  definitionId: "0199aaaa-0000-7000-8000-000000000001",
  name: { theme: "Primeira Expedição", plain: "Primeira execução" },
  icon: "flag",
  rarity: "RARE",
  flavor: "A arquibancada fingiu surpresa.",
  tier: 1,
  tierLabel: null,
};

/** Um `EventSource` de mentira, dirigido pelo teste. */
class FakeSource {
  static last: FakeSource | null = null;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;

  constructor(readonly url: string) {
    FakeSource.last = this;
  }

  close(): void {
    this.readyState = 2;
  }

  emit(type: string, payload: unknown, sequence = 1): void {
    this.onmessage?.({
      data: JSON.stringify({
        sequence,
        type,
        payload,
        createdAt: "2026-09-07T14:02:11.000Z",
      }),
    } as MessageEvent<string>);
  }
}

function Sonda() {
  useAchievementToasts();
  const { t } = useGlossary();
  // Uma âncora para o teste saber que a árvore montou com o tema ativo.
  return <span data-sonda>{t("nav.hall")}</span>;
}

function montar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");

  const view = render(
    <QueryClientProvider client={queryClient}>
      <Sonda />
      <Toaster />
    </QueryClientProvider>,
  );

  act(() => {
    useEventsStore.getState().connect();
  });

  const source = FakeSource.last;
  if (source === null) throw new Error("o EventSource não foi criado");

  return { view, invalidate, source };
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeSource);
  FakeSource.last = null;
});

afterEach(() => {
  act(() => {
    // O sonner guarda os toasts fora da árvore de React: sem isto o toast de um
    // teste continuaria de pé no seguinte.
    toast.dismiss();
    useEventsStore.getState().disconnect();
    useEventsStore.setState({ lastSequence: 0, lastEvent: null, received: 0 });
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
  cleanup();
  vi.unstubAllGlobals();
});

describe("toast de desbloqueio", () => {
  it("anuncia a Conquista e manda o Hall reler", async () => {
    const { invalidate, source } = montar();
    expect(await screen.findByText(dnd["nav.hall"])).toBeTruthy();

    act(() => {
      source.emit(ACHIEVEMENT_UNLOCKED, PAYLOAD);
    });

    expect(await screen.findByText("Primeira Expedição")).toBeTruthy();
    expect(screen.getByText(PAYLOAD.flavor!)).toBeTruthy();
    expect(screen.getByText(dnd["achievement.rarity.rare"])).toBeTruthy();

    const invalidated = invalidate.mock.calls.map(([options]) => options?.queryKey);
    expect(invalidated).toContainEqual(achievementKeys.all);
    expect(invalidated).toContainEqual(heroKeys.stats);
  });

  it("com o tema desligado, mostra o nome plain e nenhuma fala de anúncio", async () => {
    const { source } = montar();

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });
    expect(await screen.findByText(plain["nav.hall"])).toBeTruthy();

    act(() => {
      source.emit(ACHIEVEMENT_UNLOCKED, PAYLOAD);
    });

    expect(await screen.findByText("Primeira execução")).toBeTruthy();
    expect(screen.queryByText("Primeira Expedição")).toBeNull();
    expect(screen.queryByText(PAYLOAD.flavor!)).toBeNull();
  });

  it("um payload ilegível não vira toast quebrado", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { invalidate, source } = montar();
    expect(await screen.findByText(dnd["nav.hall"])).toBeTruthy();

    act(() => {
      source.emit(ACHIEVEMENT_UNLOCKED, { unlockId: 42 });
    });

    // A invalidação acontece de qualquer jeito: o desbloqueio existe no banco,
    // mesmo que este quadro não seja legível.
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual(
      achievementKeys.all,
    );
    expect(erro).toHaveBeenCalled();
    expect(screen.queryByText("Primeira Expedição")).toBeNull();
  });

  it("estatística de Herói invalida a própria query, sem toast", async () => {
    const { invalidate, source } = montar();
    expect(await screen.findByText(dnd["nav.hall"])).toBeTruthy();

    act(() => {
      source.emit(HERO_STATS_UPDATED, { scope: "AGENT", scopeId: "x", xp: 10, level: 1 });
    });

    await waitFor(() => {
      expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual(
        heroKeys.stats,
      );
    });
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).not.toContainEqual(
      achievementKeys.all,
    );
  });
});

describe("conteúdo do toast", () => {
  const glossary = (theme: "dnd" | "plain") => ({
    theme,
    t: (key: Parameters<ReturnType<typeof useGlossary>["t"]>[0]) =>
      (theme === "dnd" ? dnd : plain)[key],
    format: (template: string, params?: Record<string, string | number>) =>
      template.replace(/\{(\w+)\}/g, (all, name: string) => String(params?.[name] ?? all)),
  });

  it("no tema, traz a fala de anúncio; sem ele, o estado e o grau", () => {
    const comTema = unlockToastContent({ ...PAYLOAD, tierLabel: "II" }, glossary("dnd"));
    expect(comTema.name).toBe("Primeira Expedição");
    expect(comTema.flavor).toBe(PAYLOAD.flavor);
    expect(comTema.footer).toContain(dnd["achievement.state.unlocked"]);
    expect(comTema.footer).toContain("II");

    const semTema = unlockToastContent({ ...PAYLOAD, tierLabel: "II" }, glossary("plain"));
    expect(semTema.name).toBe("Primeira execução");
    expect(semTema.flavor).toBeUndefined();
    expect(semTema.footer).toContain(plain["achievement.state.unlocked"]);
  });

  it("sem grau, o rodapé é só o estado", () => {
    expect(unlockToastContent(PAYLOAD, glossary("dnd")).footer).toBe(
      dnd["achievement.state.unlocked"],
    );
  });
});
