import type { CommandStepDefinition, RunStepResult } from "@dungeon-master/contracts";

import { describeProcessExit, runProcessStep } from "./process.js";
import type { StepAttemptOutcome, StepExecutor } from "./types.js";

/**
 * O executor de um step `command`.
 *
 * Spawn sem shell do `argv` no checkout do Run, com a cauda da saída no
 * resultado. Código de saída diferente de zero é falha do step — e, sem
 * `retry`, falha do Run. A validação com veredito, que não derruba nada
 * sozinha, é outro tipo (`validation`) por isso mesmo.
 */
export const commandStepExecutor: StepExecutor<CommandStepDefinition> = {
  async execute(context): Promise<StepAttemptOutcome> {
    const outcome = await runProcessStep(context);

    if (outcome.kind === "invalid_cwd") {
      return {
        kind: "failed",
        error: { code: "INVALID_CWD", message: outcome.message, retryable: false },
        summary: outcome.message,
      };
    }

    const result: RunStepResult = {
      kind: "command",
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
        summary: "Cancelado durante a execução do comando.",
      };
    }

    if (outcome.kind === "timed_out") {
      return {
        kind: "timed_out",
        result,
        error: {
          code: "TIMEOUT_COMPLETION",
          message: `O comando passou do teto de ${String(outcome.limitMs)} ms e foi encerrado.`,
          retryable: true,
          processTreeTerminated: outcome.termination.terminated,
        },
        summary: `Timeout após ${String(outcome.limitMs)} ms.`,
      };
    }

    const { error } = outcome.result;
    if (error !== undefined) {
      return {
        kind: "failed",
        result,
        error: { code: error.code, message: error.message, retryable: false },
        summary: error.message,
      };
    }

    if (outcome.result.exitCode !== 0) {
      return {
        kind: "failed",
        result,
        error: {
          code: outcome.result.exitCode === null ? "KILLED" : "NON_ZERO_EXIT",
          message: describeProcessExit(outcome.result),
          retryable: true,
          ...(outcome.result.exitCode === null ? {} : { exitCode: outcome.result.exitCode }),
        },
        summary: describeProcessExit(outcome.result),
      };
    }

    return { kind: "succeeded", result, summary: describeProcessExit(outcome.result) };
  },
};
