import { dnd } from "@dungeon-master/glossary";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApproveProposalDialog } from "@/components/proposal/approve-proposal-dialog";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { ok } from "@/test/execution-fixtures";
import {
  FORGE_TASK_ID,
  GATE_TASK_ID,
  GRAPH,
  ORIGIN_TASK_ID,
  PROPOSAL,
} from "@/test/proposal-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * O diálogo de aprovação: o payload é montado do que foi escolhido — mãe,
 * dependências, tipo, prioridade, Ritual, nota —, a Task de origem só entra
 * como dependência quando não é a mãe, o `409` de decisão perdida mostra o
 * que já foi decidido, e o `409` de ciclo nomeia as Tasks do impasse.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const WORKFLOW_ID = "0199a0a0-0000-7000-8000-000000000001";

const RESPONSES: Record<string, unknown> = {
  "/api/v1/projects/{id}/task-graph": GRAPH,
  "/api/v1/workflows": {
    items: [
      {
        id: WORKFLOW_ID,
        name: "Ritual guiado",
        description: null,
        definition: { name: "Ritual guiado", steps: [] },
        latestVersion: null,
        createdAt: PROPOSAL.createdAt,
        updatedAt: PROPOSAL.createdAt,
      },
    ],
    page: 1,
    pageSize: 100,
    total: 1,
  },
};

