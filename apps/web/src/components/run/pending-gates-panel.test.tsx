import { dnd } from "@dungeon-master/glossary";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PendingGatesPanel } from "@/components/run/pending-gates-panel";
import { api } from "@/lib/api";
import type { ApprovalGateListItemRecord } from "@/lib/api-types";
import { ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A caixa de Selos pendentes lê uma lista só.
 *
 * O Ritual de cada linha vem por junção em `GET /approval-gates`; a linha não
 * busca o Run nem a versão congelada por conta própria. O teste conta as
 * chamadas ao cliente justamente para provar que as duas leituras por gate
 * que existiam antes não voltaram.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const NOW = "2026-09-07T14:02:11.000Z";

const GATE: ApprovalGateListItemRecord = {
  id: "0199aaaa-0000-7000-8000-000000000001",
  runId: "0199bbbb-0000-7000-8000-000000000001",
  runStepId: "0199cccc-0000-7000-8000-000000000001",
  gateKey: "approve-plan",
  title: "Aprovar o plano",
  description: null,
  status: "PENDING",
  requestedAt: NOW,
  resolvedAt: null,
  note: null,
  taskId: "0199dddd-0000-7000-8000-000000000001",
  taskTitle: "Guiada",
  workflowId: "0199eeee-0000-7000-8000-000000000001",
  workflowVersionId: "0199ffff-0000-7000-8000-000000000001",
  workflowName: "Expedição guiada",
  workflowVersion: 3,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Selos pendentes", () => {
  it("mostra a Missão e o Ritual da própria listagem, sem ler o Run", async () => {
    client.GET.mockResolvedValue(ok({ items: [GATE], page: 1, pageSize: 50, total: 1 }) as never);

    renderInRouter(<PendingGatesPanel />, "/runs");

    expect(await screen.findByText(GATE.title)).toBeTruthy();
    expect(screen.getByText(GATE.taskTitle)).toBeTruthy();
    expect(screen.getByText("Expedição guiada · v3")).toBeTruthy();
    expect(screen.getByText(dnd["approval.pending.title"])).toBeTruthy();

    const ritual = document.querySelector(`[data-pending-gate-workflow="${GATE.workflowId}"]`);
    expect(ritual?.getAttribute("href")).toBe(`/workflows/${GATE.workflowId}`);

    expect(client.GET).toHaveBeenCalledTimes(1);
    expect(client.GET).toHaveBeenCalledWith("/api/v1/approval-gates", expect.anything());
  });

  it("um gate sem Ritual mostra o traço em vez de um link vazio", async () => {
    client.GET.mockResolvedValue(
      ok({
        items: [
          {
            ...GATE,
            workflowId: null,
            workflowVersionId: null,
            workflowName: null,
            workflowVersion: null,
          },
        ],
        page: 1,
        pageSize: 50,
        total: 1,
      }) as never,
    );

    renderInRouter(<PendingGatesPanel />, "/runs");

    expect(await screen.findByText(GATE.title)).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(document.querySelector("[data-pending-gate-workflow]")).toBeNull();
  });
});
