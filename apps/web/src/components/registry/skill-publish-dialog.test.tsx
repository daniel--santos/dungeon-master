import { dnd } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillPublishDialog } from "@/components/registry/skill-publish-dialog";
import { api } from "@/lib/api";
import { ok } from "@/test/execution-fixtures";
import { SKILL_DETAIL, SKILL_V2 } from "@/test/registry-fixtures";

/**
 * Publicar uma versão de Habilidade (Fase 8C): o editor abre com o texto da
 * mais recente, a nota é obrigatória, o envio leva o CAS, e o `409` fica no
 * diálogo com o texto preservado.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function montar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenChange = vi.fn();
  const onPublished = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <SkillPublishDialog
        onOpenChange={onOpenChange}
        onPublished={onPublished}
        skill={SKILL_DETAIL}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onPublished };
}

describe("publicar uma versão de Habilidade", () => {
  it("abre com o texto da versão mais recente e só publica com texto novo e nota", async () => {
    montar();

    const content = (await screen.findByLabelText(
      dnd["skill.content.title"],
    )) as HTMLTextAreaElement;
    expect(content.value).toBe(SKILL_V2.content);
    expect(screen.getByText(dnd["skill.publish.unchanged"])).toBeDefined();

    const publish = screen.getByRole("button", { name: "Publicar v3" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);

    fireEvent.change(content, { target: { value: `${SKILL_V2.content}\nUma linha nova.` } });
    expect(publish.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(dnd["skill.publish.changelog"]), {
      target: { value: "Uma linha a mais." },
    });
    expect(publish.disabled).toBe(false);
  });

  it("envia o texto, a nota e o CAS da versão lida; publicado, fecha e avisa", async () => {
    client.POST.mockResolvedValue(
      ok({ ...SKILL_V2, id: "v3", version: 3, changelog: "Uma linha a mais." }) as never,
    );
    const { onOpenChange, onPublished } = montar();

    const content = (await screen.findByLabelText(
      dnd["skill.content.title"],
    )) as HTMLTextAreaElement;
    fireEvent.change(content, { target: { value: "# Novo texto" } });
    fireEvent.change(screen.getByLabelText(dnd["skill.publish.changelog"]), {
      target: { value: "Uma linha a mais." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publicar v3" }));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/skills/{id}/versions", {
        params: { path: { id: SKILL_DETAIL.id } },
        body: { content: "# Novo texto", changelog: "Uma linha a mais.", expectedLatestVersion: 2 },
      });
    });
    await waitFor(() => {
      expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("um 409 do CAS fica no diálogo, com o texto editado preservado", async () => {
    client.POST.mockResolvedValue({
      data: undefined,
      error: {
        type: "about:blank",
        title: "Conflito",
        status: 409,
        detail: "A versão mais recente já não é a v2.",
      },
      response: new Response(null, { status: 409 }),
    } as never);
    const { onOpenChange } = montar();

    const content = (await screen.findByLabelText(
      dnd["skill.content.title"],
    )) as HTMLTextAreaElement;
    fireEvent.change(content, { target: { value: "# Texto que quase se perdeu" } });
    fireEvent.change(screen.getByLabelText(dnd["skill.publish.changelog"]), {
      target: { value: "Nota." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publicar v3" }));

    const conflict = await waitFor(() => {
      const element = document.querySelector("[data-skill-publish-conflict]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(conflict.getAttribute("role")).toBe("alert");
    expect(conflict.textContent).toContain("A versão mais recente já não é a v2.");
    expect(content.value).toBe("# Texto que quase se perdeu");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
