import { dnd } from "@dungeon-master/glossary";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BestiaryTab } from "@/components/hall/bestiary-tab";
import { api } from "@/lib/api";
import type { TaskRecord } from "@/lib/api-types";
import { ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * O Bestiário com a coluna de nêmesis preenchida.
 *
 * As quatro leituras da aba — Tasks, Runs, Projects e reaberturas — são
 * respondidas por caminho, para o teste dizer exatamente o que cada uma
 * devolveu. O que está sob prova é a junção por `taskId`: quem tem reabertura
 * mostra a contagem, quem não tem mostra o traço.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const NOW = "2026-09-07T14:02:11.000Z";

function bug(id: string, title: string): TaskRecord {
  return {
    id,
    projectId: "0199ffff-0000-7000-8000-000000000001",
    parentTaskId: null,
    workflowId: null,
    title,
    description: null,
    kind: "BUG",
    status: "COMPLETED",
    priority: "HIGH",
    completedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const NEMESIS = bug("0199eeee-0000-7000-8000-000000000001", "Worker não encerra a árvore");
const ORDINARIO = bug("0199eeee-0000-7000-8000-000000000002", "Botão sem foco");

function montar() {
  client.GET.mockImplementation(((path: string) => {
    if (path === "/api/v1/tasks") {
      return Promise.resolve(ok({ items: [NEMESIS, ORDINARIO], page: 1, pageSize: 100, total: 2 }));
    }
    if (path === "/api/v1/task-reopenings") {
      return Promise.resolve(
        ok({ items: [{ taskId: NEMESIS.id, count: 3, lastReopenedAt: NOW }] }),
      );
    }
    return Promise.resolve(ok({ items: [], page: 1, pageSize: 100, total: 0 }));
  }) as never);

  return renderInRouter(<BestiaryTab />, "/hall");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Bestiário", () => {
  it("mostra a contagem de reaberturas de quem tem, e o traço de quem não tem", async () => {
    montar();

    expect(await screen.findByText(NEMESIS.title)).toBeTruthy();
    expect(screen.getByText(dnd["hall.bestiary.nemesis"])).toBeTruthy();

    const nemesis = document.querySelector(`[data-bestiary-task="${NEMESIS.id}"]`);
    const ordinario = document.querySelector(`[data-bestiary-task="${ORDINARIO.id}"]`);
    expect(nemesis?.querySelector("[data-bestiary-reopened]")?.textContent).toBe("3 reaberturas");
    expect(ordinario?.querySelector("[data-bestiary-reopened]")?.textContent).toBe("—");

    // A leitura é uma só para a aba, filtrada pelo tipo que o Bestiário mostra.
    expect(client.GET).toHaveBeenCalledWith("/api/v1/task-reopenings", {
      params: { query: { kind: "BUG" } },
    });
  });
});
