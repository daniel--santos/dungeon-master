import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useHydratedForm } from "@/lib/hydrated-form";

/**
 * O hook que hidrata um formulário do servidor sem apagar o que está sendo
 * digitado (post-mortem #15 e #16).
 *
 * Os testes exercitam a sequência que quebrava na tela: o valor chega, o
 * usuário digita, uma releitura devolve outro objeto — e o que ele escreveu
 * continua lá.
 */

interface Form {
  readonly title: string;
  readonly path: string;
}

afterEach(() => {
  cleanup();
});

describe("useHydratedForm", () => {
  it("fica nulo até a leitura voltar e então hidrata", () => {
    const { result, rerender } = renderHook(
      ({ server }: { server: Form | undefined }) => useHydratedForm(server),
      { initialProps: { server: undefined as Form | undefined } },
    );

    expect(result.current.value).toBeNull();

    rerender({ server: { title: "Forja", path: "/d/forja" } });
    expect(result.current.value).toEqual({ title: "Forja", path: "/d/forja" });
    expect(result.current.dirty).toBe(false);
  });

  it("uma mudança de fora chega ao formulário que ninguém tocou", () => {
    const { result, rerender } = renderHook(
      ({ server }: { server: Form }) => useHydratedForm(server),
      { initialProps: { server: { title: "Forja", path: "/d/forja" } } },
    );

    rerender({ server: { title: "Forja Nova", path: "/d/forja" } });
    expect(result.current.value?.title).toBe("Forja Nova");
  });

  it("uma releitura não apaga a edição pendente", () => {
    const { result, rerender } = renderHook(
      ({ server }: { server: Form }) => useHydratedForm(server),
      { initialProps: { server: { title: "Forja", path: "/d/forja" } } },
    );

    act(() => {
      result.current.set({ title: "Forja", path: "/d/forja/martelo" });
    });
    expect(result.current.dirty).toBe(true);

    // A releitura devolve outro objeto, com outro conteúdo: é a invalidação
    // que chegava enquanto o usuário digitava.
    rerender({ server: { title: "Forja Nova", path: "/d/forja" } });

    expect(result.current.value).toEqual({ title: "Forja", path: "/d/forja/martelo" });
  });

  it("uma releitura de mesmo conteúdo não recria o valor local", () => {
    const { result, rerender } = renderHook(
      ({ server }: { server: Form }) => useHydratedForm(server),
      { initialProps: { server: { title: "Forja", path: "/d/forja" } } },
    );

    const first = result.current.value;
    rerender({ server: { title: "Forja", path: "/d/forja" } });

    expect(result.current.value).toBe(first);
  });

  it("trocar a chave de reinício descarta a edição e hidrata de novo", () => {
    const { result, rerender } = renderHook(
      ({ server, key }: { server: Form; key: string }) => useHydratedForm(server, key),
      { initialProps: { server: { title: "Forja", path: "/d/forja" }, key: "closed" } },
    );

    act(() => {
      result.current.set({ title: "rascunho", path: "" });
    });

    rerender({ server: { title: "Forja", path: "/d/forja" }, key: "aberto" });

    expect(result.current.value).toEqual({ title: "Forja", path: "/d/forja" });
    expect(result.current.dirty).toBe(false);
  });
});
