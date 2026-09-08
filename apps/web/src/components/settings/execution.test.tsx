import { dnd } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExecutionSection } from "@/components/settings/execution";
import { api } from "@/lib/api";
import type { DockerPreflightRecord } from "@/lib/api-types";
import { DOCKER_PROFILE, HARNESS, HOST_PROFILE, ok } from "@/test/execution-fixtures";

/**
 * O bloco de Execução de Settings com o preflight do container.
 *
 * Duas regras sob prova: a leitura é sob demanda — abrir a tela não chama a
 * rota, só o botão chama —, e o resultado usa os mesmos estados visuais das
 * linhas de host, com o nome do harness vindo do cadastro e não do id do
 * adapter.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const PREFLIGHT: DockerPreflightRecord = {
  checkedAt: "2026-09-08T10:00:00.000Z",
  durationMs: 2_400,
  timeoutMs: 15_000,
  daemon: { reachable: true, serverVersion: "27.1.1" },
  image: { name: "dungeon-master-agent:0.2.0", present: true, user: "1000:1000" },
  problems: [],
  harnesses: [
    {
      harnessKey: "CLAUDE_CODE",
      adapterId: "claude-code@docker",
      installed: true,
      version: "claude 2.1.263",
      authenticated: true,
      timedOut: false,
      problems: [],
    },
    {
      harnessKey: "PI",
      adapterId: "pi@docker",
      installed: false,
      version: null,
      authenticated: null,
      timedOut: true,
      problems: [],
    },
  ],
};

const SEM_DAEMON: DockerPreflightRecord = {
  ...PREFLIGHT,
  daemon: { reachable: false, serverVersion: null },
  image: { ...PREFLIGHT.image, present: false, user: null },
  problems: [
    {
      code: "UNSUPPORTED_MODE",
      message: "O daemon do Docker não respondeu. Abra o Docker Desktop.",
      fatal: true,
    },
  ],
  harnesses: [{ ...PREFLIGHT.harnesses[0]!, installed: false, version: null, authenticated: null }],
};

function montar(preflight: DockerPreflightRecord) {
  client.GET.mockImplementation(((path: string) => {
    switch (path) {
      case "/api/v1/harnesses":
        return Promise.resolve(ok({ items: [HARNESS] }));
      case "/api/v1/execution-profiles":
        return Promise.resolve(ok({ items: [HOST_PROFILE, { ...DOCKER_PROFILE, enabled: true }] }));
      case "/api/v1/preflights/docker":
        return Promise.resolve(ok(preflight));
      default:
        return Promise.resolve(ok({}));
    }
  }) as never);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ExecutionSection />
    </QueryClientProvider>,
  );
}

const chamadasAoPreflight = () =>
  (client.GET.mock.calls as unknown as readonly (readonly [string])[]).filter(
    ([path]) => path === "/api/v1/preflights/docker",
  ).length;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("preflight do container em Settings", () => {
  it("só roda quando pedido, e mostra daemon, imagem e harnesses com os estados de host", async () => {
    montar(PREFLIGHT);

    expect(await screen.findByText(HARNESS.name)).toBeTruthy();
    expect(chamadasAoPreflight()).toBe(0);
    expect(
      document.querySelector("[data-docker-preflight]")?.getAttribute("data-docker-preflight"),
    ).toBe("idle");

    fireEvent.click(screen.getByRole("button", { name: "Verificar agora" }));

    await waitFor(() => {
      expect(document.querySelector('[data-docker-preflight="ok"]')).not.toBeNull();
    });
    expect(chamadasAoPreflight()).toBe(1);

    const daemon = document.querySelector('[data-docker-preflight-row="daemon"]');
    expect(daemon?.getAttribute("data-docker-preflight-ok")).toBe("true");
    expect(daemon?.textContent).toContain("27.1.1");

    const image = document.querySelector('[data-docker-preflight-row="image"]');
    expect(image?.getAttribute("data-docker-preflight-ok")).toBe("true");
    expect(image?.textContent).toContain("dungeon-master-agent:0.2.0");

    // O harness aparece com o nome do cadastro, a versão de dentro da imagem e
    // a credencial; o que não respondeu diz isso em vez de fingir uma versão.
    const claude = document.querySelector('[data-docker-preflight-harness="CLAUDE_CODE"]');
    expect(claude?.getAttribute("data-docker-preflight-ok")).toBe("true");
    expect(claude?.textContent).toContain(HARNESS.name);
    expect(claude?.textContent).toContain("claude 2.1.263");
    expect(claude?.textContent).toContain("autenticado");

    const pi = document.querySelector('[data-docker-preflight-harness="PI"]');
    expect(pi?.getAttribute("data-docker-preflight-ok")).toBe("false");
    expect(pi?.textContent).toContain("não respondeu");

    expect(screen.getByRole("button", { name: "Verificar de novo" })).toBeTruthy();
  });

  it("sem daemon, mostra o problema e as linhas ficam em falha", async () => {
    montar(SEM_DAEMON);

    await screen.findByText(HARNESS.name);
    fireEvent.click(screen.getByRole("button", { name: "Verificar agora" }));

    await waitFor(() => {
      expect(document.querySelector('[data-docker-preflight="problem"]')).not.toBeNull();
    });

    expect(screen.getByText(SEM_DAEMON.problems[0]!.message)).toBeTruthy();
    expect(
      document
        .querySelector('[data-docker-preflight-row="daemon"]')
        ?.getAttribute("data-docker-preflight-ok"),
    ).toBe("false");
    expect(
      document
        .querySelector('[data-docker-preflight-harness="CLAUDE_CODE"]')
        ?.getAttribute("data-docker-preflight-ok"),
    ).toBe("false");
    // O texto de segurança do bloco continua sendo o do glossário.
    expect(screen.getAllByText(dnd["env.docker"]).length).toBeGreaterThan(0);
  });
});
