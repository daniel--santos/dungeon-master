import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalGateCard } from "@/components/run/approval-gate-card";
import { api } from "@/lib/api";
import { ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";
import { GATE } from "@/test/workflow-fixtures";

/**
 * A Carta do Selo: decidir pede confirmação, a decisão vai com a nota, e o
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

describe("Carta do Selo", () => {
  it("mostra o pedido e não chama a API só por estar aberta", () => {
    renderInRouter(<ApprovalGateCard gates={[GATE]} onHoldingChange={vi.fn()} />);

    const card = document.querySelector("[data-approval-card]");
    expect(card?.textContent).toContain(dnd["approval.card.title"]);
    expect(card?.textContent).toContain(GATE.title);
    expect(card?.textContent).toContain(GATE.description ?? "");
    expect(card?.querySelector('[data-gate-status="PENDING"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: dnd["approval.decision.approve"] })).toBeDefined();
    expect(screen.getByRole("button", { name: dnd["approval.decision.reject"] })).toBeDefined();
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("clicar em conceder abre a confirmação e segura a carta; nada é enviado ainda", async () => {
    const onHoldingChange = vi.fn();
    renderInRouter(<ApprovalGateCard gates={[GATE]} onHoldingChange={onHoldingChange} />);

    fireEvent.click(screen.getByRole("button", { name: dnd["approval.decision.approve"] }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(dnd["approval.confirm.approve.title"]);
    expect(dialog.textContent).toContain(dnd["approval.confirm.approve.body"]);
    expect(client.POST).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onHoldingChange).toHaveBeenLastCalledWith(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => {
      expect(onHoldingChange).toHaveBeenLastCalledWith(false);
    });
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("confirma e manda a decisão com a nota", async () => {
    client.POST.mockResolvedValue(
      ok({
        ...GATE,
        status: "GRANTED",
        resolvedAt: GATE.requestedAt,
        note: "Pode seguir.",
      }) as never,
    );
    renderInRouter(<ApprovalGateCard gates={[GATE]} onHoldingChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Nota (opcional)"), {
      target: { value: "Pode seguir." },
    });
    fireEvent.click(screen.getByRole("button", { name: dnd["approval.decision.approve"] }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(dialog.querySelector('[data-approval-confirm="approve"]') as HTMLElement);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/approval-gates/{id}/resolve", {
        params: { path: { id: GATE.id } },
        body: { decision: "approve", note: "Pode seguir." },
      });
    });
  });

  it("negar manda reject, sem a nota quando ela está vazia", async () => {
    client.POST.mockResolvedValue(
      ok({ ...GATE, status: "REJECTED", resolvedAt: GATE.requestedAt }) as never,
    );
    renderInRouter(<ApprovalGateCard gates={[GATE]} onHoldingChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: dnd["approval.decision.reject"] }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(dnd["approval.confirm.reject.title"]);
    fireEvent.click(dialog.querySelector('[data-approval-confirm="reject"]') as HTMLElement);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/approval-gates/{id}/resolve", {
        params: { path: { id: GATE.id } },
        body: { decision: "reject" },
      });
    });
  });

  it("no 409 mostra o estado que veio em `gate` e avisa que outra decisão chegou antes", async () => {
    const decided = {
      ...GATE,
      status: "REJECTED" as const,
      resolvedAt: "2026-09-08T10:20:00.000Z",
      note: "Outra pessoa recusou.",
    };
    client.POST.mockResolvedValue({
      data: undefined,
      error: {
        type: "https://dungeon-master.local/problems/domain-conflict",
        title: "Gate já decidido",
        status: 409,
        detail:
          'O gate "plan" já está em REJECTED. Outra decisão chegou antes; nada foi sobrescrito.',
        instance: `/api/v1/approval-gates/${GATE.id}/resolve`,
        gate: decided,
      },
      response: new Response(null, { status: 409 }),
    } as never);
    const onHoldingChange = vi.fn();

    renderInRouter(<ApprovalGateCard gates={[GATE]} onHoldingChange={onHoldingChange} />);

    fireEvent.click(screen.getByRole("button", { name: dnd["approval.decision.approve"] }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(dialog.querySelector('[data-approval-confirm="approve"]') as HTMLElement);

    const conflict = await waitFor(() => {
      const element = document.querySelector('[data-approval-conflict="REJECTED"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    // O aviso vem do glossário, com o estado atual no lugar do placeholder, e
    // a carta passa a mostrar o gate como ele ficou — sem sobrescrever.
    expect(conflict.textContent).toContain(dnd["approval.status.rejected"].toLowerCase());
    expect(conflict.textContent).toContain("Outra pessoa recusou.");
    expect(document.querySelector('[data-gate-status="REJECTED"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: dnd["approval.decision.approve"] })).toBeNull();
    expect(onHoldingChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
    await waitFor(() => {
      expect(onHoldingChange).toHaveBeenLastCalledWith(false);
    });
  });
});
