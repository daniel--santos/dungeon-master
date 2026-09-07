import { describe, expect, it } from "vitest";

import { capabilities, NO_CAPABILITIES } from "./capabilities.js";
import type { HarnessAdapter } from "./harness.js";
import { createHarnessRegistry } from "./registry.js";
import { createAsyncQueue } from "./async-queue.js";

function stub(id: string, key: HarnessAdapter["key"]): HarnessAdapter {
  return {
    id,
    key,
    capabilities: NO_CAPABILITIES,
    preflight: () => Promise.resolve({ installed: true, problems: [] }),
    // eslint-disable-next-line require-yield
    execute: async function* () {
      throw new Error("não usado");
    },
    cancel: () => Promise.resolve({ terminated: true, elapsedMs: 0 }),
  };
}

describe("createHarnessRegistry", () => {
  it("resolve por chave e lista o que registrou", () => {
    const registry = createHarnessRegistry([stub("a", "CLAUDE_CODE"), stub("b", "CODEX")]);

    expect(registry.resolve("CODEX").id).toBe("b");
    expect(registry.find("PI")).toBeUndefined();
    expect(registry.keys()).toEqual(["CLAUDE_CODE", "CODEX"]);
  });

  it("recusa dois adapters para a mesma chave", () => {
    // Um "o último vence" só apareceria em produção, com o harness errado
    // rodando e nenhum sinal de que houve troca.
    expect(() => createHarnessRegistry([stub("a", "PI"), stub("b", "PI")])).toThrow(
      /Dois adapters registrados/,
    );
  });

  it("a mensagem de chave ausente diz o que existe", () => {
    const registry = createHarnessRegistry([stub("a", "CLAUDE_CODE")]);

    expect(() => registry.resolve("ANTIGRAVITY")).toThrow(/Registrados: CLAUDE_CODE/);
  });
});

describe("capabilities", () => {
  it("parte de tudo desligado", () => {
    expect(Object.values(NO_CAPABILITIES).every((value) => value === false)).toBe(true);
  });

  it("liga só o que foi pedido", () => {
    const matrix = capabilities({ streaming: true, resume: true });

    expect(matrix.streaming).toBe(true);
    expect(matrix.resume).toBe(true);
    expect(matrix.dockerExecution).toBe(false);
  });
});

describe("createAsyncQueue", () => {
  it("entrega na ordem, inclusive o que foi enfileirado antes do consumo", async () => {
    const queue = createAsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.close();

    const seen: number[] = [];
    for await (const item of queue) seen.push(item);

    expect(seen).toEqual([1, 2]);
  });

  it("acorda quem estava esperando", async () => {
    const queue = createAsyncQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();

    queue.push("oi");
    expect((await pending).value).toBe("oi");

    queue.close();
    expect((await iterator.next()).done).toBe(true);
  });

  it("ignora push depois do fechamento", async () => {
    const queue = createAsyncQueue<number>();
    queue.close();
    queue.push(9);

    const seen: number[] = [];
    for await (const item of queue) seen.push(item);

    expect(seen).toEqual([]);
    expect(queue.closed).toBe(true);
  });
});
