import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewQueue } from "@/components/knowledge/review-queue";
import { api } from "@/lib/api";
import { ok } from "@/test/execution-fixtures";
import { knowledgePage, PENDING_DECISION, PENDING_ITEM } from "@/test/knowledge-fixtures";
import { PROJECT_ID } from "@/test/proposal-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A fila de revisão do Grimório: selar é ação direta, recusar pede
 * confirmação num `AlertDialog`, e o `409` mostra o item como ficou em vez
 * de tentar de novo. O conteúdo escrito pelo modelo vai como texto.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const ROUTE = `/projects/${PROJECT_ID}/knowledge`;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("fila de revisão", () => {
  it("lista os pendentes com tipo, origem e conteúdo como texto", async () => {
    client.GET.mockResolvedValue(ok(knowledgePage([PENDING_ITEM, PENDING_DECISION])) as never);

    renderInRouter(<ReviewQueue projectId={PROJECT_ID} />, ROUTE);

    expect(await screen.findByText(PENDING_ITEM.title)).toBeTruthy();
    expect(screen.getByText(PENDING_DECISION.title)).toBeTruthy();
    expect(screen.getByText(dnd["knowledge.review.title"])).toBeTruthy();

    const row = document.querySelector(`[data-review-item="${PENDING_ITEM.id}"]`);
    expect(row?.querySelector('[data-knowledge-type="FACT"]')).not.toBeNull();
    expect(
      row
        ?.querySelector(`[data-review-item-run="${PENDING_ITEM.provenance.runId}"]`)
        ?.getAttribute("href"),
    ).toBe(`/runs/${PENDING_ITEM.provenance.runId}`);

    // O `<script>` do conteúdo é texto na tela, e nunca um elemento.
    expect(row?.textContent).toContain("<script>alert(1)</script>");
    expect(row?.querySelector("script")).toBeNull();

    expect(client.GET).toHaveBeenCalledWith("/api/v1/projects/{id}/knowledge", {
      params: { path: { id: PROJECT_ID }, query: { pageSize: "50", review: "pending" } },
    });
  });

  it("selar chama o approve direto e anuncia", async () => {
    client.GET.mockResolvedValue(ok(knowledgePage([PENDING_ITEM])) as never);
    client.POST.mockResolvedValue(ok({ ...PENDING_ITEM, status: "ACTIVE" }) as never);

    renderInRouter(<ReviewQueue projectId={PROJECT_ID} />, ROUTE);
    await screen.findByText(PENDING_ITEM.title);

    fireEvent.click(screen.getByRole("button", { name: dnd["knowledge.decision.approve"] }));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/knowledge-items/{id}/approve", {
        params: { path: { id: PENDING_ITEM.id } },
        body: {},
      });
    });
  });

  it("recusar abre a confirmação, e nada é enviado antes dela; a nota vai junto", async () => {
    client.GET.mockResolvedValue(ok(knowledgePage([PENDING_ITEM])) as never);
    client.POST.mockResolvedValue(ok({ ...PENDING_ITEM, status: "REJECTED" }) as never);

    renderInRouter(<ReviewQueue projectId={PROJECT_ID} />, ROUTE);
    await screen.findByText(PENDING_ITEM.title);

    fireEvent.click(screen.getByRole("button", { name: dnd["knowledge.decision.reject"] }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(dnd["knowledge.reject.title"]);
    expect(dialog.textContent).toContain(dnd["knowledge.reject.body"]);
    expect(client.POST).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Nota (opcional)"), {
      target: { value: "Já está noutra Página." },
    });
    fireEvent.click(dialog.querySelector('[data-knowledge-confirm="reject"]') as HTMLElement);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/knowledge-items/{id}/reject", {
        params: { path: { id: PENDING_ITEM.id } },
        body: { note: "Já está noutra Página." },
      });
    });
  });

  it("no 409 mostra o item como ficou e não sobrescreve", async () => {
    client.GET.mockResolvedValue(ok(knowledgePage([PENDING_ITEM])) as never);
    client.POST.mockResolvedValue({
      data: undefined,
      error: {
        type: "https://dungeon-master.local/problems/domain-conflict",
        title: "Item já revisado",
        status: 409,
        detail: "O item já está em REJECTED. Outra decisão chegou antes; nada foi sobrescrito.",
        instance: `/api/v1/knowledge-items/${PENDING_ITEM.id}/approve`,
        item: {
          ...PENDING_ITEM,
          status: "REJECTED",
          reviewedAt: "2026-09-08T12:30:00.000Z",
          reviewNote: "Recusada na outra aba.",
        },
      },
      response: new Response(null, { status: 409 }),
    } as never);

    renderInRouter(<ReviewQueue projectId={PROJECT_ID} />, ROUTE);
    await screen.findByText(PENDING_ITEM.title);

    fireEvent.click(screen.getByRole("button", { name: dnd["knowledge.decision.approve"] }));

    const conflict = await waitFor(() => {
      const element = document.querySelector('[data-knowledge-conflict="REJECTED"]');
      if (element === null) throw new Error("ainda sem aviso");
      return element;
    });
    expect(conflict.textContent).toContain(dnd["knowledge.status.rejected"].toLowerCase());
    expect(conflict.textContent).toContain("Recusada na outra aba.");
    expect(client.POST).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
    await waitFor(() => {
      expect(document.querySelector("[data-knowledge-conflict]")).toBeNull();
    });
  });

  it("corrigir antes de selar abre o formulário e, ao salvar, edita e aprova", async () => {
    client.GET.mockResolvedValue(ok(knowledgePage([PENDING_ITEM])) as never);
    client.PATCH.mockResolvedValue(
      ok({ ...PENDING_ITEM, title: "Sala norte: alaga", version: 2 }) as never,
    );
    client.POST.mockResolvedValue(ok({ ...PENDING_ITEM, status: "ACTIVE" }) as never);

    renderInRouter(<ReviewQueue projectId={PROJECT_ID} />, ROUTE);
    await screen.findByText(PENDING_ITEM.title);

    fireEvent.click(screen.getByRole("button", { name: dnd["knowledge.decision.editApprove"] }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(dnd["knowledge.edit.title"]);
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Sala norte: alaga" } });
    fireEvent.click(dialog.querySelector('[data-knowledge-confirm="save-approve"]') as HTMLElement);

    await waitFor(() => {
      expect(client.PATCH).toHaveBeenCalledWith("/api/v1/knowledge-items/{id}", {
        params: { path: { id: PENDING_ITEM.id } },
        body: { title: "Sala norte: alaga" },
      });
    });
    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/knowledge-items/{id}/approve", {
        params: { path: { id: PENDING_ITEM.id } },
        body: {},
      });
    });
  });

  it("some quando a fila está vazia", async () => {
    client.GET.mockResolvedValue(ok(knowledgePage([])) as never);

    const { container } = renderInRouter(<ReviewQueue projectId={PROJECT_ID} />, ROUTE);
    await waitFor(() => {
      expect(client.GET).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(container.querySelector("[data-review-queue]")).toBeNull();
    });
  });
});
