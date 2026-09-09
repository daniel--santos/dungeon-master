import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunOutcomePanel } from "@/components/run/run-outcome-panel";
import { api } from "@/lib/api";
import { ok, RUN } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * O resumo do que a Expedição trouxe.
 *
 * O painel some quando não há proposta nem candidato — e é justamente por isso
 * que uma leitura que falhou não pode ser tratada como "não trouxe nada": o
 * usuário leria a ausência como um fato sobre a Expedição.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const EMPTY = { items: [], page: 1, pageSize: 50, total: 0 };

/** Uma recusa da API no formato problem details, como `openapi-fetch` a devolve. */
function problem(detail: string) {
  return {
    data: undefined,
    error: { type: "about:blank", title: "Erro interno", status: 500, detail },
    response: new Response(null, { status: 500 }),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("painel do desfecho da Expedição", () => {
  it("some quando a Expedição não propôs nem aprendeu nada", async () => {
    client.GET.mockResolvedValue(ok(EMPTY) as never);

    renderInRouter(<RunOutcomePanel run={RUN} />);

    await waitFor(() => {
      expect(client.GET).toHaveBeenCalledTimes(2);
    });
    expect(document.querySelector("[data-run-outcome]")).toBeNull();
  });

  it("diz que a leitura falhou em vez de fingir que não veio nada", async () => {
    client.GET.mockImplementation(((path: string) =>
      Promise.resolve(
        path === "/api/v1/knowledge-candidates"
          ? problem("O banco recusou a consulta de candidatos.")
          : ok(EMPTY),
      )) as never);

    renderInRouter(<RunOutcomePanel run={RUN} />);

    expect(await screen.findByText(/O banco recusou a consulta de candidatos\./)).toBeTruthy();
    expect(document.querySelector("[data-run-outcome]")).not.toBeNull();
  });

  it("a falha ao ler as propostas também aparece", async () => {
    client.GET.mockImplementation(((path: string) =>
      Promise.resolve(
        path === "/api/v1/proposed-tasks"
          ? problem("O banco recusou a consulta de propostas.")
          : ok(EMPTY),
      )) as never);

    renderInRouter(<RunOutcomePanel run={RUN} />);

    expect(await screen.findByText(/O banco recusou a consulta de propostas\./)).toBeTruthy();
  });
});
