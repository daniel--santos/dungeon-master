import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeList, type KnowledgeFilterValue } from "@/components/knowledge/knowledge-list";
import { api } from "@/lib/api";
import { ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A busca do Grimório espera 300 ms depois da última tecla antes de ir à URL
 * e à API.
 *
 * O que se prende aqui é que a espera conta a partir da **tecla**, e não a
 * partir da última renderização do pai: com o Distiller rodando, cada evento
 * `knowledge.*` re-renderiza a rota, e um timer reiniciado a cada evento nunca
 * chegaria ao fim.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const PROJECT_ID = "0199bbbb-0000-7000-8000-000000000001";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

/**
 * A rota monta `filters` a cada render, e não uma vez: é assim que o objeto
 * chega ao componente na tela de verdade.
 */
function Rota({ onChange }: { readonly onChange: (next: KnowledgeFilterValue) => void }) {
  const [, redesenhar] = useState(0);
  redesenharRota = () => {
    redesenhar((n) => n + 1);
  };
  const filters: KnowledgeFilterValue = { page: 1 };
  return <KnowledgeList onChange={onChange} projectId={PROJECT_ID} value={filters} />;
}

let redesenharRota = () => undefined as void;

describe("busca do Grimório", () => {
  it("a espera conta da última tecla, e não da última renderização do pai", () => {
    client.GET.mockResolvedValue(ok({ items: [], page: 1, pageSize: 20, total: 0 }) as never);
    const onChange = vi.fn();

    renderInRouter(<Rota onChange={onChange} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "forja" } });

    // Um evento do stream re-renderiza a rota no meio da espera.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      redesenharRota();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onChange).toHaveBeenCalledWith({ page: 1, q: "forja" });
  });

  it("não vai ao servidor antes dos 300 ms", () => {
    client.GET.mockResolvedValue(ok({ items: [], page: 1, pageSize: 20, total: 0 }) as never);
    const onChange = vi.fn();

    renderInRouter(<Rota onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "forja" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
