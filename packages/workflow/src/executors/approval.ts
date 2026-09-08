import type { ApprovalGate, ApprovalStepDefinition } from "@dungeon-master/contracts";

import type { StepAttemptOutcome, StepExecutor } from "./types.js";

/**
 * O executor de um step `approval`.
 *
 * Ele não decide nada: abre o gate (ou reencontra o que já existe para a
 * `gateKey`, documento técnico, seção 19.1, item 4) e devolve `paused`. Quem
 * leva o RunStep e o Run a `WAITING_APPROVAL`, e grava `ApprovalRequested`,
 * é a própria criação do gate, na mesma transação. O Worker então solta o Run
 * — trava de workspace e capacidade —, e a decisão humana chega pela API, que
 * assenta o step e devolve o Run à fila. Quando o motor reclama o Run de
 * novo, o step já tem desfecho e este executor não roda mais.
 *
 * O caso defensivo — gate já decidido enquanto o step ainda não assentou —
 * não deveria existir, porque a resolução escreve os dois na mesma transação.
 * Se existir, o desfecho do gate vale: o step assenta pela decisão gravada, em
 * vez de abrir um segundo pedido para um humano que já respondeu.
 */
export const approvalStepExecutor: StepExecutor<ApprovalStepDefinition> = {
  async execute(context): Promise<StepAttemptOutcome> {
    const { definition, deps } = context;

    const outcome = await deps.store.createApprovalGate({
      stepKey: context.step.key,
      gateKey: definition.gateKey,
      title: definition.title,
      description: definition.description,
    });

    if (!outcome.ok) {
      return {
        kind: "failed",
        error: {
          code: outcome.code,
          message: `Não consegui abrir o gate "${definition.gateKey}": ${outcome.detail}`,
          retryable: false,
        },
        summary: `Gate "${definition.gateKey}" não pôde ser aberto.`,
      };
    }

    if (outcome.gate.status === "PENDING") {
      deps.logger?.info?.(
        {
          runId: context.run.runId,
          stepKey: context.step.key,
          gateId: outcome.gate.id,
          created: outcome.created,
        },
        outcome.created ? "gate de aprovação aberto" : "gate de aprovação reencontrado",
      );
      return { kind: "paused", gate: outcome.gate };
    }

    return settleByDecision(outcome.gate, definition);
  },
};

/** O gate já foi decidido: o step assenta pela decisão, sem pedir de novo. */
function settleByDecision(
  gate: ApprovalGate,
  definition: ApprovalStepDefinition,
): StepAttemptOutcome {
  const resolvedAt = gate.resolvedAt ?? new Date(0).toISOString();
  if (gate.status === "GRANTED") {
    return {
      kind: "succeeded",
      result: {
        kind: "approval",
        gateId: gate.id,
        decision: "approve",
        note: gate.note,
        resolvedAt,
      },
      summary: `Aprovado: ${definition.title}`,
    };
  }
  return {
    kind: "failed",
    result: { kind: "approval", gateId: gate.id, decision: "reject", note: gate.note, resolvedAt },
    error: {
      code: "APPROVAL_REJECTED",
      message:
        gate.note === null
          ? `O gate "${gate.gateKey}" foi recusado.`
          : `O gate "${gate.gateKey}" foi recusado: ${gate.note}`,
      retryable: false,
    },
    summary: `Recusado: ${definition.title}`,
  };
}
