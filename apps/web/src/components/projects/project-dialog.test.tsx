import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ProjectDialog } from "@/components/projects/project-dialog";
import { api } from "@/lib/api";
import type { ProjectRecord } from "@/lib/api-types";
import { renderInRouter } from "@/test/router";

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const PROJECT: ProjectRecord = {
  id: "0199bbbb-0000-7000-8000-000000000001",
  title: "Dungeon Master",
  description: null,
  status: "ACTIVE",
  workspaceKind: "GIT_REPO",
  workspacePath: null,
  archivedAt: null,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

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

describe("diálogo de Project", () => {
  it("grava tipo e caminho absoluto do workspace", async () => {
    client.PATCH.mockResolvedValue({
      data: { ...PROJECT, workspacePath: "/home/voce/forja" },
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);

    renderInRouter(<ProjectDialog open onOpenChange={vi.fn()} project={PROJECT} />);

    const path = await screen.findByLabelText("Caminho");
    fireEvent.change(path, { target: { value: "  /home/voce/forja  " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(client.PATCH).toHaveBeenCalledWith("/api/v1/projects/{id}", {
        params: { path: { id: PROJECT.id } },
        body: {
          title: PROJECT.title,
          description: null,
          workspaceKind: "GIT_REPO",
          workspacePath: "/home/voce/forja",
        },
      });
    });
  });

  it("recusa um caminho relativo sem ir ao servidor", async () => {
    renderInRouter(<ProjectDialog open onOpenChange={vi.fn()} project={PROJECT} />);

    const path = await screen.findByLabelText("Caminho");
    fireEvent.change(path, { target: { value: "./repos/forja" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("precisa ser absoluto");
    expect(client.PATCH).not.toHaveBeenCalled();
  });

  it("mostra o detail do problem details quando a API recusa o caminho", async () => {
    client.PATCH.mockResolvedValue({
      data: undefined,
      error: {
        type: "about:blank",
        title: "Workspace não encontrado",
        status: 400,
        detail: "Não existe um diretório em /nao/existe na máquina que roda a API.",
      },
      response: new Response(null, { status: 400 }),
    } as never);

    renderInRouter(<ProjectDialog open onOpenChange={vi.fn()} project={PROJECT} />);

    const path = await screen.findByLabelText("Caminho");
    fireEvent.change(path, { target: { value: "/nao/existe" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Não existe um diretório em /nao/existe",
    );
  });

  it("esvaziar o caminho desliga o workspace", async () => {
    client.PATCH.mockResolvedValue({
      data: PROJECT,
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);

    renderInRouter(
      <ProjectDialog
        open
        onOpenChange={vi.fn()}
        project={{ ...PROJECT, workspacePath: "/home/voce/forja" }}
      />,
    );

    const path = await screen.findByLabelText("Caminho");
    fireEvent.change(path, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(client.PATCH).toHaveBeenCalledWith("/api/v1/projects/{id}", {
        params: { path: { id: PROJECT.id } },
        body: {
          title: PROJECT.title,
          description: null,
          workspaceKind: "GIT_REPO",
          workspacePath: null,
        },
      });
    });
  });

  it("na criação não pede workspace: a rota de POST não o aceita", () => {
    renderInRouter(<ProjectDialog open onOpenChange={vi.fn()} />);

    expect(screen.queryByLabelText("Caminho")).toBeNull();
  });
});
