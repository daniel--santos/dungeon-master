import type { RunStepStatus } from "@dungeon-master/contracts";

/**
 * A máquina de estados de RunStep (planejamento v0.4, Fase 4).
 *
 * ```text
 * PENDING          → RUNNING | SKIPPED | CANCELLED
 * RUNNING          → SUCCEEDED | FAILED | TIMED_OUT | CANCELLED | WAITING_APPROVAL | PENDING
 * WAITING_APPROVAL → SUCCEEDED | FAILED | CANCELLED
 * ```
 *
 * `PENDING → SKIPPED` é o step que não vai rodar: um predicado de `when`
 * avaliou falso, ou uma dependência não terminou em `SUCCEEDED`. O motivo fica
 * no evento `StepSkipped`.
 *
 * `RUNNING → PENDING` é a **retentativa**: uma tentativa falhou, `retry`
 * ainda permite outra, e o step volta a ficar elegível com `attempt` maior.
 * `FAILED` é reservado para a última tentativa, por isso é terminal — um
 * predicado `stepFailed` que visse um `FAILED` intermediário dispararia cedo
 * demais.
 *
 * `WAITING_APPROVAL` só sai para os terminais: a decisão do gate encerra o
 * step. Aprovar é `SUCCEEDED` com o resultado `approval`; recusar é `FAILED`
 * com o erro `APPROVAL_REJECTED`. É a resolução do ApprovalGate quem escreve
 * essa transição, na mesma transação do CAS, e não o motor depois: um step de
 * aprovação cujo desfecho dependesse de uma segunda escrita poderia ficar
 * pendente com o gate já decidido.
 *
 * O tipo do mapa força a exaustividade — um estado novo em `RunStepStatus`
 * sem linha aqui é erro de compilação.
 */
export const RUN_STEP_TRANSITIONS = {
  PENDING: ["RUNNING", "SKIPPED", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "WAITING_APPROVAL", "PENDING"],
  WAITING_APPROVAL: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  SKIPPED: [],
  TIMED_OUT: [],
  CANCELLED: [],
} as const satisfies Record<RunStepStatus, readonly RunStepStatus[]>;

/** Estados sem saída. Um step aqui assentou, e os dependentes podem ser avaliados. */
export const TERMINAL_RUN_STEP_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "TIMED_OUT",
  "CANCELLED",
] as const satisfies readonly RunStepStatus[];

export function isTerminalRunStepStatus(status: RunStepStatus): boolean {
  return (TERMINAL_RUN_STEP_STATUSES as readonly RunStepStatus[]).includes(status);
}

/**
 * Os estados que `stepFailed` reconhece como falha.
 *
 * `SKIPPED` e `CANCELLED` ficam de fora: pulado não é falhou, e cancelado é
 * uma decisão de fora do Workflow.
 */
export const FAILED_RUN_STEP_STATUSES = [
  "FAILED",
  "TIMED_OUT",
] as const satisfies readonly RunStepStatus[];

export function isFailedRunStepStatus(status: RunStepStatus): boolean {
  return (FAILED_RUN_STEP_STATUSES as readonly RunStepStatus[]).includes(status);
}

/** Os estados alcançáveis a partir de um estado. Vazio nos terminais. */
export function allowedRunStepTransitions(from: RunStepStatus): readonly RunStepStatus[] {
  return RUN_STEP_TRANSITIONS[from];
}

/** Verdadeiro quando a aresta existe na máquina de estados. */
export function canTransitionRunStep(from: RunStepStatus, to: RunStepStatus): boolean {
  return (RUN_STEP_TRANSITIONS[from] as readonly RunStepStatus[]).includes(to);
}

/** Por que uma transição de RunStep foi recusada. Código, não frase: a API traduz. */
export interface RunStepTransitionRejection {
  readonly code: "INVALID_TRANSITION";
  readonly from: RunStepStatus;
  readonly to: RunStepStatus;
  readonly allowed: readonly RunStepStatus[];
}

export type RunStepTransitionCheck =
  { readonly ok: true } | { readonly ok: false; readonly rejection: RunStepTransitionRejection };

/** A checagem de uma transição de RunStep. Só a forma do grafo, como no Run. */
export function checkRunStepTransition(
  from: RunStepStatus,
  to: RunStepStatus,
): RunStepTransitionCheck {
  if (!canTransitionRunStep(from, to)) {
    return {
      ok: false,
      rejection: {
        code: "INVALID_TRANSITION",
        from,
        to,
        allowed: allowedRunStepTransitions(from),
      },
    };
  }
  return { ok: true };
}
