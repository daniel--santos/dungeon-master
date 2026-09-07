import { describe, expect, it } from "vitest";

import { startIdleLoop } from "./idle-loop.js";

describe("startIdleLoop", () => {
  it("executa ticks e para de forma graciosa", async () => {
    const ticks: number[] = [];

    const loop = startIdleLoop({
      intervalMs: 5,
      onTick: (tick) => {
        ticks.push(tick);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    await loop.stop();

    const observed = ticks.length;
    expect(observed).toBeGreaterThan(1);

    // Depois do stop, nenhum tick novo acontece.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ticks.length).toBe(observed);
  });

  it("não interrompe o trabalho em andamento ao parar", async () => {
    let finishedWork = false;

    const loop = startIdleLoop({
      intervalMs: 1_000,
      onTick: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        finishedWork = true;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await loop.stop();

    expect(finishedWork).toBe(true);
  });

  it("um erro no tick não derruba o laço", async () => {
    const seen: unknown[] = [];
    let tickCount = 0;

    const loop = startIdleLoop({
      intervalMs: 5,
      onTick: () => {
        tickCount += 1;
        throw new Error(`falha no tick ${tickCount}`);
      },
      onError: (error) => {
        seen.push(error);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    await loop.stop();

    expect(seen.length).toBeGreaterThan(1);
    expect(tickCount).toBeGreaterThan(1);
  });

  it("stop é interrompível e não espera o intervalo inteiro", async () => {
    const loop = startIdleLoop({ intervalMs: 60_000, onTick: () => undefined });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const startedAt = Date.now();
    await loop.stop();

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
