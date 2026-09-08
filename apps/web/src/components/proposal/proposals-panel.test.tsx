import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ProposalsPanel } from "@/components/proposal/proposals-panel";
import { api } from "@/lib/api";
import { ok } from "@/test/execution-fixtures";
import { GRAPH, PROPOSAL, proposalPage, SECOND_PROPOSAL } from "@/test/proposal-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A caixa de propostas abertas: uma lista só, com o que a linha precisa para
 * ser decidida — título, justificativa, Missão de origem e o atalho para o
 * cockpit — e as duas decisões atrás dos seus diálogos.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

/** O Checkbox do Radix mede o botão com `ResizeObserver`, que o jsdom não tem. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("propostas abertas", () => {
  it("lista as abertas com justificativa, origem e cockpit, numa leitura só", async () => {
    client.GET.mockResolvedValue(ok(proposalPage([PROPOSAL, SECOND_PROPOSAL])) as never);

    renderInRouter(<ProposalsPanel projectId={PROPOSAL.projectId} showOriginTask />, "/projects");

    expect(await screen.findByText(PROPOSAL.title)).toBeTruthy();
    expect(screen.getByText(SECOND_PROPOSAL.title)).toBeTruthy();
    expect(screen.getByText(dnd["proposal.open.title"])).toBeTruthy();

    const row = document.querySelector(`[data-proposal="${PROPOSAL.id}"]`);
    expect(row?.textContent).toContain(PROPOSAL.rationale ?? "");
    expect(row?.textContent).toContain(dnd["proposal.rationale"]);
    expect(row?.textContent).toContain(PROPOSAL.originTaskTitle);
    expect(
      row
        ?.querySelector(`[data-proposal-origin-task="${PROPOSAL.originTaskId}"]`)
        ?.getAttribute("href"),
    ).toBe(`/tasks/${PROPOSAL.originTaskId}`);
    expect(
      row
        ?.querySelector(`[data-proposal-origin-run="${PROPOSAL.originRunId}"]`)
        ?.getAttribute("href"),
    ).toBe(`/runs/${PROPOSAL.originRunId}`);

    // A segunda não tem justificativa, e a caixa dela não aparece.
    const second = document.querySelector(`[data-proposal="${SECOND_PROPOSAL.id}"]`);
    expect(second?.querySelector("[data-proposal-rationale]")).toBeNull();

    expect(client.GET).toHaveBeenCalledTimes(1);
    expect(client.GET).toHaveBeenCalledWith("/api/v1/proposed-tasks", {
      params: { query: { pageSize: "50", status: "PROPOSED", projectId: PROPOSAL.projectId } },
    });
  });

  it("dentro da Missão, filtra pela origem e não repete o título dela", async () => {
    client.GET.mockResolvedValue(ok(proposalPage([PROPOSAL])) as never);

    renderInRouter(
      <ProposalsPanel showOriginTask={false} taskId={PROPOSAL.originTaskId} />,
      "/tasks",
    );

    expect(await screen.findByText(PROPOSAL.title)).toBeTruthy();
    expect(document.querySelector("[data-proposal-origin-task]")).toBeNull();
    expect(client.GET).toHaveBeenCalledWith("/api/v1/proposed-tasks", {
      params: { query: { pageSize: "50", status: "PROPOSED", taskId: PROPOSAL.originTaskId } },
    });
  });

  it("sem propostas, diz isso em vez de deixar o painel em branco", async () => {
    client.GET.mockResolvedValue(ok(proposalPage([])) as never);

    renderInRouter(<ProposalsPanel projectId={PROPOSAL.projectId} />, "/projects");

    expect(await screen.findByText(dnd["proposal.open.empty"])).toBeTruthy();
    expect(document.querySelector("[data-proposals]")?.getAttribute("data-proposals")).toBe("0");
  });

  it("recusar abre a confirmação e nada é enviado antes dela", async () => {
    client.GET.mockResolvedValue(ok(proposalPage([PROPOSAL])) as never);

    renderInRouter(<ProposalsPanel projectId={PROPOSAL.projectId} />, "/projects");
    await screen.findByText(PROPOSAL.title);

    fireEvent.click(screen.getByRole("button", { name: dnd["proposal.decision.reject"] }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(dnd["proposal.reject.title"]);
    expect(dialog.textContent).toContain(dnd["proposal.reject.body"]);
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("aprovar abre o formulário com as Missões da Campanha", async () => {
    client.GET.mockImplementation(((path: string) =>
      Promise.resolve(
        ok(
          path === "/api/v1/projects/{id}/task-graph"
            ? GRAPH
            : path === "/api/v1/workflows"
              ? { items: [], page: 1, pageSize: 100, total: 0 }
              : proposalPage([PROPOSAL]),
        ),
      )) as never);

    renderInRouter(<ProposalsPanel projectId={PROPOSAL.projectId} />, "/projects");
    await screen.findByText(PROPOSAL.title);

    fireEvent.click(screen.getByRole("button", { name: dnd["proposal.decision.approve"] }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(dnd["proposal.approve.title"]);
    await waitFor(() => {
      expect(dialog.querySelectorAll("[data-approve-proposal-dependency]")).toHaveLength(
        GRAPH.nodes.length,
      );
    });
    expect(client.POST).not.toHaveBeenCalled();
  });
});
