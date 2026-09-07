import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CancelRunDialog } from "@/components/run/cancel-run-dialog";
import { api } from "@/lib/api";
import { RUN, ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * Abrir o diálogo não cancela nada.
 *
 * A decisão de UX da Fase 2 trocou "confirmar no segundo toque" por um
 * AlertDialog, e o valor disso está inteiro nesta separação: pensar em cancelar
 * não pode gravar `cancelRequestedAt`, porque o worker observa essa marca para
 * matar a árvore de processos.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("diálogo de cancelamento", () => {
  it("não chama a API só por estar aberto", () => {
    renderInRouter(<CancelRunDialog onOpenChange={vi.fn()} open run={RUN} />);

    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("pede o cancelamento só no botão de confirmação", async () => {
    client.POST.mockResolvedValue(ok({ ...RUN, cancelRequestedAt: RUN.createdAt }) as never);
    const onOpenChange = vi.fn();

    renderInRouter(<CancelRunDialog onOpenChange={onOpenChange} open run={RUN} />);

    fireEvent.click(screen.getByRole("button", { name: `Cancelar ${dnd["entity.run"]}` }));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/runs/{id}/cancel", {
        params: { path: { id: RUN.id } },
      });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("Voltar fecha sem pedir nada", () => {
    const onOpenChange = vi.fn();
    renderInRouter(<CancelRunDialog onOpenChange={onOpenChange} open run={RUN} />);

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(client.POST).not.toHaveBeenCalled();
  });

  it("diz que o estado terminal só vem depois da árvore encerrada", () => {
    renderInRouter(<CancelRunDialog onOpenChange={vi.fn()} open run={RUN} />);

    const dialog = screen.getByRole("alertdialog");

    // As duas coisas que o usuário não consegue adivinhar: para onde a Task
    // volta, e que o registro de cancelamento não é imediato.
    expect(dialog.textContent).toContain(dnd["task.status.ready"]);
    expect(dialog.textContent).toContain(dnd["run.status.cancelled"]);
    expect(dialog.textContent).toContain("árvore de processos for confirmada encerrada");
    expect(dialog.textContent).toContain(RUN.workspacePath ?? "");
  });
});
