import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PolicyDialog } from "@/components/autonomy/policy-dialog";
import { api } from "@/lib/api";
import { AUTONOMY_LEVEL_2, AUTONOMY_LEVEL_3, POLICY, PROJECT_ID } from "@/test/autonomy-fixtures";
import { HARNESS, LOADOUT, ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * O formulário de política (Fase 9C): as condições fechadas viram o JSON
 * que a API recebe, a frase do fail-closed fica sempre à vista, e uma
 * política que aprova sozinha abaixo do nível 3 é dita inerte enquanto se
 * edita.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const RESPONSES: Record<string, unknown> = {
  "/api/v1/loadouts": { items: [LOADOUT] },
  "/api/v1/harnesses": { items: [HARNESS] },
  "/api/v1/projects": { items: [], page: 1, pageSize: 100, total: 0 },
};

afterEach(() => {
  cleanup();
});

function abrir(autonomy = AUTONOMY_LEVEL_3, policy?: typeof POLICY) {
  client.GET.mockImplementation(((path: string) =>
    Promise.resolve(ok(RESPONSES[path] ?? {}))) as never);
  client.POST.mockResolvedValue(ok(POLICY) as never);
  client.PATCH.mockResolvedValue(ok(POLICY) as never);

  renderInRouter(
    <PolicyDialog
      autonomy={autonomy}
      onOpenChange={vi.fn()}
      open
      policy={policy}
      projectId={PROJECT_ID}
      projectTitle="Forja de Widgets"
    />,
  );
}

describe("o formulário de Édito", () => {
  it("diz que sem regra que case a decisão é revisão humana", () => {
    abrir();
    expect(document.querySelector("[data-policy-fail-closed]")?.textContent).toBe(
      dnd["autonomy.failClosed"],
    );
  });

  it("uma política que aprova sozinha abaixo do nível 3 é dita inerte", async () => {
    abrir(AUTONOMY_LEVEL_2, POLICY);

    const inert = await waitFor(() => {
      const element = document.querySelector("[data-policy-inert]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(inert.textContent).toContain(dnd["policy.inert"]);
    expect(inert.textContent).toContain(dnd["policy.inert.hint"]);
  });

  it("no nível 3 a mesma política não é inerte", () => {
    abrir(AUTONOMY_LEVEL_3, POLICY);
    expect(document.querySelector("[data-policy-inert]")).toBeNull();
  });

  it("as condições ligadas viram o JSON fechado que a API recebe", async () => {
    abrir();

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Só Monstros" } });

    // Liga o tipo da Missão e escolhe BUG e RESEARCH: "qualquer um destes".
    const taskKind = document.querySelector('[data-condition="taskKind"]') as HTMLElement;
    fireEvent.click(taskKind.querySelector('button[role="checkbox"]') as HTMLElement);
    await waitFor(() => {
      expect(taskKind.getAttribute("data-condition-enabled")).toBe("true");
    });
    // Sem valor, a lista ligada é inválida e o botão fica desabilitado.
    expect(taskKind.querySelector("[data-condition-invalid]")).not.toBeNull();
    const save = document.querySelector("[data-policy-save]") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(
      taskKind.querySelector(
        '[data-condition-option="BUG"] button[role="checkbox"]',
      ) as HTMLElement,
    );
    fireEvent.click(
      taskKind.querySelector(
        '[data-condition-option="RESEARCH"] button[role="checkbox"]',
      ) as HTMLElement,
    );
    await waitFor(() => {
      expect(taskKind.querySelector("[data-condition-invalid]")).toBeNull();
    });

    // Liga o booleano dos Itens de comando, que nasce como "sim".
    const commandTools = document.querySelector(
      '[data-condition="hasCommandTools"]',
    ) as HTMLElement;
    fireEvent.click(commandTools.querySelector('button[role="checkbox"]') as HTMLElement);

    await waitFor(() => {
      expect(save.disabled).toBe(false);
    });
    fireEvent.click(save);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/approval-policies", {
        body: {
          name: "Só Monstros",
          subject: "PROPOSAL",
          action: "REQUIRE_APPROVAL",
          priority: 100,
          projectId: PROJECT_ID,
          conditions: { taskKind: ["BUG", "RESEARCH"], hasCommandTools: true },
          enabled: true,
        },
      });
    });
  });

  it("editar manda as condições como estão gravadas", async () => {
    abrir(AUTONOMY_LEVEL_3, POLICY);

    const taskKind = document.querySelector('[data-condition="taskKind"]') as HTMLElement;
    expect(taskKind.getAttribute("data-condition-enabled")).toBe("true");
    expect(
      taskKind
        .querySelector('[data-condition-option="CHORE"]')
        ?.getAttribute("data-condition-option-on"),
    ).toBe("true");

    fireEvent.click(document.querySelector("[data-policy-save]") as HTMLElement);

    await waitFor(() => {
      expect(client.PATCH).toHaveBeenCalledWith("/api/v1/approval-policies/{id}", {
        params: { path: { id: POLICY.id } },
        body: {
          name: POLICY.name,
          subject: "PROPOSAL",
          action: "AUTO_APPROVE",
          priority: 100,
          projectId: PROJECT_ID,
          conditions: { taskKind: ["CHORE"], hasCommandTools: false },
          enabled: true,
        },
      });
    });
  });
});
