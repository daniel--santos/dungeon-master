import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { useEventsStore } from "@/lib/events";
import { ACHIEVEMENT_FORGED, useForgedToasts, type ForgedPayload } from "@/lib/forged-toast";
import { useGlossary, useGlossaryStore } from "@/lib/glossary";
import { routeTree } from "@/routeTree.gen";

/**
 * O toast da forja, do quadro SSE até a tela: anuncia que há uma forjada
 * esperando revisão, com o atalho para o Hall, e não celebra o nome do tema —
 * a carta ainda pode ser descartada.
 */

const PAYLOAD: ForgedPayload = {
  definitionId: "0199f8f8-0000-7000-8000-000000000001",
  name: "Domador do Deadlock",
  kind: "NEMESIS_DEFEATED",
  projectId: "0199ffff-0000-7000-8000-000000000001",
  runId: "0199cccc-0000-7000-8000-000000000009",
  taskId: null,
  distillationRunId: null,
  reviewStatus: "PENDING_REVIEW",
};

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
      data: JSON.stringify({ sequence, type, payload, createdAt: "2026-09-08T10:15:00.000Z" }),
    } as MessageEvent<string>);
  }
}

function Sonda() {
  useForgedToasts();
  const { t } = useGlossary();
  return <span data-sonda>{t("nav.hall")}</span>;
}

function montar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <Sonda />
        <Toaster />
      </RouterContextProvider>
    </QueryClientProvider>,
  );

  act(() => {
    useEventsStore.getState().connect();
  });

  const source = FakeSource.last;
  if (source === null) throw new Error("o EventSource não foi criado");
  return { source };
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeSource);
  FakeSource.last = null;
});

afterEach(() => {
  act(() => {
    toast.dismiss();
    useEventsStore.getState().disconnect();
    useEventsStore.setState({ lastSequence: 0, lastEvent: null, received: 0 });
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
  cleanup();
  vi.unstubAllGlobals();
});

describe("toast da forja", () => {
  it("anuncia a forjada em revisão com o atalho para o Hall, sem o nome do tema", async () => {
    const { source } = montar();
    expect(await screen.findByText(dnd["nav.hall"])).toBeTruthy();

    act(() => {
      source.emit(ACHIEVEMENT_FORGED, PAYLOAD);
    });

    const card = await waitFor(() => {
      const element = document.querySelector(`[data-forged-toast="${PAYLOAD.definitionId}"]`);
      if (element === null) throw new Error("ainda sem toast");
      return element;
    });
    expect(card.textContent).toContain(dnd["forged.toast.title"]);
    expect(card.textContent).toContain(dnd["forged.toast.body"]);
    expect(card.textContent).toContain(dnd["forged.kind.nemesisDefeated"]);
    expect(card.textContent).not.toContain(PAYLOAD.name);
    expect(card.querySelector("a")?.getAttribute("href")).toBe("/hall?tab=achievements");
  });

  it("com o tema desligado, o mesmo quadro fala sóbrio", async () => {
    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });
    const { source } = montar();
    expect(await screen.findByText(plain["nav.hall"])).toBeTruthy();

    act(() => {
      source.emit(ACHIEVEMENT_FORGED, PAYLOAD);
    });

    const card = await waitFor(() => {
      const element = document.querySelector(`[data-forged-toast="${PAYLOAD.definitionId}"]`);
      if (element === null) throw new Error("ainda sem toast");
      return element;
    });
    expect(card.textContent).toContain(plain["forged.toast.title"]);
    expect(card.textContent).toContain(plain["forged.kind.nemesisDefeated"]);
  });

  it("ignora um quadro que não casa com o payload", async () => {
    const { source } = montar();
    await screen.findByText(dnd["nav.hall"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    act(() => {
      source.emit(ACHIEVEMENT_FORGED, { definitionId: 42 });
    });

    await waitFor(() => {
      expect(error).toHaveBeenCalled();
    });
    expect(document.querySelector("[data-forged-toast]")).toBeNull();
  });
});
