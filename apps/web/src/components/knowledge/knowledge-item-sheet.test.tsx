import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KnowledgeItemSheet } from "@/components/knowledge/knowledge-item-sheet";
import { api } from "@/lib/api";
import { ok, TASK } from "@/test/execution-fixtures";
import {
  ACTIVE_ITEM,
  BATCH_ID,
  CANDIDATE,
  candidatePage,
  MERGED_CANDIDATE,
  MERGED_CANDIDATE_ID,
  PENDING_ITEM,
  SUMMARY_ITEM,
} from "@/test/knowledge-fixtures";
import { PROJECT_ID } from "@/test/proposal-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A gaveta de detalhe: conteúdo como texto com as quebras de linha, a
 * proveniência com os links para a Expedição, a Missão e o lote, os
 * candidatos fundidos pelo nome, e as ações que mudam com o estado.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const ROUTE = `/projects/${PROJECT_ID}/knowledge`;

function montar(item: typeof PENDING_ITEM) {
  client.GET.mockImplementation(((
    path: string,
    options?: { params?: { path?: { id?: string } } },
  ) => {
    switch (path) {
      case "/api/v1/knowledge-items/{id}":
        return Promise.resolve(ok(options?.params?.path?.id === item.id ? item : ACTIVE_ITEM));
      case "/api/v1/knowledge-candidates":
        return Promise.resolve(ok(candidatePage([CANDIDATE, MERGED_CANDIDATE])));
      case "/api/v1/tasks/{id}":
        return Promise.resolve(ok(TASK));
      default:
        return Promise.resolve(ok({}));
    }
  }) as never);

  const onOpenChange = vi.fn();
  renderInRouter(
    <KnowledgeItemSheet itemId={item.id} onOpenChange={onOpenChange} projectId={PROJECT_ID} />,
    ROUTE,
  );
  return { onOpenChange };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("gaveta do item", () => {
  it("mostra o conteúdo como texto e a proveniência com os três links", async () => {
    montar(PENDING_ITEM);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog.textContent).toContain(PENDING_ITEM.title);
    });

    const content = dialog.querySelector("[data-knowledge-sheet-content]");
    expect(content?.textContent).toBe(PENDING_ITEM.content);
    expect(content?.querySelector("script")).toBeNull();
    expect(content?.className).toContain("whitespace-pre-wrap");

    const provenance = dialog.querySelector("[data-knowledge-provenance]");
    expect(provenance?.textContent).toContain(dnd["knowledge.provenance.title"]);
    expect(
      provenance
        ?.querySelector(`[data-knowledge-provenance-run="${PENDING_ITEM.provenance.runId}"]`)
        ?.getAttribute("href"),
    ).toBe(`/runs/${PENDING_ITEM.provenance.runId}`);
    expect(
      provenance
        ?.querySelector(`[data-knowledge-provenance-task="${PENDING_ITEM.provenance.taskId}"]`)
        ?.getAttribute("href"),
    ).toBe(`/tasks/${PENDING_ITEM.provenance.taskId}`);
    expect(
      provenance
        ?.querySelector(`[data-knowledge-provenance-batch="${BATCH_ID}"]`)
        ?.getAttribute("href"),
    ).toContain("tab=batches");

    // A Missão de origem aparece pelo título, e o candidato fundido pelo nome.
    await waitFor(() => {
      expect(provenance?.textContent).toContain(TASK.title);
    });
    await waitFor(() => {
      expect(
        provenance?.querySelector(`[data-knowledge-merged-candidate="${MERGED_CANDIDATE_ID}"]`)
          ?.textContent,
      ).toBe(MERGED_CANDIDATE.title);
    });

    // Em revisão: as três decisões, e nenhum arquivar.
    const actions = dialog.querySelector("[data-knowledge-sheet-actions]");
    expect(actions?.querySelector('[data-knowledge-decision="approve"]')).not.toBeNull();
    expect(actions?.querySelector('[data-knowledge-decision="edit-approve"]')).not.toBeNull();
    expect(actions?.querySelector('[data-knowledge-decision="reject"]')).not.toBeNull();
    expect(actions?.querySelector('[data-knowledge-decision="archive"]')).toBeNull();
  });

  it("um item ativo oferece corrigir e arquivar, e arquivar pede confirmação", async () => {
    montar(ACTIVE_ITEM);
    client.PATCH.mockResolvedValue(
      ok({ ...ACTIVE_ITEM, status: "ARCHIVED", archivedAt: "2026-09-08T13:00:00.000Z" }) as never,
    );

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog.textContent).toContain(ACTIVE_ITEM.title);
    });
    expect(dialog.textContent).toContain(ACTIVE_ITEM.reviewNote ?? "");

    fireEvent.click(dialog.querySelector('[data-knowledge-decision="archive"]') as HTMLElement);

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toContain(dnd["knowledge.archive.title"]);
    expect(client.PATCH).not.toHaveBeenCalled();

    fireEvent.click(confirm.querySelector('[data-knowledge-confirm="archive"]') as HTMLElement);
    await waitFor(() => {
      expect(client.PATCH).toHaveBeenCalledWith("/api/v1/knowledge-items/{id}", {
        params: { path: { id: ACTIVE_ITEM.id } },
        body: { archived: true },
      });
    });
  });

  it("o resumo lista as Páginas cobertas pelo título e não oferece arquivar", async () => {
    montar(SUMMARY_ITEM);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog.textContent).toContain(SUMMARY_ITEM.title);
    });
    expect(dialog.textContent).toContain(dnd["knowledge.provenance.none"]);
    await waitFor(() => {
      expect(dialog.querySelector("[data-knowledge-covered]")?.textContent).toContain(
        ACTIVE_ITEM.title,
      );
    });
    expect(dialog.querySelector('[data-knowledge-decision="archive"]')).toBeNull();
    expect(dialog.querySelector('[data-knowledge-decision="edit"]')).not.toBeNull();
  });
});
