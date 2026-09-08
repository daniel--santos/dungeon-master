import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import {
  APPROVAL_REQUESTED,
  APPROVAL_RESOLVED,
  useApprovalToasts,
  type ApprovalRequestedPayload,
} from "@/lib/approval-toast";
import { approvalKeys } from "@/lib/approvals";
import { useEventsStore } from "@/lib/events";
import { useGlossary, useGlossaryStore } from "@/lib/glossary";
import { runKeys } from "@/lib/runs";
import { routeTree } from "@/routeTree.gen";

/**
 * O toast do Selo, do quadro SSE até a tela — no mesmo caminho do toast de
 * Conquista: um `EventSource` de mentira entrega o quadro, a store distribui,
 * e o ouvinte do layout raiz invalida as pendências e anuncia o pedido.
 */

const PAYLOAD: ApprovalRequestedPayload = {
  runId: "01990000-0000-7000-8000-000000000001",
  taskId: "0199eeee-0000-7000-8000-000000000001",
  gateId: "0199b0b0-0000-7000-8000-000000000001",
  gateKey: "plan",
  title: "Confirmar o plano de implementação",
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
  useApprovalToasts();
  const { t } = useGlossary();
  return <span data-sonda>{t("nav.runs")}</span>;
}

function montar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
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
  return { invalidate, source };
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

describe("toast do Selo", () => {
  it("anuncia o pedido com o atalho para o cockpit e manda as pendências relerem", async () => {
    const { invalidate, source } = montar();
    expect(await screen.findByText(dnd["nav.runs"])).toBeTruthy();

    act(() => {
      source.emit(APPROVAL_REQUESTED, PAYLOAD);
    });

    const card = await waitFor(() => {
      const element = document.querySelector(`[data-approval-toast="${PAYLOAD.gateId}"]`);
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(card.textContent).toContain(dnd["approval.toast.title"]);
    expect(card.textContent).toContain(PAYLOAD.title);
    expect(card.querySelector("a")?.getAttribute("href")).toBe(`/runs/${PAYLOAD.runId}`);

    const invalidated = invalidate.mock.calls.map(([options]) => options?.queryKey);
    expect(invalidated).toContainEqual(approvalKeys.all);
    expect(invalidated).toContainEqual(runKeys.all);
  });

  it("com o tema desligado, o título é o neutro", async () => {
    const { source } = montar();
    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });
    expect(await screen.findByText(plain["nav.runs"])).toBeTruthy();

    act(() => {
      source.emit(APPROVAL_REQUESTED, PAYLOAD);
    });

    expect(await screen.findByText(plain["approval.toast.title"])).toBeTruthy();
    expect(screen.queryByText(dnd["approval.toast.title"])).toBeNull();
  });

  it("a decisão derruba o toast do pedido e invalida, sem anunciar nada", async () => {
    const { invalidate, source } = montar();
    expect(await screen.findByText(dnd["nav.runs"])).toBeTruthy();

    act(() => {
      source.emit(APPROVAL_REQUESTED, PAYLOAD, 1);
    });
    expect(await screen.findByText(PAYLOAD.title)).toBeTruthy();

    act(() => {
      source.emit(APPROVAL_RESOLVED, { ...PAYLOAD, decision: "approve", status: "GRANTED" }, 2);
    });

    await waitFor(() => {
      expect(document.querySelector(`[data-approval-toast="${PAYLOAD.gateId}"]`)).toBeNull();
    });
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual(
      approvalKeys.all,
    );
  });

  it("um payload ilegível não vira toast quebrado", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { source } = montar();
    expect(await screen.findByText(dnd["nav.runs"])).toBeTruthy();

    act(() => {
      source.emit(APPROVAL_REQUESTED, { gateId: 42 });
    });

    expect(erro).toHaveBeenCalled();
    expect(document.querySelector("[data-approval-toast]")).toBeNull();
  });
});
