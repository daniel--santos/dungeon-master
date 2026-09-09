import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLiveQueries } from "@/lib/live";

/**
 * O despachante que liga o stream de eventos às queries.
 *
 * Cada ramo daqui é o que faz uma tela aberta se atualizar sozinha. Um tipo de
 * evento sem ramo não dá erro nenhum: a tela simplesmente fica velha até uma
 * navegação, que é o defeito mais silencioso que existe nesta camada.
 */

const mocks = vi.hoisted(() => {
  const listeners = new Set<(event: { type: string }) => void>();
  return {
    listeners,
    // Identidade estável: o hook inscreve o ouvinte num efeito com
    // `addListener` na dependência.
    addListener: (listener: (event: { type: string }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("@/lib/events", () => ({
  useEventsStore: (selector: (state: { addListener: typeof mocks.addListener }) => unknown) =>
    selector({ addListener: mocks.addListener }),
}));

afterEach(() => {
  cleanup();
  mocks.listeners.clear();
});

/** Monta o hook e devolve as chaves invalidadas por cada evento empurrado. */
function montar(): (type: string) => string[][] {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidated: string[][] = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters?: unknown) => {
    invalidated.push([...((filters as { queryKey?: string[] } | undefined)?.queryKey ?? [])]);
    return Promise.resolve();
  });

  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  renderHook(
    () => {
      useLiveQueries();
    },
    { wrapper: Wrapper },
  );

  return (type: string) => {
    invalidated.length = 0;
    act(() => {
      for (const listener of mocks.listeners) listener({ type });
    });
    return invalidated;
  };
}

describe("useLiveQueries", () => {
  it("relê a lista de Expedições a cada evento de Run", () => {
    const emitir = montar();

    // Os quatro tipos de `ActivityType` que começam por `run.`.
    for (const type of [
      "run.created",
      "run.status_changed",
      "run.cancel_requested",
      "run.permission_bypassed",
    ]) {
      expect(emitir(type), type).toContainEqual(["runs"]);
    }
  });

  it("um Run que muda de estado também mexe na Missão e na Campanha", () => {
    const emitir = montar();

    const keys = emitir("run.status_changed");
    expect(keys).toContainEqual(["tasks"]);
    expect(keys).toContainEqual(["projects"]);
  });

  it("os cadastros de execução releem quando mudam em outra aba", () => {
    const emitir = montar();

    for (const type of [
      "harness.updated",
      "model.created",
      "agent.updated",
      "execution_profile.updated",
      "loadout.deleted",
    ]) {
      expect(emitir(type), type).toContainEqual(["loadouts"]);
    }
  });

  it("os ramos que já existiam continuam valendo", () => {
    const emitir = montar();

    expect(emitir("task.status_changed")).toContainEqual(["tasks"]);
    expect(emitir("project.updated")).toContainEqual(["projects"]);
    expect(emitir("workflow.created")).toContainEqual(["workflows"]);
    expect(emitir("approval.requested")).toContainEqual(["approval-gates"]);
    expect(emitir("knowledge.distilled")).toContainEqual(["knowledge"]);
    expect(emitir("achievement.forged")).toContainEqual(["achievements", "forged"]);
  });
});
