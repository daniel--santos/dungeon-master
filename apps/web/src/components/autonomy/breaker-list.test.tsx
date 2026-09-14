import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BreakerList } from "@/components/autonomy/breaker-list";
import { api } from "@/lib/api";
import { BREAKER, BREAKER_CLOSED, PROJECT_ID } from "@/test/autonomy-fixtures";
import { HARNESS, LOADOUT, ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A lista de Sentinelas (Fase 9C): o estado, o motivo, desde quando e quando
 * reabre; e o reset, que fecha de qualquer estado e por isso pede
 * confirmação num `AlertDialog` antes do `POST /circuit-breakers/{id}/reset`.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

function abrir(breakers: readonly (typeof BREAKER)[]) {
  const responses: Record<string, unknown> = {
    "/api/v1/circuit-breakers": { items: breakers, page: 1, pageSize: 100, total: breakers.length },
    "/api/v1/loadouts": { items: [LOADOUT] },
    "/api/v1/harnesses": { items: [HARNESS] },
    "/api/v1/projects": { items: [], page: 1, pageSize: 100, total: 0 },
  };
  client.GET.mockImplementation(((path: string) =>
    Promise.resolve(ok(responses[path] ?? {}))) as never);
  client.POST.mockResolvedValue(ok(BREAKER_CLOSED) as never);

  renderInRouter(
    <BreakerList projectId={PROJECT_ID} projectTitle="Forja de Widgets" scope="project" />,
  );
}

afterEach(() => {
  cleanup();
});

describe("a lista de Sentinelas", () => {
  it("mostra o estado, o motivo, desde quando e quando volta a sondar", async () => {
    abrir([BREAKER]);

    const row = await waitFor(() => {
      const element = document.querySelector(`[data-breaker="${BREAKER.name}"]`);
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(row.getAttribute("data-breaker-state")).toBe("OPEN");
    expect(row.textContent).toContain(dnd["breaker.state.open"]);
    expect(row.querySelector("[data-breaker-reason]")?.textContent).toBe(BREAKER.reason);
    expect(row.querySelector("[data-breaker-opened-at]")).not.toBeNull();
    // `openedAt` mais uma hora de cooldown.
    expect(row.querySelector("[data-breaker-reopens-at]")?.getAttribute("data-breaker-reopens-at")).toBe(
      "2026-09-14T10:30:00.000Z",
    );
    expect(row.querySelector('[data-breaker-trigger-chip="consecutiveFailures"]')?.textContent).toContain(
      "3",
    );
  });

  it("o reset pede confirmação e só então chama a API", async () => {
    abrir([BREAKER]);

    const reset = await screen.findByRole("button", {
      name: `${dnd["breaker.reset"]} ${BREAKER.name}`,
    });
    fireEvent.click(reset);
    expect(client.POST).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(BREAKER.name);
    expect(dialog.textContent).toContain(dnd["breaker.reset.body"]);

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(client.POST).not.toHaveBeenCalled();

    fireEvent.click(reset);
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: dnd["breaker.reset"] }));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/circuit-breakers/{id}/reset", {
        params: { path: { id: BREAKER.id } },
      });
    });
  });

  it("uma Sentinela fechada não oferece o reset", async () => {
    abrir([BREAKER_CLOSED]);

    const row = await waitFor(() => {
      const element = document.querySelector(`[data-breaker="${BREAKER_CLOSED.name}"]`);
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(row.getAttribute("data-breaker-state")).toBe("CLOSED");
    expect(row.querySelector("[data-breaker-reset]")).toBeNull();
    expect(row.querySelector("[data-breaker-reopens-at]")).toBeNull();
  });
});
