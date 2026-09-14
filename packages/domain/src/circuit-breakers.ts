import type { BreakerState, BreakerTriggers } from "@dungeon-master/contracts";

/**
 * A máquina de estados do disjuntor (planejamento v0.4, Fase 9A).
 *
 * ```text
 * CLOSED    → OPEN       (um gatilho disparou)
 * OPEN      → HALF_OPEN  (o cooldown passou; o próximo pedido vira sondagem)
 * HALF_OPEN → CLOSED     (a sondagem terminou bem)
 * HALF_OPEN → OPEN       (a sondagem falhou)
 * qualquer  → CLOSED     (reset manual)
 * ```
 *
 * Pura, sobre um retrato do disjuntor e o relógio de quem chama. A API a
 * consulta em `POST /runs`; o Worker (9B) alimenta os gatilhos com os
 * desfechos e fecha ou reabre pela sondagem. Estado desconhecido não libera.
 */

export interface BreakerSignals {
  /** Desfechos `FAILED`/`TIMED_OUT` seguidos no escopo. */
  readonly consecutiveFailures?: number;
  /** Falhas na janela do gatilho. */
  readonly failuresInWindow?: number;
  /** `Diagnostic` com `PERMISSION_DENIED` na janela do gatilho. */
  readonly permissionDeniedInWindow?: number;
  /** O Harness reportou credencial ausente. */
  readonly authNotAuthenticated?: boolean;
}

export type BreakerTrip =
  | { readonly trip: false }
  | { readonly trip: true; readonly trigger: keyof BreakerTriggers; readonly reason: string };

/**
 * Algum gatilho disparou sobre os sinais medidos?
 *
 * Um sinal que não foi medido não dispara: o disjuntor abre por evidência,
 * nunca por falta dela. A ordem é fixa, e a resposta nomeia o primeiro.
 */
export function evaluateBreakerTriggers(
  triggers: BreakerTriggers,
  signals: BreakerSignals,
): BreakerTrip {
  if (
    triggers.consecutiveFailures !== null &&
    signals.consecutiveFailures !== undefined &&
    signals.consecutiveFailures >= triggers.consecutiveFailures
  ) {
    return {
      trip: true,
      trigger: "consecutiveFailures",
      reason:
        `${String(signals.consecutiveFailures)} falha(s) seguida(s); o gatilho é ` +
        `${String(triggers.consecutiveFailures)}.`,
    };
  }

  if (
    triggers.failuresInWindow !== null &&
    signals.failuresInWindow !== undefined &&
    signals.failuresInWindow >= triggers.failuresInWindow.count
  ) {
    return {
      trip: true,
      trigger: "failuresInWindow",
      reason:
        `${String(signals.failuresInWindow)} falha(s) em ${String(triggers.failuresInWindow.windowMs)} ms; ` +
        `o gatilho é ${String(triggers.failuresInWindow.count)}.`,
    };
  }

  if (
    triggers.permissionDeniedInWindow !== null &&
    signals.permissionDeniedInWindow !== undefined &&
    signals.permissionDeniedInWindow >= triggers.permissionDeniedInWindow.count
  ) {
    return {
      trip: true,
      trigger: "permissionDeniedInWindow",
      reason:
        `${String(signals.permissionDeniedInWindow)} permissão(ões) negada(s) em ` +
        `${String(triggers.permissionDeniedInWindow.windowMs)} ms; o gatilho é ` +
        `${String(triggers.permissionDeniedInWindow.count)}.`,
    };
  }

  if (triggers.authNotAuthenticated && signals.authNotAuthenticated === true) {
    return {
      trip: true,
      trigger: "authNotAuthenticated",
      reason: "O Harness reportou credencial ausente.",
    };
  }

  return { trip: false };
}

export interface BreakerSnapshot {
  readonly state: BreakerState;
  readonly openedAt: Date | null;
  readonly cooldownMs: number;
  readonly probeRunId: string | null;
}

