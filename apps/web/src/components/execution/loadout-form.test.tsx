import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LoadoutForm } from "@/components/execution/loadout-form";
import { api } from "@/lib/api";
import type { HarnessRecord } from "@/lib/api-types";
import { useGlossaryStore } from "@/lib/glossary";
import { AGENT, HARNESS, HOST_PROFILE, LOADOUT, ok } from "@/test/execution-fixtures";

/**
 * O aviso de permissão da tela de Equipamento.
 *
 * Dirigido pela capability, e não pelo nome: qualquer Harness com
 * `nativePermissions: false` mostra o aviso, e só o Antigravity ganha o
 * parágrafo do bypass, porque é o único que nega tudo em vez de deixar tudo
 * passar. O texto vem do glossário e muda com o tema; a matriz vem da API.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const ANTIGRAVITY: HarnessRecord = {
  ...HARNESS,
  id: "0199bbbb-0000-7000-8000-000000000004",
  key: "ANTIGRAVITY",
  name: "Antigravity CLI",
  capabilities: {
    ...HARNESS.capabilities,
    agentSelection: false,
    nativePermissions: false,
    dockerExecution: false,
  },
};

const PI: HarnessRecord = {
  ...HARNESS,
  id: "0199bbbb-0000-7000-8000-000000000003",
  key: "PI",
  name: "Pi",
  capabilities: { ...HARNESS.capabilities, nativePermissions: false },
};

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

function montar(loadout: Parameters<typeof LoadoutForm>[0]["loadout"] = null) {
  client.GET.mockImplementation(((path: string) => {
    switch (path) {
      case "/api/v1/agents":
        return Promise.resolve(ok({ items: [AGENT] }));
      case "/api/v1/harnesses":
        return Promise.resolve(ok({ items: [HARNESS, PI, ANTIGRAVITY] }));
      case "/api/v1/execution-profiles":
        return Promise.resolve(ok({ items: [HOST_PROFILE] }));
      default:
        return Promise.resolve(ok({ items: [] }));
    }
  }) as never);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LoadoutForm loadout={loadout} onCancel={vi.fn()} onSaved={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function escolherHarness(name: string): Promise<void> {
  const trigger = await waitFor(() => {
    const element = screen.getByLabelText(dnd["entity.harness"]) as HTMLButtonElement;
    expect(element.disabled).toBe(false);
    return element;
  });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name }));
}

const aviso = () => document.querySelector("[data-loadout-permission-warning]");

describe("aviso de permissão do Equipamento", () => {
  it("aparece só quando o Harness escolhido não tem permissão nativa", async () => {
    montar();

    // O primeiro Harness ligado é o Claude Code, que tem permissão nativa.
    await waitFor(() => {
      expect(screen.getByLabelText(dnd["entity.harness"]).textContent).toContain(HARNESS.name);
    });
    expect(aviso()).toBeNull();

    await escolherHarness(ANTIGRAVITY.name);
    expect(aviso()?.getAttribute("data-loadout-permission-warning")).toBe("ANTIGRAVITY");
    expect(screen.getByText(dnd["loadout.noNativePermissions.title"])).toBeTruthy();

    // O parágrafo do bypass cita o modo host com o aviso de isolamento e o
    // nome canônico do erro, no tema.
    const bypass = document.querySelector("[data-loadout-permission-bypass]");
    expect(bypass?.textContent).toContain(dnd["env.host"]);
    expect(bypass?.textContent).toContain(dnd["env.host.warning"]);
    expect(bypass?.textContent).toContain("PERMISSION_DENIED");
    expect(bypass?.textContent).toContain("allowUnsafeBypass");

    await escolherHarness(PI.name);
    expect(aviso()?.getAttribute("data-loadout-permission-warning")).toBe("PI");
    expect(document.querySelector("[data-loadout-permission-bypass]")).toBeNull();

    await escolherHarness(HARNESS.name);
    expect(aviso()).toBeNull();
  });

  it("hidrata a política de contexto do Equipamento e a grava junto com o resto", async () => {
    client.PATCH.mockResolvedValue(ok({ ...LOADOUT, version: LOADOUT.version + 1 }) as never);
    montar({
      ...LOADOUT,
      knowledgePolicy: { includeProjectSummary: true, includeDecisions: false, maxItems: 4 },
      contextPolicy: { includeParentContext: false, includeDependencyContext: true, maxTokens: 0 },
    });

    const policy = await waitFor(() => {
      const element = document.querySelector("[data-loadout-policy]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(policy.textContent).toContain(dnd["loadout.policy.title"]);
    expect(policy.textContent).toContain(dnd["loadout.policy.includeProjectSummary"]);

    const toggle = (name: string) =>
      policy.querySelector(`[data-loadout-policy-switch="${name}"]`) as HTMLButtonElement;
    const field = (name: string) =>
      policy.querySelector(`[data-loadout-policy-field="${name}"]`) as HTMLInputElement;

    expect(toggle("includeProjectSummary").getAttribute("data-state")).toBe("checked");
    expect(toggle("includeDecisions").getAttribute("data-state")).toBe("unchecked");
    expect(toggle("includeParentContext").getAttribute("data-state")).toBe("unchecked");
    expect(toggle("includeDependencyContext").getAttribute("data-state")).toBe("checked");
    expect(field("maxItems").value).toBe("4");
    expect(field("maxTokens").value).toBe("0");

    // Um teto que não é inteiro trava o salvar; um inteiro destrava.
    fireEvent.change(field("maxItems"), { target: { value: "x" } });
    const salvar = screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(salvar.disabled).toBe(true);
    });
    fireEvent.change(field("maxItems"), { target: { value: "6" } });
    fireEvent.click(toggle("includeDecisions"));
    fireEvent.change(field("maxTokens"), { target: { value: "3000" } });
    await waitFor(() => {
      expect(salvar.disabled).toBe(false);
    });

    fireEvent.click(salvar);
    await waitFor(() => {
      expect(client.PATCH).toHaveBeenCalledTimes(1);
    });
    const [, request] = client.PATCH.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(request.body["knowledgePolicy"]).toEqual({
      includeProjectSummary: true,
      includeDecisions: true,
      maxItems: 6,
    });
    expect(request.body["contextPolicy"]).toEqual({
      includeParentContext: false,
      includeDependencyContext: true,
      maxTokens: 3000,
    });
  });

  it("num Equipamento existente, o aviso já vem aberto, e troca de texto com o tema", async () => {
    montar({ ...LOADOUT, harnessId: ANTIGRAVITY.id });

    expect(await screen.findByText(dnd["loadout.noNativePermissions.title"])).toBeTruthy();
    expect(screen.getByText(dnd["loadout.noNativePermissions.title"]).textContent).toContain(
      dnd["entity.harness"],
    );

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });

    expect(screen.getByText(plain["loadout.noNativePermissions.title"])).toBeTruthy();
    expect(screen.queryByText(dnd["loadout.noNativePermissions.title"])).toBeNull();
    // Os nomes canônicos de código não mudam com o tema.
    expect(document.querySelector("[data-loadout-permission-bypass]")?.textContent).toContain(
      "PERMISSION_DENIED",
    );
  });
});
