import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResumeRunDialog } from "@/components/run/resume-run-dialog";
import { api } from "@/lib/api";
import type { RunRecord } from "@/lib/api-types";
import { canResumeRun, resumePrompt } from "@/lib/runs";
import { RUN } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

/** Uma Expedição derrotada, com sessão capturada: o caso em que retomar existe. */
const FALHO: RunRecord = {
  ...RUN,
  status: "FAILED",
  finishedAt: RUN.createdAt,
  error: { message: "taskkill devolveu 0 com um filho vivo." },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("retomar a Expedição", () => {
  it("só é oferecida com estado terminal sem vitória, sessão e capability", () => {
    expect(canResumeRun(FALHO)).toBe(true);
    expect(canResumeRun({ ...FALHO, status: "SUCCEEDED" })).toBe(false);
    expect(canResumeRun({ ...FALHO, status: "RUNNING" })).toBe(false);
    expect(canResumeRun({ ...FALHO, harnessSessionId: null })).toBe(false);
    expect(
      canResumeRun({
        ...FALHO,
        loadoutSnapshot: {
          ...FALHO.loadoutSnapshot,
          harness: {
            ...FALHO.loadoutSnapshot.harness,
            capabilities: { ...FALHO.loadoutSnapshot.harness.capabilities, resume: false },
          },
        },
      }),
    ).toBe(false);
  });

  it("o prompt padrão carrega o diagnóstico da tentativa anterior", () => {
    expect(resumePrompt(FALHO)).toBe(
      "Continue de onde parou. Diagnóstico anterior: taskkill devolveu 0 com um filho vivo.",
    );
    expect(resumePrompt({ ...FALHO, error: null })).toContain(
      "encerrada antes de concluir o trabalho",
    );
  });

  it("cria a Expedição nova com resumeFromRunId e o prompt editado", async () => {
    client.POST.mockResolvedValue({
      data: { ...FALHO, id: "01990000-0000-7000-8000-0000000000ff", attempt: 2 },
      error: undefined,
      response: new Response(null, { status: 201 }),
    } as never);

    renderInRouter(<ResumeRunDialog onOpenChange={vi.fn()} open run={FALHO} />);

    const prompt = await screen.findByLabelText("Prompt de continuação");
    expect((prompt as HTMLTextAreaElement).value).toBe(resumePrompt(FALHO));
    fireEvent.change(prompt, {
      target: { value: "Continue. O kill precisa confirmar por polling." },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Retomar a/ }));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/tasks/{id}/runs", {
        params: { path: { id: FALHO.taskId } },
        body: {
          resumeFromRunId: FALHO.id,
          prompt: "Continue. O kill precisa confirmar por polling.",
        },
      });
    });
  });
});
