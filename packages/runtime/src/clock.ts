/**
 * O relógio, injetado.
 *
 * O runtime carimba `timestamp` em todo evento e mede duração para decidir
 * timeout. Ler `Date.now()` direto tornaria os testes de timeout dependentes de
 * espera real; com o relógio injetado, a suíte de contrato roda com o relógio
 * do sistema (é ele que prova o comportamento real) e os testes de unidade da
 * máquina de timeouts rodam com um relógio controlado.
 */

export interface Clock {
  /** Milissegundos desde a época. Monotônico não é exigido. */
  now(): number;
  /** O mesmo instante em ISO 8601 com fuso UTC. */
  nowIso(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

/** Relógio controlado, para teste. Avança só quando mandam. */
export function createManualClock(startMs = 0): Clock & { advance(ms: number): void } {
  let current = startMs;
  return {
    now: () => current,
    nowIso: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms;
    },
  };
}