/**
 * O Radix depende de APIs de ponteiro, de rolagem e de medida que o jsdom
 * não implementa: sem os stubs o Select não abre e o Checkbox, que mede o
 * botão para posicionar o input escondido do formulário, quebra na montagem.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  vi.clearAllMocks();
});

async function abrir(onOpenChange = vi.fn()) {
  client.GET.mockImplementation(((path: string) =>
    Promise.resolve(ok(RESPONSES[path] ?? {}))) as never);

  renderInRouter(
    <>
      <ApproveProposalDialog onOpenChange={onOpenChange} proposal={PROPOSAL} />
      <Toaster />
    </>,
    "/projects",
  );

  const dialog = await screen.findByRole("dialog");
  await waitFor(() => {
    expect(dialog.querySelectorAll("[data-approve-proposal-dependency]")).toHaveLength(
      GRAPH.nodes.length,
    );
  });
  return { dialog, onOpenChange };
}

function dependencyBox(taskId: string): HTMLButtonElement {
  const box = document.querySelector(
    `[data-approve-proposal-dependency="${taskId}"] [role="checkbox"]`,
  );
  if (box === null) throw new Error(`sem caixa para ${taskId}`);
  return box as HTMLButtonElement;
}

async function escolher(label: string, option: string | RegExp): Promise<void> {
  fireEvent.keyDown(screen.getByLabelText(label), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("aprovar a proposta", () => {
  it("por padrão a mãe é a origem, e a origem não pode ser dependência", async () => {
    const { dialog } = await abrir();

    expect(dialog.textContent).toContain(dnd["proposal.approve.title"]);
    expect(dialog.textContent).toContain(PROPOSAL.title);
    expect(dialog.textContent).toContain(dnd["proposal.approve.parent.origin"]);
    expect(dependencyBox(ORIGIN_TASK_ID).disabled).toBe(true);
    expect(dependencyBox(FORGE_TASK_ID).disabled).toBe(false);
    expect(dialog.textContent).toContain(dnd["proposal.approve.dependsOn.parent"]);
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("monta o payload com as dependências marcadas, a prioridade, o Ritual e a nota", async () => {
    client.POST.mockResolvedValue(
      ok({
        ...PROPOSAL,
        status: "APPROVED",
        decidedAt: PROPOSAL.createdAt,
        createdTaskId: "0199eeee-0000-7000-8000-000000000009",
      }) as never,
    );
    const { dialog, onOpenChange } = await abrir();

    fireEvent.click(dependencyBox(FORGE_TASK_ID));
    await escolher("Prioridade", dnd["task.priority.high"]);
    await escolher(dnd["entity.workflow"], "Ritual guiado");
    fireEvent.change(screen.getByLabelText("Nota (opcional)"), {
      target: { value: "Faz sentido depois da chave." },
    });
    fireEvent.click(dialog.querySelector('[data-proposal-confirm="approve"]') as HTMLElement);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/proposed-tasks/{id}/approve", {
        params: { path: { id: PROPOSAL.id } },
        body: {
          dependsOn: [FORGE_TASK_ID],
          kind: "FEATURE",
          priority: "HIGH",
          workflowId: WORKFLOW_ID,
          note: "Faz sentido depois da chave.",
        },
      });
    });
    // Sem `parentTaskId` no corpo: a ausência é o que diz "filha da origem".
    const body = (client.POST.mock.calls[0]?.[1] as unknown as { body: Record<string, unknown> })
      .body;
    expect(Object.hasOwn(body, "parentTaskId")).toBe(false);

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(await screen.findByText(dnd["proposal.approve.done"])).toBeTruthy();
  });

  it("sem mãe, manda `parentTaskId: null` e a origem entra pré-marcada como dependência", async () => {
    client.POST.mockResolvedValue(
      ok({ ...PROPOSAL, status: "APPROVED", decidedAt: PROPOSAL.createdAt }) as never,
    );
    const { dialog } = await abrir();

    await escolher(dnd["proposal.approve.parent"], dnd["proposal.approve.parent.none"]);

    await waitFor(() => {
      expect(dependencyBox(ORIGIN_TASK_ID).disabled).toBe(false);
      expect(dependencyBox(ORIGIN_TASK_ID).getAttribute("aria-checked")).toBe("true");
    });
    expect(dialog.textContent).toContain(dnd["proposal.approve.dependsOn.hint"]);

    fireEvent.click(dialog.querySelector('[data-proposal-confirm="approve"]') as HTMLElement);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/proposed-tasks/{id}/approve", {
        params: { path: { id: PROPOSAL.id } },
        body: {
          parentTaskId: null,
          dependsOn: [ORIGIN_TASK_ID],
          kind: "FEATURE",
          priority: "MEDIUM",
        },
      });
    });
  });

  it("no 409 de decisão perdida mostra o estado que veio em `proposedTask`", async () => {
    client.POST.mockResolvedValue({
      data: undefined,
      error: {
        type: "https://dungeon-master.local/problems/domain-conflict",
        title: "Proposta já decidida",
        status: 409,
        detail: "A proposta já está em REJECTED. Outra decisão chegou antes; nada foi sobrescrito.",
        instance: `/api/v1/proposed-tasks/${PROPOSAL.id}/approve`,
        proposedTask: {
          ...PROPOSAL,
          status: "REJECTED",
          decidedAt: "2026-09-08T12:30:00.000Z",
          note: "Recusada na outra aba.",
        },
      },
      response: new Response(null, { status: 409 }),
    } as never);
    const { dialog, onOpenChange } = await abrir();

    fireEvent.click(dialog.querySelector('[data-proposal-confirm="approve"]') as HTMLElement);

    const conflict = await waitFor(() => {
      const element = document.querySelector('[data-proposal-conflict="REJECTED"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(conflict.textContent).toContain(dnd["proposal.status.rejected"].toLowerCase());
    expect(conflict.textContent).toContain("Recusada na outra aba.");
    expect(document.querySelector('[data-proposal-confirm="approve"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("no 409 de ciclo, o toast nomeia as Tasks do caminho e o diálogo continua aberto", async () => {
    client.POST.mockResolvedValue({
      data: undefined,
      error: {
        type: "https://dungeon-master.local/problems/domain-conflict",
        title: "Ciclo de dependências",
        status: 409,
        detail: "A dependência criaria um impasse.",
        instance: `/api/v1/proposed-tasks/${PROPOSAL.id}/approve`,
        path: [FORGE_TASK_ID, GATE_TASK_ID, FORGE_TASK_ID],
      },
      response: new Response(null, { status: 409 }),
    } as never);
    const { dialog, onOpenChange } = await abrir();

    fireEvent.click(dependencyBox(GATE_TASK_ID));
    fireEvent.click(dialog.querySelector('[data-proposal-confirm="approve"]') as HTMLElement);

    const expected = dnd["graph.cycle"].replace(
      "{path}",
      "Forjar a chave → Abrir o portão → Forjar a chave",
    );
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
