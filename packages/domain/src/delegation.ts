import type {
  RunResultStatus,
  RunStatus,
  RunStepError,
  RunStepResult,
  UsageSummary,
} from "@dungeon-master/contracts";

import { isTerminalRunStatus } from "./run-status.js";

/**
 * A delegação Agent-to-Agent (planejamento v0.4, Fase 9B; documento técnico,
 * seção 40, nível 4).
 *
 * Um Run mãe abre um Run filho — por um step `delegate` do Workflow ou pela
 * ferramenta `delegate_task` — e o desfecho do filho vira o resultado do
 * passo. O que é regra pura mora aqui: a profundidade máxima e a tradução do
 * desfecho do filho no desfecho do passo. Quem lê o banco e grava é o
 * repositório, na transação do desfecho.
 */

/**
 * Quantos níveis de delegação cabem abaixo de um Run pedido pela API.
 *
 * Profundidade 0 é o Run da API ou do auto-despacho; 1 é o filho dele; 2 é o
 * neto. Um neto não delega: uma cadeia sem fundo é o que separa uma
 * delegação de um enxame, e enxame fica fora do escopo por padrão (CLAUDE.md,
 * seção 12).
 */
export const MAX_DELEGATION_DEPTH = 2;

export type DelegationDepthCheck =
  | { readonly ok: true; readonly childDepth: number }
  | {
      readonly ok: false;
      readonly code: "DELEGATION_DEPTH_EXCEEDED";
      readonly parentDepth: number;
      readonly maxDepth: number;
      readonly reason: string;
    };

/** O Run mãe, nesta profundidade, ainda pode abrir um filho? */
export function checkDelegationDepth(parentDepth: number): DelegationDepthCheck {
  const childDepth = parentDepth + 1;
  if (childDepth > MAX_DELEGATION_DEPTH) {
    return {
      ok: false,
      code: "DELEGATION_DEPTH_EXCEEDED",
      parentDepth,
      maxDepth: MAX_DELEGATION_DEPTH,
      reason:
        `O Run mãe está na profundidade ${String(parentDepth)} e um filho ficaria na ` +
        `${String(childDepth)}; o teto é ${String(MAX_DELEGATION_DEPTH)}.`,
    };
  }
  return { ok: true, childDepth };
}

/** O que o passo `delegate` precisa saber do Run filho para assentar. */
export interface ChildRunOutcomeView {
  readonly id: string;
  readonly taskId: string;
  readonly status: RunStatus;
  readonly resultStatus: RunResultStatus | null;
  readonly summary: string | null;
  readonly usage: UsageSummary | null;
  readonly error: { readonly code?: string | undefined; readonly message: string } | null;
}

export type DelegateStepSettlement =
  | { readonly kind: "waiting" }
  | { readonly kind: "succeeded"; readonly result: RunStepResult; readonly summary: string }
  | {
      readonly kind: "failed";
      readonly result: RunStepResult;
      readonly error: RunStepError;
      readonly summary: string;
    };

/**
 * O desfecho do passo `delegate` a partir do Run filho.
 *
 * `SUCCEEDED` no filho é `SUCCEEDED` no passo, com o veredito e o resumo do
 * agente do filho; `FAILED`/`TIMED_OUT` é `FAILED` com `DELEGATION_FAILED`
 * e o erro do filho dentro; `CANCELLED` é `FAILED` com
 * `DELEGATION_CANCELLED` — o passo não pode ficar aberto por um Run que
 * ninguém vai retomar. Um filho ainda vivo é `waiting`.
 */
export function settleDelegateStep(child: ChildRunOutcomeView): DelegateStepSettlement {
  if (!isTerminalRunStatus(child.status)) return { kind: "waiting" };

  const result: RunStepResult = {
    kind: "delegate",
    childRunId: child.id,
    childTaskId: child.taskId,
    status: child.status,
    ...(child.resultStatus === null ? {} : { resultStatus: child.resultStatus }),
    ...(child.summary === null ? {} : { summary: child.summary }),
    ...(child.usage === null ? {} : { usage: child.usage }),
  };

  if (child.status === "SUCCEEDED") {
    return {
      kind: "succeeded",
      result,
      summary:
        child.summary ??
        `O Run filho ${child.id} terminou em SUCCEEDED (${child.resultStatus ?? "sem veredito"}).`,
    };
  }

  if (child.status === "CANCELLED") {
    return {
      kind: "failed",
      result,
      error: {
        code: "DELEGATION_CANCELLED",
        message: `O Run filho ${child.id} foi cancelado antes de terminar.`,
        retryable: false,
        childRunId: child.id,
      },
      summary: `Run filho ${child.id} cancelado.`,
    };
  }

  const motivo = child.error?.message ?? "sem motivo gravado";
  return {
    kind: "failed",
    result,
    error: {
      code: "DELEGATION_FAILED",
      message: `O Run filho ${child.id} terminou em ${child.status}: ${motivo}`,
      retryable: false,
      childRunId: child.id,
      ...(child.error?.code === undefined ? {} : { childErrorCode: child.error.code }),
    },
    summary: `Run filho ${child.id} terminou em ${child.status}.`,
  };
}
