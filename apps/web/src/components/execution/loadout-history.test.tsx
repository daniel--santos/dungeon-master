import { dnd } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadoutHistory } from "@/components/execution/loadout-history";
import { api } from "@/lib/api";
import { AGENT, HARNESS, HOST_PROFILE, LOADOUT, ok } from "@/test/execution-fixtures";
import {
  LOADOUT_VERSION_3,
  LOADOUT_VERSION_4,
  OTHER_TOOL,
  SKILL,
  TOOL,
} from "@/test/registry-fixtures";

/**
 * O histórico de versões do Equipamento (Fase 8C): cada versão com o que
 * mudou em relação à anterior, e a restauração atrás de confirmação, que
 * cria uma versão nova.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const RESPONSES: Record<string, unknown> = {
  "/api/v1/loadouts/{id}/versions": {
    items: [LOADOUT_VERSION_4, LOADOUT_VERSION_3],
    page: 1,
    pageSize: 20,
    total: 2,
  },
  "/api/v1/agents": { items: [AGENT] },
  "/api/v1/harnesses": { items: [HARNESS] },
  "/api/v1/models": { items: [] },
  "/api/v1/execution-profiles": { items: [HOST_PROFILE] },
  "/api/v1/skills": { items: [SKILL], page: 1, pageSize: 100, total: 1 },
  "/api/v1/tools": { items: [TOOL, OTHER_TOOL], page: 1, pageSize: 100, total: 2 },
  "/api/v1/mcp-servers": { items: [], page: 1, pageSize: 100, total: 0 },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function montar() {
  client.GET.mockImplementation(((path: string) =>
    Promise.resolve(ok(RESPONSES[path] ?? { items: [] }))) as never);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onRestored = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <LoadoutHistory loadout={LOADOUT} onRestored={onRestored} />
    </QueryClientProvider>,
  );
  return { onRestored };
}

describe("histórico do Equipamento", () => {
  it("lista as versões, marca a atual e diz o que mudou pelo nome", async () => {
    montar();

    const v4 = await waitFor(() => {
      const element = document.querySelector('[data-loadout-version="4"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(v4.querySelector("[data-loadout-version-current]")).not.toBeNull();
    expect(v4.querySelector('[data-loadout-change="pin"]')?.textContent).toContain(SKILL.name);
    expect(v4.querySelector('[data-loadout-change="pin"]')?.textContent).toContain("v1");
    expect(v4.querySelector('[data-loadout-change="added:tools"]')?.textContent).toContain(
      OTHER_TOOL.name,
    );

    const v3 = document.querySelector('[data-loadout-version="3"]') as HTMLElement;
    expect(v3.querySelector("[data-loadout-version-current]")).toBeNull();
    expect(v3.textContent).toContain(dnd["loadout.history.first"]);
    // Só a versão que não é a atual tem restaurar.
    expect(v4.querySelector("[data-loadout-restore]")).toBeNull();
    expect(v3.querySelector('[data-loadout-restore="3"]')).not.toBeNull();
  });

  it("restaurar pede confirmação, explica que cria uma versão nova, e chama a API", async () => {
    client.POST.mockResolvedValue(ok({ ...LOADOUT, version: 5 }) as never);
    const { onRestored } = montar();

    const restore = await waitFor(() => {
      const element = document.querySelector('[data-loadout-restore="3"]');
      expect(element).not.toBeNull();
      return element as HTMLButtonElement;
    });
    fireEvent.click(restore);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Restaurar a v3?");
    expect(dialog.textContent).toContain("versão nova");
    expect(client.POST).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: dnd["loadout.restore.action"] }));
    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/loadouts/{id}/versions/{version}/restore", {
        params: { path: { id: LOADOUT.id, version: "3" } },
      });
    });
    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ version: 5 }));
    });
  });

  it("uma versão idêntica à atual não sobe, e o painel avisa em vez de fingir", async () => {
    client.POST.mockResolvedValue(ok(LOADOUT) as never);
    const { onRestored } = montar();

    fireEvent.click(
      await waitFor(() => {
        const element = document.querySelector('[data-loadout-restore="3"]');
        expect(element).not.toBeNull();
        return element as HTMLButtonElement;
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: dnd["loadout.restore.action"] }));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(onRestored).not.toHaveBeenCalled();
  });
});
