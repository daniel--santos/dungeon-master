import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AutonomyLevelPanel } from "@/components/autonomy/autonomy-level-panel";
import { api } from "@/lib/api";
import { AUTONOMY_LEVEL_2, PROJECT_ID, projectAutonomy } from "@/test/autonomy-fixtures";
import { ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A escada de autonomia (Fase 9C): descer, ou subir até o 2, grava na hora;
 * subir ao 3 ou ao 4 abre a confirmação que lista o que passa a acontecer
 * sem o Selo, a partir da escada.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

function abrir(level: 0 | 1 | 2 | 3 | 4 = 2) {
  client.GET.mockResolvedValue(ok(projectAutonomy(level)) as never);
  client.PATCH.mockImplementation(((_path: string, options: { body: { autonomyLevel: 0 | 1 | 2 | 3 | 4 } }) =>
    Promise.resolve(ok(projectAutonomy(options.body.autonomyLevel)))) as never);

  renderInRouter(<AutonomyLevelPanel projectId={PROJECT_ID} />);
}

afterEach(() => {
  cleanup();
});

describe("a escada de autonomia", () => {
  it("marca o nível atual e diz o que ele libera", async () => {
    abrir(2);

    const panel = await waitFor(() => {
      const element = document.querySelector('[data-autonomy-level-panel="2"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(panel.querySelector('[data-autonomy-level="2"]')?.getAttribute("data-autonomy-level-active")).toBe(
      "true",
    );
    expect(panel.textContent).toContain(dnd["autonomy.level.propose"]);
    expect(
      panel.querySelector('[data-autonomy-allow="SUGGEST"]')?.getAttribute("data-autonomy-allowed"),
    ).toBe("true");
    expect(
      panel
        .querySelector('[data-autonomy-allow="AUTO_APPROVE_PROPOSAL"]')
        ?.getAttribute("data-autonomy-allowed"),
    ).toBe("false");
  });

  it("subir ao 1 grava na hora, sem confirmação", async () => {
    abrir(0);
    const target = await waitFor(() => {
      const element = document.querySelector('[data-autonomy-level="1"]');
      expect(element).not.toBeNull();
      return element as HTMLButtonElement;
    });

    fireEvent.click(target);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => {
      expect(client.PATCH).toHaveBeenCalledWith("/api/v1/projects/{id}/autonomy", {
        params: { path: { id: PROJECT_ID } },
        body: { autonomyLevel: 1 },
      });
    });
  });

  it("subir ao 3 pede confirmação e lista o que o nível libera", async () => {
    abrir(2);
    const target = await waitFor(() => {
      const element = document.querySelector('[data-autonomy-level="3"]');
      expect(element).not.toBeNull();
      return element as HTMLButtonElement;
    });

    fireEvent.click(target);

    const dialog = await screen.findByRole("alertdialog");
    expect(client.PATCH).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain(dnd["autonomy.level.policies"]);
    // Do 2 ao 3 entram as três automações do degrau; a delegação não.
    expect(dialog.querySelector('[data-autonomy-gain="AUTO_APPROVE_PROPOSAL"]')).not.toBeNull();
    expect(dialog.querySelector('[data-autonomy-gain="AUTO_APPROVE_GATE"]')).not.toBeNull();
    expect(dialog.querySelector('[data-autonomy-gain="AUTO_DISPATCH"]')).not.toBeNull();
    expect(dialog.querySelector('[data-autonomy-gain="DELEGATE"]')).toBeNull();
    expect(dialog.textContent).toContain(dnd["autonomy.failClosed"]);

    fireEvent.click(within(dialog).getByRole("button", { name: dnd["autonomy.change.action"] }));

    await waitFor(() => {
      expect(client.PATCH).toHaveBeenCalledWith("/api/v1/projects/{id}/autonomy", {
        params: { path: { id: PROJECT_ID } },
        body: { autonomyLevel: 3 },
      });
    });
  });

  it("descer do 3 ao 2 não pede confirmação", async () => {
    abrir(3);
    const target = await waitFor(() => {
      const element = document.querySelector('[data-autonomy-level="2"]');
      expect(element).not.toBeNull();
      return element as HTMLButtonElement;
    });

    fireEvent.click(target);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => {
      expect(client.PATCH).toHaveBeenCalledWith("/api/v1/projects/{id}/autonomy", {
        params: { path: { id: PROJECT_ID } },
        body: { autonomyLevel: AUTONOMY_LEVEL_2.autonomyLevel },
      });
    });
  });
});
