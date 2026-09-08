import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunContextPanel } from "@/components/run/run-context-panel";
import { api } from "@/lib/api";
import type { RunRecord } from "@/lib/api-types";
import { useGlossaryStore } from "@/lib/glossary";
import {
  DISABLED_CONTEXT,
  EMPTY_CONTEXT,
  EXCLUDED_ITEM_ID,
  FAILED_CONTEXT,
  INHERITED_CONTEXT,
  notFound,
  PARENT_TASK_ID,
  PRIOR_RUN_ID,
  RUN_CONTEXT,
} from "@/test/context-fixtures";
import { ok, RUN } from "@/test/execution-fixtures";
import { ACTIVE_ITEM } from "@/test/knowledge-fixtures";
import { PROJECT_ID } from "@/test/proposal-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * As provisões da Expedição no cockpit (Fase 7C): os quatro estados do
 * contrato mais o `404` e a herança, o medidor, os itens com motivo e link
 * para a origem, os excluídos com o motivo, e o texto como texto.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const FINISHED: RunRecord = { ...RUN, status: "SUCCEEDED", finishedAt: RUN.startedAt };
const QUEUED: RunRecord = { ...RUN, status: "QUEUED", startedAt: null };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

function panel(): HTMLElement {
  const element = document.querySelector("[data-run-context]");
  if (element === null) throw new Error("sem painel de contexto");
  return element as HTMLElement;
}

