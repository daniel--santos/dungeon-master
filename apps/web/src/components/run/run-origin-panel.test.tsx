import { dnd } from "@dungeon-master/glossary";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunOriginPanel } from "@/components/run/run-origin-panel";
import { api } from "@/lib/api";
import type { RunListItemRecord, RunRecord } from "@/lib/api-types";
import { BUDGET } from "@/test/autonomy-fixtures";
import { ok, RUN, TASK } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * O bloco de origem no cockpit (Fase 9C): quem abriu a Expedição, a mãe e o
 * passo que delegou, as filhas encontradas entre as Expedições da Campanha,
 * e o Tesouro por Expedição medido sobre o próprio Run.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const PARENT_ID = "01990000-0000-7000-8000-0000000000aa";

const DELEGATED: RunRecord = {
  ...RUN,
  id: "01990000-0000-7000-8000-0000000000bb",
  createdBy: "DELEGATION",
  parentRunId: PARENT_ID,
  parentStepKey: "review",
  result: {
    status: "completed",
    summary: "Feito.",
    artifacts: [],
    discoveredTasks: [],
    knowledgeCandidates: [],
    warnings: [],
    usage: { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 },
  },
  finishedAt: "2026-09-07T14:12:11.000Z",
  status: "SUCCEEDED",
};

const CHILD: RunListItemRecord = {
  ...RUN,
  id: "01990000-0000-7000-8000-0000000000cc",
  createdBy: "DELEGATION",
  parentRunId: RUN.id,
  parentStepKey: "explore",
  taskTitle: "Explorar o módulo de pagamentos",
};

const PER_RUN_BUDGET = {
  ...BUDGET,
  id: "0199a900-0000-7000-8000-0000000000ff",
  name: "Teto por Expedição",
  window: "PER_RUN" as const,
  limits: { maxTokens: 3_000, maxRuns: null, maxWallClockMs: null, maxConcurrentRuns: null },
};

function abrir(run: RunRecord, children: readonly RunListItemRecord[], budgets = [PER_RUN_BUDGET]) {
  // A rota dos filhos devolve o Run sem o título da Task; o título vem das
  // Tasks da Campanha, e a fixture serve as duas leituras.
  const responses: Record<string, unknown> = {
    "/api/v1/runs/{id}/children": { items: children },
    "/api/v1/tasks": {
      items: children.map((child) => ({ ...TASK, id: child.taskId, title: child.taskTitle })),
      page: 1,
      pageSize: 100,
      total: children.length,
    },
    "/api/v1/budgets": { items: budgets, page: 1, pageSize: 100, total: budgets.length },
  };
  client.GET.mockImplementation(((path: string) =>
    Promise.resolve(ok(responses[path] ?? {}))) as never);

  renderInRouter(<RunOriginPanel now={Date.now()} run={run} />);
}

afterEach(() => {
  cleanup();
});

describe("o bloco de origem", () => {
  it("uma Expedição delegada mostra a origem, a mãe com link e o passo", async () => {
    abrir(DELEGATED, []);

    const panel = document.querySelector("[data-run-origin]") as HTMLElement;
    expect(panel.getAttribute("data-run-origin")).toBe("DELEGATION");
    expect(panel.querySelector("[data-run-origin-chip]")?.textContent).toContain(
      dnd["run.origin.delegation"],
    );

    const parent = panel.querySelector("[data-run-parent]") as HTMLAnchorElement;
    expect(parent.getAttribute("data-run-parent")).toBe(PARENT_ID);
    expect(parent.getAttribute("href")).toBe(`/runs/${PARENT_ID}`);
    expect(panel.querySelector("[data-run-parent-step]")?.textContent).toBe("review");

    await waitFor(() => {
      expect(panel.textContent).toContain(dnd["run.children.empty"]);
    });
    expect(panel.querySelector("[data-run-children]")?.getAttribute("data-run-children")).toBe("0");
  });

  it("uma Expedição do usuário lista as filhas que a delegação abriu", async () => {
    abrir(RUN, [CHILD]);

    const panel = document.querySelector("[data-run-origin]") as HTMLElement;
    expect(panel.getAttribute("data-run-origin")).toBe("USER");
    expect(panel.textContent).toContain(dnd["run.origin.user"]);
    expect(panel.querySelector("[data-run-parent]")).toBeNull();

    // As filhas vêm da rota própria (Fase 9B), e o título da Task da Campanha.
    await waitFor(() => {
      expect(client.GET).toHaveBeenCalledWith("/api/v1/runs/{id}/children", {
        params: { path: { id: RUN.id } },
      });
    });
    await waitFor(() => {
      expect(panel.querySelector("[data-run-children]")?.getAttribute("data-run-children")).toBe(
        "1",
      );
    });
    const child = panel.querySelector(`[data-run-child="${CHILD.id}"]`) as HTMLElement;
    expect(child.textContent).toContain(CHILD.taskTitle);
    expect(child.textContent).toContain("explore");
  });

  it("o Tesouro por Expedição é medido sobre o próprio Run", async () => {
    abrir(DELEGATED, []);

    const budget = await waitFor(() => {
      const element = document.querySelector(`[data-run-budget="${PER_RUN_BUDGET.name}"]`);
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    // 1500 tokens sobre um teto de 3000.
    const tokens = budget.querySelector('[data-budget-limit="maxTokens"]') as HTMLElement;
    expect(tokens.getAttribute("data-budget-limit-ratio")).toBe("0.50");
    expect(budget.querySelector("[data-budget-tokens-unknown]")).toBeNull();
    expect(document.querySelector("[data-run-budget-per-run]")?.textContent).toContain(
      dnd["budget.run.title"],
    );
  });

  it("um Run que rodou e terminou sem tokens deixa o consumo incerto", async () => {
    abrir({ ...DELEGATED, result: null, status: "FAILED" }, []);

    await waitFor(() => {
      expect(document.querySelector("[data-budget-tokens-unknown]")).not.toBeNull();
    });
  });
});
