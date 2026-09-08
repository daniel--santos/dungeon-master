import { describe, expect, it } from "vitest";

import { capabilities, NO_CAPABILITIES } from "./capabilities.js";
import type { HarnessAdapter } from "./harness.js";
import { createHarnessRegistry } from "./registry.js";
import { createAsyncQueue } from "./async-queue.js";

function stub(
  id: string,
  key: HarnessAdapter["key"],
  executionMode?: HarnessAdapter["executionMode"],
): HarnessAdapter {
  return {
    id,
    key,
    ...(executionMode === undefined ? {} : { executionMode }),
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

    expect(() => registry.resolve("ANTIGRAVITY")).toThrow(/Registrados neste modo: CLAUDE_CODE/);
  });

  it("o mesmo harness tem um adapter por modo, e o modo escolhe", () => {
    // É o desenho da Fase 2C: `claude-code@host` e `claude-code@docker` são dois
    // objetos com a mesma `key`, e quem decide entre eles é o
    // `ExecutionProfile.mode` do Run.
    const registry = createHarnessRegistry([
      stub("claude-code@host", "CLAUDE_CODE"),
      stub("claude-code@docker", "CLAUDE_CODE", "DOCKER"),
    ]);

    expect(registry.resolve("CLAUDE_CODE").id).toBe("claude-code@host");
    expect(registry.resolve("CLAUDE_CODE", "HOST").id).toBe("claude-code@host");
    expect(registry.resolve("CLAUDE_CODE", "DOCKER").id).toBe("claude-code@docker");
    expect(registry.keys("DOCKER")).toEqual(["CLAUDE_CODE"]);
  });

  it("um adapter sem modo declarado é de host", () => {
    const registry = createHarnessRegistry([stub("a", "PI")]);

    expect(registry.find("PI", "HOST")?.id).toBe("a");
    expect(registry.find("PI", "DOCKER")).toBeUndefined();
  });

  it("dois adapters do mesmo harness em modos diferentes não colidem", () => {
    expect(() => createHarnessRegistry([stub("a", "PI"), stub("b", "PI", "DOCKER")])).not.toThrow();
    expect(() =>
      createHarnessRegistry([stub("a", "PI", "DOCKER"), stub("b", "PI", "DOCKER")]),
    ).toThrow(/Dois adapters registrados para o harness PI no modo DOCKER/);
  });

  it("um harness que só roda no host manda trocar o Ambiente de Execução", () => {
    // É o caso do Codex, que o ADR 0001 deixou de fora do modo isolado. A
    // mensagem precisa dizer o que fazer: "não registrado" mandaria procurar um
    // defeito de configuração que não existe.
    const registry = createHarnessRegistry([stub("codex@host", "CODEX")]);

    expect(() => registry.resolve("CODEX", "DOCKER")).toThrow(
      /não roda no modo DOCKER.*Escolha outro Ambiente de Execução/s,
    );
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
