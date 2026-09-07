import { describe, expect, it, vi } from "vitest";

import {
  isTerminalStatusWriteError,
  requireTerminalStatusWrite,
  TerminalStatusWriteError,
} from "./terminal-status-write.js";

const contexto = { runId: "01996d00-0000-7000-8000-000000000001", site: "teste.escrita" };

describe("requireTerminalStatusWrite", () => {
  it("devolve o valor quando a escrita funciona", async () => {
    await expect(requireTerminalStatusWrite(Promise.resolve("ok"), contexto)).resolves.toBe("ok");
  });

  it("converte a rejeição no marcador tipado, guardando a causa", async () => {
    const causa = new Error("conexão recusada");

    await expect(
      requireTerminalStatusWrite(Promise.reject(causa), contexto),
    ).rejects.toBeInstanceOf(TerminalStatusWriteError);

    const erro = await requireTerminalStatusWrite(Promise.reject(causa), contexto).catch(
      (e: unknown) => e as TerminalStatusWriteError,
    );

    expect(erro.cause).toBe(causa);
    expect(erro.message).toContain("conexão recusada");
  });

  it("loga o erro original com o runId e o site, uma vez", async () => {
    const error = vi.fn();

    await requireTerminalStatusWrite(Promise.reject(new Error("boom")), {
      ...contexto,
      logger: { error },
    }).catch(() => undefined);

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatchObject({ runId: contexto.runId, site: contexto.site });
  });

  it("não exige logger", async () => {
    await expect(
      requireTerminalStatusWrite(Promise.reject(new Error("boom")), contexto),
    ).rejects.toBeInstanceOf(TerminalStatusWriteError);
  });
});

describe("isTerminalStatusWriteError", () => {
  it("reconhece o erro pelo nome, sem instanceof", () => {
    // Duas cópias do pacote no node_modules dariam duas classes diferentes, e o
    // `instanceof` falharia justamente no caminho que não pode falhar.
    const forasteiro = new Error("Falha ao persistir o status terminal do Run: x");
    forasteiro.name = "TerminalStatusWriteError";

    expect(isTerminalStatusWriteError(forasteiro)).toBe(true);
    expect(isTerminalStatusWriteError(new TerminalStatusWriteError("x"))).toBe(true);
  });

  it("não confunde com um erro comum", () => {
    expect(isTerminalStatusWriteError(new Error("boom"))).toBe(false);
    expect(isTerminalStatusWriteError("boom")).toBe(false);
  });
});
