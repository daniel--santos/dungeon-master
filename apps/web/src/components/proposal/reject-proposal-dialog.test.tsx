import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RejectProposalDialog } from "@/components/proposal/reject-proposal-dialog";
import { api } from "@/lib/api";
import { ok } from "@/test/execution-fixtures";
import { PROPOSAL } from "@/test/proposal-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * Recusar uma proposta: confirmação num `AlertDialog`, a nota vai junto, e o
 * `409` mostra o que já foi decidido em vez de tentar de novo.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("recusar a proposta", () => {
  it("confirma e manda a nota; sem nota, o corpo vai vazio", async () => {
    client.POST.mockResolvedValue(
      ok({
        ...PROPOSAL,
        status: "REJECTED",
        decidedAt: PROPOSAL.createdAt,
        note: "Já existe.",
      }) as never,
    );
    const onOpenChange = vi.fn();

    renderInRouter(<RejectProposalDialog onOpenChange={onOpenChange} proposal={PROPOSAL} />);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(PROPOSAL.title);
    fireEvent.change(screen.getByLabelText("Nota (opcional)"), { target: { value: "Já existe." } });
    fireEvent.click(dialog.querySelector('[data-proposal-confirm="reject"]') as HTMLElement);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/proposed-tasks/{id}/reject", {
        params: { path: { id: PROPOSAL.id } },
        body: { note: "Já existe." },
      });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("no 409 mostra o estado que veio em `proposedTask` e não sobrescreve", async () => {
    client.POST.mockResolvedValue({
      data: undefined,
      error: {
        type: "https://dungeon-master.local/problems/domain-conflict",
        title: "Proposta já decidida",
        status: 409,
        detail: "A proposta já está em APPROVED. Outra decisão chegou antes; nada foi sobrescrito.",
        instance: `/api/v1/proposed-tasks/${PROPOSAL.id}/reject`,
        proposedTask: {
          ...PROPOSAL,
          status: "APPROVED",
          decidedAt: "2026-09-08T12:30:00.000Z",
          note: "Aprovada na outra aba.",
          createdTaskId: "0199eeee-0000-7000-8000-000000000009",
        },
      },
      response: new Response(null, { status: 409 }),
    } as never);
    const onOpenChange = vi.fn();

    renderInRouter(<RejectProposalDialog onOpenChange={onOpenChange} proposal={PROPOSAL} />);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(dialog.querySelector('[data-proposal-confirm="reject"]') as HTMLElement);

    const conflict = await waitFor(() => {
      const element = document.querySelector('[data-proposal-conflict="APPROVED"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(conflict.textContent).toContain(dnd["proposal.status.approved"].toLowerCase());
    expect(conflict.textContent).toContain("Aprovada na outra aba.");
    expect(conflict.querySelector("a")?.getAttribute("href")).toBe(
      "/tasks/0199eeee-0000-7000-8000-000000000009",
    );
    // A pergunta some: não há mais o que decidir.
    expect(document.querySelector('[data-proposal-confirm="reject"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
