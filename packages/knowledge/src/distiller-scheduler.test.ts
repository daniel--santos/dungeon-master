import { describe, expect, it } from "vitest";

import { DistillerScheduler } from "./distiller-scheduler.js";

const MINUTE = 60_000;

describe("DistillerScheduler", () => {
  it("a ociosidade é um debounce: três candidatos seguidos viram um lote IDLE", () => {
    const scheduler = new DistillerScheduler({ idleMs: MINUTE, everyMs: 10 * MINUTE });
    scheduler.notifyCandidate("p", 0);
    scheduler.notifyCandidate("p", 20_000);
    scheduler.notifyCandidate("p", 40_000);

    expect(scheduler.due(59_000)).toEqual([]);
    expect(scheduler.due(40_000 + MINUTE)).toEqual([{ projectId: "p", trigger: "IDLE" }]);
  });

  it("o timer só anda para baixo: candidatos chegando sem parar ainda produzem um lote TIMER", () => {
    const scheduler = new DistillerScheduler({ idleMs: MINUTE, everyMs: 5 * MINUTE });
    for (let t = 0; t <= 6 * MINUTE; t += 30_000) {
      scheduler.notifyCandidate("p", t);
    }
    // A ociosidade nunca venceu (30 s entre chegadas); o timer de 5 min venceu.
    expect(scheduler.due(5 * MINUTE)).toEqual([{ projectId: "p", trigger: "TIMER" }]);
  });

  it("um pedido explícito vence os timers e sai como MANUAL", () => {
    const scheduler = new DistillerScheduler({ idleMs: MINUTE, everyMs: 10 * MINUTE });
    scheduler.notifyCandidate("p", 0);
    scheduler.requestNow("p", 1_000);
    expect(scheduler.due(1_000)).toEqual([{ projectId: "p", trigger: "MANUAL" }]);
  });

  it("um Project em lote não é agendado de novo, e o que chega durante o lote reinicia a espera", () => {
    const scheduler = new DistillerScheduler({ idleMs: MINUTE, everyMs: 10 * MINUTE });
    scheduler.notifyCandidate("p", 0);
    scheduler.markStarted("p");
    scheduler.notifyCandidate("p", 5_000);
    scheduler.requestNow("p", 6_000);

    expect(scheduler.due(MINUTE * 2)).toEqual([]);

    scheduler.markFinished("p", { pendingLeft: false }, 10_000);
    expect(scheduler.due(10_000 + MINUTE - 1)).toEqual([]);
    expect(scheduler.due(10_000 + MINUTE)).toEqual([{ projectId: "p", trigger: "IDLE" }]);
  });

  it("um lote que bateu no teto volta para a fila na hora; um sem resto sai da agenda", () => {
    const scheduler = new DistillerScheduler({ idleMs: MINUTE, everyMs: 10 * MINUTE });
    scheduler.notifyCandidate("p", 0);
    scheduler.markStarted("p");
    scheduler.markFinished("p", { pendingLeft: true }, 10_000);
    expect(scheduler.due(10_000)).toEqual([{ projectId: "p", trigger: "MANUAL" }]);

    scheduler.markStarted("p");
    scheduler.markFinished("p", { pendingLeft: false }, 20_000);
    expect(scheduler.due(Number.MAX_SAFE_INTEGER)).toEqual([]);
    expect(scheduler.snapshot()).toEqual([]);
    expect(scheduler.nextDueAt()).toBeNull();
  });

  it("trocar o intervalo adianta os timers armados e nunca os adia", () => {
    const scheduler = new DistillerScheduler({ idleMs: 10 * MINUTE, everyMs: 10 * MINUTE });
    scheduler.notifyCandidate("p", 0);
    scheduler.setEveryMs(2 * MINUTE, MINUTE);
    expect(scheduler.nextDueAt()).toBe(3 * MINUTE);

    scheduler.setEveryMs(30 * MINUTE, MINUTE);
    expect(scheduler.nextDueAt()).toBe(3 * MINUTE);
  });

  it("vários Projects vencem independentes", () => {
    const scheduler = new DistillerScheduler({ idleMs: MINUTE, everyMs: 10 * MINUTE });
    scheduler.notifyCandidate("a", 0);
    scheduler.notifyCandidate("b", 30_000);
    expect(scheduler.due(MINUTE)).toEqual([{ projectId: "a", trigger: "IDLE" }]);
    expect(scheduler.due(MINUTE + 30_000).map((d) => d.projectId)).toEqual(["a", "b"]);
  });

  it("recusa intervalos inválidos", () => {
    expect(() => new DistillerScheduler({ idleMs: -1, everyMs: 1 })).toThrow(/idleMs/);
    expect(() => new DistillerScheduler({ idleMs: 1, everyMs: Number.NaN })).toThrow(/everyMs/);
  });
});
