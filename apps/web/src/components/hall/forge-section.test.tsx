import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ForgeSection } from "@/components/hall/forge-section";
import { api } from "@/lib/api";
import { useGlossaryStore } from "@/lib/glossary";
import { ok } from "@/test/execution-fixtures";
import { FORGED } from "@/test/knowledge-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A forja: a carta em revisão com o texto do tema (ou o sóbrio, com o tema
 * desligado), pendurar como ação direta, reescrever num diálogo de formulário
 * que manda só o que mudou, e descartar atrás de um `AlertDialog`.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

describe("na forja", () => {
  it("mostra a carta com o texto do tema, e o sóbrio com o tema desligado", async () => {
    client.GET.mockResolvedValue(ok({ items: [FORGED] }) as never);

    renderInRouter(<ForgeSection />, "/hall");

    const card = await waitFor(() => {
      const element = document.querySelector(`[data-forged="${FORGED.id}"]`);
      if (element === null) throw new Error("ainda sem carta");
      return element;
    });
    expect(screen.getByText(dnd["forged.section.title"])).toBeTruthy();
    expect(card.querySelector("[data-forged-name]")?.textContent).toBe(FORGED.name);
    expect(card.textContent).toContain(FORGED.flavor);
    expect(card.textContent).toContain(dnd["forged.kind.nemesisDefeated"]);
    expect(
      card.querySelector(`[data-forged-run="${FORGED.provenance.runId}"]`)?.getAttribute("href"),
    ).toBe(`/runs/${FORGED.provenance.runId}`);

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });

    expect(card.querySelector("[data-forged-name]")?.textContent).toBe(FORGED.plainName);
    expect(card.textContent).not.toContain(FORGED.flavor);
    expect(card.textContent).toContain(plain["forged.kind.nemesisDefeated"]);
    expect(client.GET).toHaveBeenCalledWith("/api/v1/achievements/forged", {
      params: { query: {} },
    });
  });

  it("reescrever abre o formulário com a versão sóbria e manda só o que mudou", async () => {
    client.GET.mockResolvedValue(ok({ items: [FORGED] }) as never);
    client.POST.mockResolvedValue(ok({ ...FORGED, name: "Domador de Deadlocks" }) as never);

    renderInRouter(<ForgeSection />, "/hall");
    await screen.findByText(FORGED.name);

    fireEvent.click(screen.getByRole("button", { name: dnd["forged.decision.rename"] }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(dnd["forged.rename.title"]);
    expect(dialog.querySelector("[data-rename-forged-plain]")?.textContent).toContain(
      FORGED.plainName,
    );

    fireEvent.change(screen.getByLabelText(dnd["forged.rename.name"]), {
      target: { value: "Domador de Deadlocks" },
    });
    fireEvent.click(dialog.querySelector('[data-forged-confirm="rename"]') as HTMLElement);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/achievements/{id}/rename", {
        params: { path: { id: FORGED.id } },
        body: { name: "Domador de Deadlocks" },
      });
    });
  });

  it("descartar pede confirmação, e nada é enviado antes dela", async () => {
    client.GET.mockResolvedValue(ok({ items: [FORGED] }) as never);
    client.POST.mockResolvedValue(ok({ ...FORGED, reviewStatus: "DISCARDED" }) as never);

    renderInRouter(<ForgeSection />, "/hall");
    await screen.findByText(FORGED.name);

    fireEvent.click(screen.getByRole("button", { name: dnd["forged.decision.discard"] }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(dnd["forged.discard.title"]);
    expect(dialog.textContent).toContain(dnd["forged.discard.body"]);
    expect(client.POST).not.toHaveBeenCalled();

    fireEvent.click(dialog.querySelector('[data-forged-confirm="discard"]') as HTMLElement);
    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/achievements/{id}/discard", {
        params: { path: { id: FORGED.id } },
      });
    });
  });

  it("pendurar chama o approve direto; no 409 mostra a forjada como ficou", async () => {
    client.GET.mockResolvedValue(ok({ items: [FORGED] }) as never);
    client.POST.mockResolvedValue({
      data: undefined,
      error: {
        type: "https://dungeon-master.local/problems/domain-conflict",
        title: "Conquista forjada já revisada",
        status: 409,
        detail: "A forjada já está em DISCARDED. Outra decisão chegou antes; nada foi sobrescrito.",
        instance: `/api/v1/achievements/${FORGED.id}/approve`,
        achievement: {
          ...FORGED,
          reviewStatus: "DISCARDED",
          reviewedAt: "2026-09-08T12:30:00.000Z",
        },
      },
      response: new Response(null, { status: 409 }),
    } as never);

    renderInRouter(<ForgeSection />, "/hall");
    await screen.findByText(FORGED.name);

    fireEvent.click(screen.getByRole("button", { name: dnd["forged.decision.approve"] }));

    const conflict = await waitFor(() => {
      const element = document.querySelector('[data-forged-conflict="DISCARDED"]');
      if (element === null) throw new Error("ainda sem aviso");
      return element;
    });
    expect(conflict.textContent).toContain(dnd["forged.status.discarded"].toLowerCase());
    expect(client.POST).toHaveBeenCalledWith("/api/v1/achievements/{id}/approve", {
      params: { path: { id: FORGED.id } },
      body: {},
    });
  });

  it("some quando a forja está vazia", async () => {
    client.GET.mockResolvedValue(ok({ items: [] }) as never);

    const { container } = renderInRouter(<ForgeSection />, "/hall");
    await waitFor(() => {
      expect(client.GET).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(container.querySelector("[data-forge]")).toBeNull();
    });
  });
});
