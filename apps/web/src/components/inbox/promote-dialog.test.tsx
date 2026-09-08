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
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: "Enter" });
  const item = await screen.findByRole("option", { name: option });
  fireEvent.click(item);
}

describe("diálogo de promoção", () => {
  it("chama a promoção com projeto, título, tipo e prioridade", async () => {
    client.GET.mockResolvedValue({
      data: { items: [PROJECT], page: 1, pageSize: 100, total: 1 },
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);
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

  it("não promove sem um projeto escolhido", async () => {
    client.GET.mockResolvedValue({
      data: { items: [PROJECT], page: 1, pageSize: 100, total: 1 },
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);

    renderInRouter(<PromoteDialog capture={CAPTURE} onOpenChange={vi.fn()} />);

    const submit = await screen.findByRole("button", { name: "Virar Missão" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(client.POST).not.toHaveBeenCalled();
  });
});
