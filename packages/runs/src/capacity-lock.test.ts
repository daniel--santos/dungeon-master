// Adapted from Archon — packages/core/src/utils/conversation-lock.test.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: `bun:test` virou `vitest`; `conversationId` virou chave de recurso; a
// espera por `setTimeout(0)` virou espera pela promessa `completion`, que o
// nosso `acquireLock` devolve; entraram os casos de teto de fila, de `drain()` e
// de handler que estoura, que são nossos.

import { describe, expect, it, vi } from "vitest";

import { CapacityLock } from "./capacity-lock.js";

/** Um trabalho que só termina quando o teste mandar. */
function trabalhoControlado(): {
  handler: () => Promise<void>;
  terminar: () => void;
  comecou: () => boolean;
} {
  let resolver!: () => void;
  let comecou = false;
  const espera = new Promise<void>((resolve) => {
    resolver = resolve;
  });

  return {
    handler: async () => {
      comecou = true;
      await espera;
    },
    terminar: () => resolver(),
    comecou: () => comecou,
  };
}

describe("CapacityLock", () => {
  it("começa na hora quando a chave está livre e há capacidade", async () => {
    const trava = new CapacityLock({ maxConcurrent: 2 });
    const resultado = trava.acquireLock("repo-a", async () => undefined);

    expect(resultado.status).toBe("started");
    await resultado.completion;
    expect(trava.activeCount).toBe(0);
  });

  it("enfileira o segundo trabalho da mesma chave, e mantém a ordem", async () => {
    const trava = new CapacityLock({ maxConcurrent: 4 });
    const ordem: string[] = [];
    const primeiro = trabalhoControlado();

    const a = trava.acquireLock("repo-a", primeiro.handler);
    const b = trava.acquireLock("repo-a", async () => {
      ordem.push("b");
    });
    const c = trava.acquireLock("repo-a", async () => {
      ordem.push("c");
    });

    expect(a.status).toBe("started");
    expect(b.status).toBe("queued-key");
    expect(c.status).toBe("queued-key");
    // Duas execuções da mesma chave nunca correm juntas: é o par em memória da
    // trava por caminho que vive no PostgreSQL.
    expect(trava.activeCount).toBe(1);

    primeiro.terminar();
    await Promise.all([a.completion, b.completion, c.completion]);

    expect(ordem).toEqual(["b", "c"]);
  });

  it("enfileira por capacidade quando o teto é atingido, mesmo com chaves livres", async () => {
    const trava = new CapacityLock({ maxConcurrent: 1 });
    const primeiro = trabalhoControlado();
    const segundo = trabalhoControlado();

    const a = trava.acquireLock("repo-a", primeiro.handler);
    const b = trava.acquireLock("repo-b", segundo.handler);

    expect(a.status).toBe("started");
    expect(b.status).toBe("queued-capacity");
    expect(segundo.comecou()).toBe(false);

    primeiro.terminar();
    await a.completion;

    // A capacidade que sobrou serve para qualquer chave que esteja esperando.
    expect(segundo.comecou()).toBe(true);
    segundo.terminar();
    await b.completion;
  });

  it("respeita o teto com várias chaves ao mesmo tempo", async () => {
    const trava = new CapacityLock({ maxConcurrent: 2 });
    let simultaneos = 0;
    let pico = 0;

    const trabalhos = Array.from({ length: 6 }, (_, indice) =>
      trava.acquireLock(`repo-${String(indice)}`, async () => {
        simultaneos += 1;
        pico = Math.max(pico, simultaneos);
        await Promise.resolve();
        simultaneos -= 1;
      }),
    );

    await Promise.all(trabalhos.map((trabalho) => trabalho.completion));

    expect(pico).toBeLessThanOrEqual(2);
    expect(trava.activeCount).toBe(0);
    expect(trava.queuedCount).toBe(0);
  });

  it("recusa quando a fila está cheia, em vez de crescer sem limite", async () => {
    const trava = new CapacityLock({ maxConcurrent: 1, maxQueued: 1 });
    const primeiro = trabalhoControlado();

    trava.acquireLock("repo-a", primeiro.handler);
    const naFila = trava.acquireLock("repo-a", async () => undefined);
    const recusado = trava.acquireLock("repo-a", async () => undefined);

    expect(naFila.status).toBe("queued-key");
    expect(recusado.status).toBe("rejected-queue-full");
    // Quem foi recusado não fica pendurado esperando uma vez que não virá.
    await expect(recusado.completion).resolves.toBeUndefined();

    primeiro.terminar();
    await naFila.completion;
  });

  it("um handler que estoura libera a chave e não derruba quem chamou", async () => {
    const error = vi.fn();
    const trava = new CapacityLock({ maxConcurrent: 1, logger: { error } });

    const quebrado = trava.acquireLock("repo-a", async () => {
      throw new Error("boom");
    });

    await expect(quebrado.completion).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);

    // A chave voltou a estar livre: um erro do trabalho não trava o recurso.
    const seguinte = trava.acquireLock("repo-a", async () => undefined);
    expect(seguinte.status).toBe("started");
    await seguinte.completion;
  });

  it("drain espera o que está correndo e o que está na fila", async () => {
    const trava = new CapacityLock({ maxConcurrent: 1 });
    const feitos: string[] = [];
    const primeiro = trabalhoControlado();

    trava.acquireLock("repo-a", async () => {
      await primeiro.handler();
      feitos.push("a");
    });
    trava.acquireLock("repo-a", async () => {
      feitos.push("b");
    });
    trava.acquireLock("repo-b", async () => {
      feitos.push("c");
    });

    primeiro.terminar();
    await trava.drain();

    expect(feitos.sort()).toEqual(["a", "b", "c"]);
    expect(trava.activeCount).toBe(0);
    expect(trava.queuedCount).toBe(0);
  });

  it("getStats descreve o que está correndo e o que espera", () => {
    const trava = new CapacityLock({ maxConcurrent: 1 });
    const primeiro = trabalhoControlado();

    trava.acquireLock("repo-a", primeiro.handler);
    trava.acquireLock("repo-a", async () => undefined);
    trava.acquireLock("repo-b", async () => undefined);

    const stats = trava.getStats();

    expect(stats.active).toBe(1);
    expect(stats.activeKeys).toEqual(["repo-a"]);
    expect(stats.queuedTotal).toBe(2);
    expect(stats.maxConcurrent).toBe(1);
    expect([...stats.queuedByKey].sort((l, r) => l.key.localeCompare(r.key))).toEqual([
      { key: "repo-a", queued: 1 },
      { key: "repo-b", queued: 1 },
    ]);

    primeiro.terminar();
  });

  it("recusa um teto menor que um", () => {
    expect(() => new CapacityLock({ maxConcurrent: 0 })).toThrow(/maxConcurrent/);
  });
});
