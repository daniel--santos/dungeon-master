import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompatibilityPanel,
  type CompatibilityDraft,
} from "@/components/execution/compatibility-panel";
import { api } from "@/lib/api";
import { useGlossaryStore } from "@/lib/glossary";
import { useProviderAuthStore } from "@/lib/provider-auth";
import { HARNESS, LOADOUT, ok } from "@/test/execution-fixtures";
import {
  DOCKER_BLOCKER,
  MCP_WARNING,
  PREFLIGHT_BLOCKED,
  PREFLIGHT_OK,
  PREFLIGHT_WARNINGS,
} from "@/test/registry-fixtures";

/**
 * O painel de compatibilidade do Equipamento (Fase 8C): a prévia pela matriz
 * enquanto o rascunho difere do salvo, e o relatório completo do preflight —
 * bloqueios, avisos, CLI e Patronato — quando o que está na tela é o que está
 * gravado.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const CLEAN: CompatibilityDraft = {
  capabilities: HARNESS.capabilities,
  mode: "HOST",
  mcpServerNames: [],
  modelKey: null,
  commandToolNames: [],
  dirty: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
    useProviderAuthStore.getState().reset();
  });
});

function montar(props: Partial<Parameters<typeof CompatibilityPanel>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CompatibilityPanel
        draft={CLEAN}
        executionProfileId={undefined}
        loadout={{ id: LOADOUT.id, version: LOADOUT.version }}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const panel = () => document.querySelector("[data-loadout-compat]") as HTMLElement;

describe("painel de compatibilidade", () => {
  it("chama o preflight do Equipamento salvo e diz que está pronto", async () => {
    client.GET.mockResolvedValue(ok(PREFLIGHT_OK) as never);
    montar();

    await waitFor(() => {
      expect(panel().getAttribute("data-loadout-compat")).toBe("ready");
    });
    expect(client.GET).toHaveBeenCalledWith("/api/v1/loadouts/{id}/preflight", {
      params: { path: { id: LOADOUT.id }, query: {} },
    });
    expect(panel().textContent).toContain(dnd["loadout.compat.none"]);
    expect(panel().querySelector("[data-loadout-compat-cli]")?.textContent).toContain(
      "claude-code@host",
    );
    expect(panel().querySelector('[data-provider-auth="CLI_AUTHENTICATED"]')?.textContent).toBe(
      dnd["provider.auth.cliAuthenticated"],
    );
    // O Patronato visto fica guardado para a tela de Patronatos.
    expect(
      useProviderAuthStore.getState().entries[PREFLIGHT_OK.provider!.providerId]?.auth.status,
    ).toBe("CLI_AUTHENTICATED");
  });

  it("um bloqueio do preflight aparece pelo código, com a mensagem canônica", async () => {
    client.GET.mockResolvedValue(ok(PREFLIGHT_BLOCKED) as never);
    montar();

    await waitFor(() => {
      expect(panel().getAttribute("data-loadout-compat")).toBe("blocked");
    });
    const issue = panel().querySelector(`[data-capability-issue="${DOCKER_BLOCKER.code}"]`);
    expect(issue?.textContent).toContain(dnd["capability.code.dockerUnsupported"]);
    expect(issue?.textContent).toContain(DOCKER_BLOCKER.message);
    expect(issue?.textContent).toContain(dnd["capability.severity.blocker"]);
    expect(panel().querySelector("[data-loadout-compat-docker]")).not.toBeNull();
  });

  it("um aviso deixa o veredito em pendências, e o perfil da tela vai como override", async () => {
    client.GET.mockResolvedValue(ok(PREFLIGHT_WARNINGS) as never);
    montar({ executionProfileId: "0199cccc-0000-7000-8000-000000000002" });

    await waitFor(() => {
      expect(panel().getAttribute("data-loadout-compat")).toBe("pending");
    });
    expect(client.GET).toHaveBeenCalledWith("/api/v1/loadouts/{id}/preflight", {
      params: {
        path: { id: LOADOUT.id },
        query: { executionProfileId: "0199cccc-0000-7000-8000-000000000002" },
      },
    });
    expect(
      panel().querySelector(`[data-capability-issue="${MCP_WARNING.code}"]`)?.textContent,
    ).toContain(dnd["capability.severity.warning"]);
  });

  it("com o rascunho diferente do salvo, mostra a prévia pela matriz e não chama a API", async () => {
    montar({
      draft: {
        ...CLEAN,
        capabilities: { ...HARNESS.capabilities, dockerExecution: false, mcpServers: false },
        mode: "DOCKER",
        mcpServerNames: ["knowledge"],
        dirty: true,
      },
    });

    await waitFor(() => {
      expect(panel().getAttribute("data-loadout-compat")).toBe("blocked");
    });
    expect(client.GET).not.toHaveBeenCalled();
    const preview = panel().querySelector("[data-loadout-compat-preview]");
    expect(preview?.querySelector('[data-capability-issue="DOCKER_UNSUPPORTED"]')).not.toBeNull();
    expect(preview?.querySelector('[data-capability-issue="MCP_UNSUPPORTED"]')).not.toBeNull();
    expect(preview?.textContent).toContain(dnd["loadout.compat.unsaved"]);

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });
    expect(screen.getByText(plain["loadout.compat.unsaved"])).toBeDefined();
  });

  it("um Equipamento novo só tem prévia, sem botão de verificar", async () => {
    montar({ loadout: null, draft: { ...CLEAN, dirty: true } });
    await waitFor(() => {
      expect(panel().getAttribute("data-loadout-compat")).toBe("preview");
    });
    expect(document.querySelector("[data-loadout-compat-check]")).toBeNull();
    expect(client.GET).not.toHaveBeenCalled();
  });
});
