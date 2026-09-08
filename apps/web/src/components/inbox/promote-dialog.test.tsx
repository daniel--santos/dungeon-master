import type { components } from "@dungeon-master/api-client";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PromoteDialog } from "@/components/inbox/promote-dialog";
import { api } from "@/lib/api";
import { renderInRouter } from "@/test/router";

type Task = components["schemas"]["Task"];

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const CAPTURE: Task = {
  id: "0199aaaa-0000-7000-8000-000000000001",
  projectId: null,
  parentTaskId: null,
  workflowId: null,
  title: "ver por que a autenticação quebra",
  description: null,
  kind: "FEATURE",
  status: "INBOX",
  priority: "MEDIUM",
  completedAt: null,
  createdAt: "2026-09-06T12:00:00.000Z",
  updatedAt: "2026-09-06T12:00:00.000Z",
};

const PROJECT = {
  id: "0199bbbb-0000-7000-8000-000000000001",
  title: "Dungeon Master",
  description: null,
  status: "ACTIVE" as const,
  archivedAt: null,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

const WORKFLOW = {
  id: "0199cccc-0000-7000-8000-000000000001",
  name: "Expedição guiada",
  description: null,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

/** As duas listas que o diálogo lê, respondidas por caminho. */
function responderListas(): void {
  client.GET.mockImplementation(((path: string) => {
    const items = path === "/api/v1/workflows" ? [WORKFLOW] : [PROJECT];
    return Promise.resolve({
      data: { items, page: 1, pageSize: 100, total: items.length },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
  }) as never);
}

/**
 * O Radix depende de APIs de ponteiro e de rolagem que o jsdom não implementa.
 * Sem estes stubs o menu do select nem abre, e o teste falharia por causa do
 * ambiente, não do componente.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openAndChoose(label: string, option: string): Promise<void> {
  // O seletor fica desabilitado até a lista chegar; abrir antes disso não
  // mostra opção nenhuma.
  const trigger = await waitFor(() => {
    const element = screen.getByLabelText(label) as HTMLButtonElement;
    expect(element.disabled).toBe(false);
    return element;
  });
  fireEvent.keyDown(trigger, { key: "Enter" });
  const item = await screen.findByRole("option", { name: option });
  fireEvent.click(item);
}

describe("diálogo de promoção", () => {
  it("chama a promoção com projeto, título, tipo e prioridade", async () => {
    responderListas();
    client.POST.mockResolvedValue({
      data: { ...CAPTURE, projectId: PROJECT.id, status: "READY" },
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);

    renderInRouter(<PromoteDialog capture={CAPTURE} onOpenChange={vi.fn()} />);

    const title = await screen.findByLabelText("Título");
    fireEvent.change(title, { target: { value: "Investigar a quebra de autenticação" } });

    await openAndChoose("Campanha", PROJECT.title);
    await openAndChoose("Tipo", "Monstro");
    await openAndChoose("Prioridade", "Urgente");

    fireEvent.click(screen.getByRole("button", { name: "Virar Missão" }));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/inbox/{id}/promote", {
        params: { path: { id: CAPTURE.id } },
        body: {
          projectId: PROJECT.id,
          title: "Investigar a quebra de autenticação",
          kind: "BUG",
          priority: "URGENT",
        },
      });
    });
  });

  it("com um Ritual escolhido, o workflowId vai no corpo", async () => {
    responderListas();
    client.POST.mockResolvedValue({
      data: { ...CAPTURE, projectId: PROJECT.id, workflowId: WORKFLOW.id, status: "READY" },
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);

    renderInRouter(<PromoteDialog capture={CAPTURE} onOpenChange={vi.fn()} />);

    await screen.findByLabelText("Título");
    await openAndChoose("Campanha", PROJECT.title);
    await openAndChoose("Ritual", WORKFLOW.name);

    fireEvent.click(screen.getByRole("button", { name: "Virar Missão" }));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/inbox/{id}/promote", {
        params: { path: { id: CAPTURE.id } },
        body: {
          projectId: PROJECT.id,
          title: CAPTURE.title,
          kind: "FEATURE",
          priority: "MEDIUM",
          workflowId: WORKFLOW.id,
        },
      });
    });
  });

  it("não promove sem um projeto escolhido", async () => {
    responderListas();

    renderInRouter(<PromoteDialog capture={CAPTURE} onOpenChange={vi.fn()} />);

    const submit = await screen.findByRole("button", { name: "Virar Missão" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(client.POST).not.toHaveBeenCalled();
  });
});