export type BreakerAdmission =
  | {
      readonly admit: true;
      /** O estado depois da admissão. `HALF_OPEN` quando o Run é sondagem. */
      readonly state: BreakerState;
      readonly probe: boolean;
      /** `OPEN → HALF_OPEN` aconteceu agora; quem chama grava a transição. */
      readonly transition: "NONE" | "OPEN_TO_HALF_OPEN";
      readonly reason: string;
    }
  | { readonly admit: false; readonly state: BreakerState; readonly reason: string };

/** O cooldown de um disjuntor `OPEN` já passou? Sem `openedAt` nunca passa. */
export function breakerCooldownElapsed(
  breaker: Pick<BreakerSnapshot, "openedAt" | "cooldownMs">,
  now: Date,
): boolean {
  if (breaker.openedAt === null) return false;
  return now.getTime() >= breaker.openedAt.getTime() + breaker.cooldownMs;
}

/**
 * O disjuntor deixa um Run novo passar?
 *
 * `CLOSED` sempre; `OPEN` nunca antes do cooldown, e depois dele como
 * sondagem — o que também move o disjuntor para `HALF_OPEN`; `HALF_OPEN`
 * deixa passar **uma** sondagem por vez: enquanto `probeRunId` estiver
 * preenchido, o próximo espera. Um `OPEN` sem instante de abertura é estado
 * inconsistente e não libera.
 */
export function admitThroughBreaker(breaker: BreakerSnapshot, now: Date): BreakerAdmission {
  switch (breaker.state) {
    case "CLOSED":
      return { admit: true, state: "CLOSED", probe: false, transition: "NONE", reason: "Fechado." };
    case "OPEN": {
      if (breaker.openedAt === null) {
        return {
          admit: false,
          state: "OPEN",
          reason: "Aberto sem instante de abertura registrado; não libera até o reset.",
        };
      }
      if (!breakerCooldownElapsed(breaker, now)) {
        const restante = breaker.openedAt.getTime() + breaker.cooldownMs - now.getTime();
        return {
          admit: false,
          state: "OPEN",
          reason: `Aberto; faltam ${String(restante)} ms de cooldown.`,
        };
      }
      if (breaker.probeRunId !== null) {
        return {
          admit: false,
          state: "OPEN",
          reason: `Aberto com uma sondagem já marcada (${breaker.probeRunId}).`,
        };
      }
      return {
        admit: true,
        state: "HALF_OPEN",
        probe: true,
        transition: "OPEN_TO_HALF_OPEN",
        reason: "O cooldown passou; este Run é a sondagem que decide se o disjuntor fecha.",
      };
    }
    case "HALF_OPEN": {
      if (breaker.probeRunId !== null) {
        return {
          admit: false,
          state: "HALF_OPEN",
          reason: `Meio aberto com a sondagem ${breaker.probeRunId} em voo; só uma por vez.`,
        };
      }
      return {
        admit: true,
        state: "HALF_OPEN",
        probe: true,
        transition: "NONE",
        reason: "Meio aberto; este Run é a sondagem que decide se o disjuntor fecha.",
      };
    }
    default:
      // Um estado que a máquina não conhece não libera (fail-closed).
      return {
        admit: false,
        state: breaker.state,
        reason: `Estado desconhecido (${String(breaker.state)}); não libera.`,
      };
  }
}

export type BreakerOutcome = "SUCCEEDED" | "FAILED";

/**
 * Para onde o disjuntor vai depois do desfecho de um Run do escopo (9B).
 *
 * Só a sondagem move `HALF_OPEN`: um sucesso qualquer fecha, uma falha
 * reabre. Em `CLOSED`, quem decide abrir é `evaluateBreakerTriggers` sobre os
 * sinais acumulados; em `OPEN`, um desfecho de Run antigo não muda nada.
 */
export function nextBreakerState(input: {
  readonly state: BreakerState;
  readonly outcome: BreakerOutcome;
  readonly isProbe: boolean;
  readonly tripped: boolean;
}): BreakerState {
  switch (input.state) {
    case "CLOSED":
      return input.tripped ? "OPEN" : "CLOSED";
    case "OPEN":
      return "OPEN";
    case "HALF_OPEN":
      if (!input.isProbe) return "HALF_OPEN";
      return input.outcome === "SUCCEEDED" ? "CLOSED" : "OPEN";
    default:
      return "OPEN";
  }
}
