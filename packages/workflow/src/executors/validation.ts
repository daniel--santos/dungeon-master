import type { RunStepResult, ValidationStepDefinition } from "@dungeon-master/contracts";

import { describeProcessExit, runProcessStep } from "./process.js";
import type { StepAttemptOutcome, StepExecutor } from "./types.js";

/**
 * O executor de um step `validation`.
 *
 * Igual a `command` no processo, diferente no significado: o código de saída
 * vira um **veredito** (`passed` com zero, `failed` com qualquer outro), e o
 * step termina `SUCCEEDED` nos dois casos. Quem decide o que fazer com um
 * `failed` são os dependentes, via `when: [{ kind: "validationPassed" }]`
 * (planejamento v0.4, Fase 4). O que reprova o step é só o que impede o
 * veredito de existir: executável ausente, timeout, `cwd` inválido.
 */
export const validationStepExecutor: StepExecutor<ValidationStepDefinition> = {
  async execute(context): Promise<StepAttemptOutcome> {
    const outcome = await runProcessStep(context);

    if (outcome.kind === "invalid_cwd") {
      return {
        kind: "failed",
        error: { code: "INVALID_CWD", message: outcome.message, retryable: false },
        summary: outcome.message,
      };
    }

    const verdict = outcome.result.exitCode === 0 ? "passed" : "failed";
    const result: RunStepResult = {
      kind: "validation",
      verdict,
      exitCode: outcome.result.exitCode,
      durationMs: outcome.result.durationMs,
      ...(outcome.result.stdoutTail.length === 0 ? {} : { stdoutTail: outcome.result.stdoutTail }),
      ...(outcome.result.stderrTail.length === 0 ? {} : { stderrTail: outcome.result.stderrTail }),
    };

    if (outcome.kind === "cancelled") {
      return {
        kind: "cancelled",
        processTreeTerminated: outcome.termination.terminated,
        terminationMethod: outcome.termination.method,
        summary: "Cancelado durante a validação.",
      };
    }

    if (outcome.kind === "timed_out") {
      return {
        kind: "timed_out",
        result,
        error: {
          code: "TIMEOUT_COMPLETION",
          message: `A validação passou do teto de ${String(outcome.limitMs)} ms e foi encerrada.`,
          retryable: true,
          processTreeTerminated: outcome.termination.terminated,
        },
        summary: `Timeout após ${String(outcome.limitMs)} ms.`,
      };
    }

    const { error } = outcome.result;
    if (error !== undefined) {
      // Sem processo não há veredito: isto é falha do step, não `failed`.
      return {
        kind: "failed",
        result,
        error: { code: error.code, message: error.message, retryable: false },
        summary: error.message,
      };
    }

    return {
      kind: "succeeded",
      result,
      summary: `Veredito ${verdict}. ${describeProcessExit(outcome.result)}`,
    };
  },
};
