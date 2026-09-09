import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { achievementKeys, useUnlocks } from "@/lib/achievements";
import { api } from "@/lib/api";
import { ok } from "@/test/execution-fixtures";

/**
 * A paginação da Crônica.
 *
 * O Hall e a aba Crônica leem a mesma rota com tamanhos de página diferentes —
 * 50 para decidir o ponto de "ainda não vista", 25 para a lista. Se a chave não
 * carregar o tamanho, as duas telas dividem a mesma entrada de cache e a
 * janela de recentes encolhe (ou a paginação desalinha), conforme quem chegar
 * primeiro.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

function Wrapper({ children }: { readonly children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** O Hall e a Crônica, na mesma página, como acontece em `/hall`. */
function HallEChronica() {
  useUnlocks({ page: 1, pageSize: 50 });
  useUnlocks({ page: 1, pageSize: 25 });
  return null;
}

/** Os `pageSize` pedidos ao servidor, na ordem. */
const pedidos = () =>
  client.GET.mock.calls.map(
    (call) => (call[1] as { params: { query: { pageSize?: string } } }).params.query.pageSize,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useUnlocks", () => {
  it("o tamanho da página entra na chave", () => {
    expect(achievementKeys.unlockPage(1, 50)).not.toEqual(achievementKeys.unlockPage(1, 25));
  });

  it("duas telas com tamanhos diferentes não dividem a mesma entrada de cache", async () => {
    client.GET.mockResolvedValue(ok({ items: [], page: 1, pageSize: 50, total: 0 }) as never);

    render(
      <Wrapper>
        <HallEChronica />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(client.GET).toHaveBeenCalledTimes(2);
    });
    expect(pedidos().sort()).toEqual(["25", "50"]);
  });
});
