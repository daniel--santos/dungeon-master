import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { useEventsStore } from "@/lib/events";
import { useGlossary, useGlossaryStore } from "@/lib/glossary";
import { projectKeys } from "@/lib/projects";
import {
  TASK_PROPOSAL_RESOLVED,
  TASK_PROPOSED,
  useProposalToasts,
  type ProposedPayload,
} from "@/lib/proposal-toast";
import { proposalKeys } from "@/lib/proposals";
import { taskGraphKeys } from "@/lib/task-graph";
import { routeTree } from "@/routeTree.gen";

/**
 * O toast de proposta, do quadro SSE até a tela — no mesmo caminho do toast
 * do Selo: um `EventSource` de mentira entrega o quadro, a store distribui, e
 * o ouvinte do layout raiz invalida as listas e anuncia a leva.
 */

const PAYLOAD: ProposedPayload = {
  projectId: "0199ffff-0000-7000-8000-000000000001",
  taskId: "0199eeee-0000-7000-8000-000000000001",
  runId: "01990000-0000-7000-8000-000000000001",
  count: 2,
  proposedTaskIds: ["0199d0d0-0000-7000-8000-000000000001", "0199d0d0-0000-7000-8000-000000000002"],
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
  useProposalToasts();
  const { t } = useGlossary();
  return <span data-sonda>{t("nav.projects")}</span>;
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

describe("toast de proposta", () => {
  it("anuncia a leva com o atalho para a Campanha e manda as listas relerem", async () => {
    const { invalidate, source } = montar();
    expect(await screen.findByText(dnd["nav.projects"])).toBeTruthy();

    act(() => {
      source.emit(TASK_PROPOSED, PAYLOAD);
    });

    const card = await waitFor(() => {
      const element = document.querySelector(`[data-proposal-toast="${PAYLOAD.runId}"]`);
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(card.textContent).toContain(dnd["proposal.toast.many"].replace("{n}", "2"));
    expect(card.querySelector("a")?.getAttribute("href")).toBe(`/projects/${PAYLOAD.projectId}`);

    const invalidated = invalidate.mock.calls.map(([options]) => options?.queryKey);
    expect(invalidated).toContainEqual(proposalKeys.all);
    expect(invalidated).toContainEqual(projectKeys.all);
    expect(invalidated).toContainEqual(taskGraphKeys.all);
  });

  it("uma proposta só usa o singular, e com o tema desligado o texto é o neutro", async () => {
    const { source } = montar();
    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });
    expect(await screen.findByText(plain["nav.projects"])).toBeTruthy();

    act(() => {
      source.emit(TASK_PROPOSED, {
        ...PAYLOAD,
        count: 1,
        proposedTaskIds: [PAYLOAD.proposedTaskIds[0]],
      });
    });

    expect(await screen.findByText(plain["proposal.toast.one"])).toBeTruthy();
    expect(screen.queryByText(dnd["proposal.toast.one"])).toBeNull();
  });

  it("a decisão só invalida, sem anunciar nada", async () => {
    const { invalidate, source } = montar();
    expect(await screen.findByText(dnd["nav.projects"])).toBeTruthy();

    act(() => {
      source.emit(TASK_PROPOSAL_RESOLVED, {
        proposedTaskId: PAYLOAD.proposedTaskIds[0],
        projectId: PAYLOAD.projectId,
        originTaskId: PAYLOAD.taskId,
        originRunId: PAYLOAD.runId,
        decision: "approve",
        status: "APPROVED",
        createdTaskId: "0199eeee-0000-7000-8000-000000000009",
        title: "Cobrir o encerramento no macOS",
      });
    });

    await waitFor(() => {
      expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual(
        proposalKeys.all,
      );
    });
    expect(document.querySelector("[data-proposal-toast]")).toBeNull();
  });

  it("um payload ilegível não vira toast quebrado", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { source } = montar();
    expect(await screen.findByText(dnd["nav.projects"])).toBeTruthy();

    act(() => {
      source.emit(TASK_PROPOSED, { runId: 42 });
    });

    expect(erro).toHaveBeenCalled();
    expect(document.querySelector("[data-proposal-toast]")).toBeNull();
  });
});