function query(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

describe("as provisões da Expedição", () => {
  it("mostra o contexto montado: medidor, seções, itens com motivo, score, tokens e corte", async () => {
    client.GET.mockResolvedValue(ok(RUN_CONTEXT) as never);

    renderInRouter(<RunContextPanel run={FINISHED} />);

    await waitFor(() => {
      expect(panel().getAttribute("data-run-context")).toBe("ASSEMBLED");
    });
    expect(client.GET).toHaveBeenCalledWith("/api/v1/runs/{id}/context", {
      params: { path: { id: RUN.id } },
    });

    expect(query('[data-context-status="ASSEMBLED"]')?.textContent).toBe(
      dnd["context.status.assembled"],
    );
    expect(query("[data-context-usage]")?.textContent).toContain("2.012 de 6.000 tokens");
    expect(query("[data-context-usage]")?.textContent).toContain("5 itens");

    // O medidor: o total sobre o orçamento, e cada seção sobre o teto dela.
    const total = query('[data-context-meter="total"]');
    expect(total?.getAttribute("aria-valuenow")).toBe("2012");
    expect(total?.getAttribute("aria-valuemax")).toBe("6000");
    expect(total?.getAttribute("data-context-meter-percent")).toBe("34");
    expect(
      query('[data-context-meter="KNOWLEDGE"]')?.getAttribute("data-context-meter-percent"),
    ).toBe("88");

    // As cinco seções, na ordem do registro, com o título pelo glossário.
    const sections = [...document.querySelectorAll("[data-context-section]")].map((element) =>
      element.getAttribute("data-context-section"),
    );
    expect(sections).toEqual(["SUMMARY", "KNOWLEDGE", "LINEAGE", "ARTIFACTS", "SKILLS"]);
    expect(query('[data-context-section="KNOWLEDGE"]')?.textContent).toContain(
      dnd["context.section.knowledge"],
    );

    // A Página cortada: motivo, score, tokens e a marca.
    const page = query(`[data-context-item="${ACTIVE_ITEM.id}"]`);
    expect(page?.querySelector("[data-context-item-title]")?.textContent).toBe(ACTIVE_ITEM.title);
    expect(page?.querySelector('[data-context-item-reason="FTS_MATCH"]')?.textContent).toBe(
      dnd["context.reason.ftsMatch"],
    );
    expect(page?.querySelector("[data-context-item-score]")?.textContent).toContain("0,426");
    expect(page?.querySelector("[data-context-item-tokens]")?.textContent).toContain("1.500");
    expect(page?.querySelector("[data-context-truncated]")).not.toBeNull();

    // O resumo não tem score nem corte.
    const summary = query('[data-context-item-section="SUMMARY"]');
    expect(summary?.querySelector("[data-context-item-score]")).toBeNull();
    expect(summary?.querySelector("[data-context-truncated]")).toBeNull();
    expect(
      summary?.querySelector('[data-context-item-reason="PROJECT_SUMMARY"]')?.textContent,
    ).toBe(dnd["context.reason.projectSummary"]);

    // Sem nota de herança neste registro.
    expect(query("[data-context-inherited]")).toBeNull();
  });

  it("liga cada item à origem: a gaveta do Grimório, a Missão, a Expedição do artefato; a skill não tem link", async () => {
    client.GET.mockResolvedValue(ok(RUN_CONTEXT) as never);

    renderInRouter(<RunContextPanel run={FINISHED} />);
    await waitFor(() => {
      expect(query(`[data-context-item-link="${ACTIVE_ITEM.id}"]`)).not.toBeNull();
    });

    expect(query(`[data-context-item-link="${ACTIVE_ITEM.id}"]`)?.getAttribute("href")).toBe(
      `/projects/${PROJECT_ID}/knowledge?tab=items&page=1&item=${ACTIVE_ITEM.id}`,
    );
    expect(query(`[data-context-item-link="${PARENT_TASK_ID}"]`)?.getAttribute("href")).toBe(
      `/tasks/${PARENT_TASK_ID}`,
    );
    expect(query(`[data-context-item-link="${PRIOR_RUN_ID}"]`)?.getAttribute("href")).toBe(
      `/runs/${PRIOR_RUN_ID}`,
    );
    expect(query('[data-context-item-kind="SKILL"] [data-context-item-link]')).toBeNull();
  });

  it("lista o que ficou de fora, com a seção e o motivo", async () => {
    client.GET.mockResolvedValue(ok(RUN_CONTEXT) as never);

    renderInRouter(<RunContextPanel run={FINISHED} />);
    await waitFor(() => {
      expect(query("[data-context-excluded]")?.getAttribute("data-context-excluded")).toBe("1");
    });

    const excluded = query(`[data-context-excluded-item="${EXCLUDED_ITEM_ID}"]`);
    expect(excluded?.getAttribute("data-context-excluded-reason")).toBe("SECTION_BUDGET");
    expect(excluded?.textContent).toContain(dnd["context.excluded.sectionBudget"]);
    expect(excluded?.textContent).toContain(dnd["context.section.knowledge"]);
    expect(excluded?.textContent).toContain("800 tokens");
  });

  it("o texto do bloco fica recolhido, abre como texto puro e tem botão de copiar", async () => {
    client.GET.mockResolvedValue(ok(RUN_CONTEXT) as never);
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    try {
      renderInRouter(<RunContextPanel run={FINISHED} />);
      await waitFor(() => {
        expect(query("[data-context-text-toggle]")).not.toBeNull();
      });

      expect(query("[data-context-text]")).toBeNull();
      fireEvent.click(query("[data-context-text-toggle]")!);

      const text = query("[data-context-text]");
      expect(text?.tagName).toBe("PRE");
      expect(text?.textContent).toContain("<knowledge-item id=");
      expect(text?.textContent).toContain("<script>alert(1)</script>");
      // Como texto: nenhum elemento nasceu do conteúdo.
      expect(text?.querySelector("script")).toBeNull();
      expect(text?.querySelector("knowledge-item")).toBeNull();

      fireEvent.click(query("[data-context-text-copy]")!);
      expect(writeText).toHaveBeenCalledWith(RUN_CONTEXT.text);
      await waitFor(() => {
        expect(query("[data-context-text-copy]")?.textContent).toContain(
          dnd["context.text.copied"],
        );
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("diz de qual Expedição as provisões foram herdadas, com o link", async () => {
    client.GET.mockResolvedValue(ok(INHERITED_CONTEXT) as never);

    renderInRouter(<RunContextPanel run={FINISHED} />);
    await waitFor(() => {
      expect(query("[data-context-inherited]")).not.toBeNull();
    });

    const note = query("[data-context-inherited]");
    expect(note?.getAttribute("data-context-inherited")).toBe(PRIOR_RUN_ID);
    expect(note?.textContent).toContain(dnd["context.inherited"]);
    expect(note?.querySelector("[data-context-inherited-open]")?.getAttribute("href")).toBe(
      `/runs/${PRIOR_RUN_ID}`,
    );
  });

  it("um 404 é 'ainda não montado', e não erro", async () => {
    client.GET.mockResolvedValue(notFound() as never);

    renderInRouter(<RunContextPanel run={QUEUED} />);
    await waitFor(() => {
      expect(panel().getAttribute("data-run-context")).toBe("PENDING");
    });

    expect(query('[data-context-status="PENDING"]')?.textContent).toBe(
      dnd["context.status.pending"],
    );
    expect(query("[data-context-pending]")?.textContent).toBe(dnd["context.pending.hint"]);
    expect(query("[data-context-error]")).toBeNull();
    expect(document.querySelector(".text-destructive")).toBeNull();
  });

  it("vazio e desligado explicam por que o Herói partiu só com a Missão", async () => {
    client.GET.mockResolvedValue(ok(EMPTY_CONTEXT) as never);
    const { unmount } = renderInRouter(<RunContextPanel run={FINISHED} />);
    await waitFor(() => {
      expect(panel().getAttribute("data-run-context")).toBe("EMPTY");
    });
    expect(screen.getByText(dnd["context.empty.hint"])).toBeDefined();
    expect(query("[data-context-budget]")).toBeNull();
    expect(query("[data-context-open-settings]")).toBeNull();
    unmount();
    cleanup();

    client.GET.mockResolvedValue(ok(DISABLED_CONTEXT) as never);
    renderInRouter(<RunContextPanel run={FINISHED} />);
    await waitFor(() => {
      expect(panel().getAttribute("data-run-context")).toBe("DISABLED");
    });
    expect(screen.getByText(dnd["context.disabled.hint"])).toBeDefined();
    expect(query("[data-context-open-settings]")?.getAttribute("href")).toBe("/settings");
  });

  it("uma montagem que falhou mostra o erro como texto", async () => {
    client.GET.mockResolvedValue(ok(FAILED_CONTEXT) as never);

    renderInRouter(<RunContextPanel run={FINISHED} />);
    await waitFor(() => {
      expect(panel().getAttribute("data-run-context")).toBe("FAILED");
    });

    const error = query("[data-context-error]");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent).toContain(FAILED_CONTEXT.error);
    expect(error?.querySelector("b")).toBeNull();
    expect(query('[data-context-status="FAILED"]')?.textContent).toBe(dnd["context.status.failed"]);
  });

  it("recolhe e expande, e o tema só muda o texto", async () => {
    client.GET.mockResolvedValue(ok(RUN_CONTEXT) as never);

    renderInRouter(<RunContextPanel run={FINISHED} />);
    await waitFor(() => {
      expect(query("[data-context-budget]")).not.toBeNull();
    });

    const toggle = query("[data-context-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(query("[data-context-budget]")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(query("[data-context-budget]")).not.toBeNull();

    expect(screen.getByText(dnd["context.title"])).toBeDefined();
    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });
    expect(screen.getByText(plain["context.title"])).toBeDefined();
    expect(query('[data-context-status="ASSEMBLED"]')?.textContent).toBe(
      plain["context.status.assembled"],
    );
    expect(query('[data-context-section="KNOWLEDGE"]')?.textContent).toContain(
      plain["context.section.knowledge"],
    );
  });
});
