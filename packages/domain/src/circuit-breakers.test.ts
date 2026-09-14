import type { BreakerState, BreakerTriggers } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  admitThroughBreaker,
  breakerCooldownElapsed,
  evaluateBreakerTriggers,
  nextBreakerState,
} from "./circuit-breakers.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const HA_DEZ_MIN = new Date(NOW.getTime() - 10 * 60_000);

const SEM_GATILHO: BreakerTriggers = {
  consecutiveFailures: null,
  failuresInWindow: null,
  permissionDeniedInWindow: null,
  authNotAuthenticated: false,
};

describe("evaluateBreakerTriggers", () => {
  it("abre por evidência: sinal não medido não dispara", () => {
    const triggers = { ...SEM_GATILHO, consecutiveFailures: 3 };
    expect(evaluateBreakerTriggers(triggers, {})).toEqual({ trip: false });
    expect(evaluateBreakerTriggers(triggers, { consecutiveFailures: 2 })).toEqual({ trip: false });
    const trip = evaluateBreakerTriggers(triggers, { consecutiveFailures: 3 });
    expect(trip).toMatchObject({ trip: true, trigger: "consecutiveFailures" });
  });

  it("cada gatilho tem a própria contagem e janela", () => {
    expect(
      evaluateBreakerTriggers(
        { ...SEM_GATILHO, failuresInWindow: { count: 2, windowMs: 60_000 } },
        { failuresInWindow: 2 },
      ),
    ).toMatchObject({ trip: true, trigger: "failuresInWindow" });
    expect(
      evaluateBreakerTriggers(
        { ...SEM_GATILHO, permissionDeniedInWindow: { count: 5, windowMs: 60_000 } },
        { permissionDeniedInWindow: 4 },
      ),
    ).toEqual({ trip: false });
    expect(
      evaluateBreakerTriggers({ ...SEM_GATILHO, authNotAuthenticated: true }, { authNotAuthenticated: true }),
    ).toMatchObject({ trip: true, trigger: "authNotAuthenticated" });
    expect(
      evaluateBreakerTriggers({ ...SEM_GATILHO, authNotAuthenticated: false }, { authNotAuthenticated: true }),
    ).toEqual({ trip: false });
  });
});

describe("admitThroughBreaker", () => {
  it("CLOSED deixa passar sem sondagem", () => {
    expect(
      admitThroughBreaker({ state: "CLOSED", openedAt: null, cooldownMs: 1_000, probeRunId: null }, NOW),
    ).toMatchObject({ admit: true, state: "CLOSED", probe: false, transition: "NONE" });
  });

  it("OPEN dentro do cooldown recusa e diz quanto falta", () => {
    const admission = admitThroughBreaker(
      { state: "OPEN", openedAt: HA_DEZ_MIN, cooldownMs: 15 * 60_000, probeRunId: null },
      NOW,
    );
    expect(admission.admit).toBe(false);
    expect(admission.reason).toContain(`${String(5 * 60_000)} ms`);
    expect(breakerCooldownElapsed({ openedAt: HA_DEZ_MIN, cooldownMs: 15 * 60_000 }, NOW)).toBe(false);
  });

  it("OPEN depois do cooldown vira HALF_OPEN e deixa passar uma sondagem", () => {
    const admission = admitThroughBreaker(
      { state: "OPEN", openedAt: HA_DEZ_MIN, cooldownMs: 5 * 60_000, probeRunId: null },
      NOW,
    );
    expect(admission).toMatchObject({
      admit: true,
      state: "HALF_OPEN",
      probe: true,
      transition: "OPEN_TO_HALF_OPEN",
    });
  });

  it("HALF_OPEN deixa passar uma sondagem por vez", () => {
    const livre = admitThroughBreaker(
      { state: "HALF_OPEN", openedAt: HA_DEZ_MIN, cooldownMs: 1_000, probeRunId: null },
      NOW,
    );
    expect(livre).toMatchObject({ admit: true, probe: true, state: "HALF_OPEN", transition: "NONE" });

    const ocupado = admitThroughBreaker(
      { state: "HALF_OPEN", openedAt: HA_DEZ_MIN, cooldownMs: 1_000, probeRunId: "R1" },
      NOW,
    );
    expect(ocupado.admit).toBe(false);
    expect(ocupado.reason).toContain("R1");
  });

  it("fail-closed: OPEN sem instante e estado desconhecido não liberam", () => {
    expect(
      admitThroughBreaker({ state: "OPEN", openedAt: null, cooldownMs: 1, probeRunId: null }, NOW).admit,
    ).toBe(false);
    expect(
      admitThroughBreaker(
        { state: "BROKEN" as BreakerState, openedAt: null, cooldownMs: 1, probeRunId: null },
        NOW,
      ).admit,
    ).toBe(false);
  });
});

describe("nextBreakerState", () => {
  it("CLOSED abre quando um gatilho disparou", () => {
    expect(nextBreakerState({ state: "CLOSED", outcome: "FAILED", isProbe: false, tripped: true })).toBe("OPEN");
    expect(nextBreakerState({ state: "CLOSED", outcome: "FAILED", isProbe: false, tripped: false })).toBe(
      "CLOSED",
    );
  });

  it("só a sondagem move HALF_OPEN: sucesso fecha, falha reabre", () => {
    expect(nextBreakerState({ state: "HALF_OPEN", outcome: "SUCCEEDED", isProbe: true, tripped: false })).toBe(
      "CLOSED",
    );
    expect(nextBreakerState({ state: "HALF_OPEN", outcome: "FAILED", isProbe: true, tripped: false })).toBe(
      "OPEN",
    );
    expect(nextBreakerState({ state: "HALF_OPEN", outcome: "SUCCEEDED", isProbe: false, tripped: false })).toBe(
      "HALF_OPEN",
    );
  });

  it("OPEN não se mexe por desfecho de Run antigo", () => {
    expect(nextBreakerState({ state: "OPEN", outcome: "SUCCEEDED", isProbe: false, tripped: false })).toBe(
      "OPEN",
    );
  });
});
