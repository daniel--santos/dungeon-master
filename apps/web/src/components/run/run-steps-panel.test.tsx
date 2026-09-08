import { dnd, plain } from "@dungeon-master/glossary";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunStepsPanel } from "@/components/run/run-steps-panel";
import { api } from "@/lib/api";
import { DEFAULT_THEME } from "@dungeon-master/glossary";
import { useGlossaryStore } from "@/lib/glossary";
import { ok, RUN } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";
import { FINISHED_STEPS, RUN_STEPS } from "@/test/workflow-fixtures";

/**
 * Os Passos do ritual: um por linha, na ordem da captura, com o estado pelo
 * glossário e o resumo que cada tipo de resultado tem.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const NOW = new Date("2026-09-08T10:04:01.000Z").getTime();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

function row(key: string): HTMLElement {
  const element = document.querySelector(`[data-run-step="${key}"]`);
  if (element === null) throw new Error(`sem linha para ${key}`);
  return element as HTMLElement;
}

describe("Passos do ritual", () => {
  it("lista os passos na ordem, com o estado pelo glossário, a tentativa e a duração", async () => {
    client.GET.mockResolvedValue(ok({ items: RUN_STEPS }) as never);

    renderInRouter(<RunStepsPanel live now={NOW} runId={RUN.id} />);

    await waitFor(() => {
      expect(document.querySelectorAll("[data-run-step]")).toHaveLength(5);
    });
    expect(client.GET).toHaveBeenCalledWith("/api/v1/runs/{id}/steps", {
      params: { path: { id: RUN.id } },
    });

    const keys = [...document.querySelectorAll("[data-run-step]")].map((element) =>
      element.getAttribute("data-run-step"),
    );
    expect(keys).toEqual(["analyze", "plan", "approve-plan", "execute", "validate"]);

    expect(row("analyze").querySelector('[data-run-step-status="SUCCEEDED"]')?.textContent).toBe(
      dnd["runStep.status.succeeded"],
    );
    expect(row("analyze").textContent).toContain("tentativa 1");
    expect(row("analyze").textContent).toContain("01:30");
    expect(row("plan").textContent).toContain("tentativa 2");

    expect(
      row("approve-plan").querySelector('[data-run-step-status="WAITING_APPROVAL"]')?.textContent,
    ).toBe(dnd["runStep.status.waitingApproval"]);
    // Em curso: a duração corre até agora.
    expect(row("approve-plan").textContent).toContain("01:00");

    expect(row("execute").querySelector('[data-run-step-status="PENDING"]')?.textContent).toBe(
      dnd["runStep.status.pending"],
    );
    expect(row("execute").textContent).toContain("nenhuma tentativa");

    expect(screen.getByText(dnd["entity.workflowStep.plural"])).toBeDefined();
  });

  it("resume o resultado por tipo e explica o passo pulado", async () => {
    client.GET.mockResolvedValue(ok({ items: FINISHED_STEPS }) as never);

    renderInRouter(<RunStepsPanel live={false} now={NOW} runId={RUN.id} />);

    await waitFor(() => {
      expect(document.querySelectorAll("[data-run-step]")).toHaveLength(5);
    });

    const agent = row("analyze").querySelector('[data-step-result="agent"]');
    expect(agent?.textContent).toContain("completed");
    expect(agent?.textContent).toContain("Três arquivos precisam mudar.");

    const approval = row("approve-plan").querySelector('[data-step-result="approval"]');
    expect(approval?.textContent).toContain(dnd["approval.status.rejected"]);
    expect(approval?.textContent).toContain("Falta cobrir o Windows.");

    const skipped = row("execute").querySelector("[data-step-skip]");
    expect(skipped?.textContent).toContain(dnd["runStep.skip.predicateFalse"]);
    expect(skipped?.textContent).toContain("approve-plan terminou em FAILED");
    expect(row("execute").querySelector('[data-run-step-status="SKIPPED"]')?.textContent).toBe(
      dnd["runStep.status.skipped"],
    );

    const validation = row("validate").querySelector('[data-step-result="validation"]');
    expect(validation?.textContent).toContain("falhou");
    expect(validation?.textContent).toContain("exit code 1");
    expect(validation?.textContent).toContain("?? notes.md");
  });

  it("com o tema desligado, o mesmo estado muda só de texto", async () => {
    client.GET.mockResolvedValue(ok({ items: RUN_STEPS }) as never);

    renderInRouter(<RunStepsPanel live now={NOW} runId={RUN.id} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-run-step]")).toHaveLength(5);
    });

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });

    expect(row("analyze").querySelector('[data-run-step-status="SUCCEEDED"]')?.textContent).toBe(
      plain["runStep.status.succeeded"],
    );
    expect(screen.getByText(plain["entity.workflowStep.plural"])).toBeDefined();
  });
});
