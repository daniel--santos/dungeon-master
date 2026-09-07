import type { RunStatus } from "@dungeon-master/contracts";

/**
 * A máquina de estados de Run (documento técnico, seção 36).
 *
 * ```text
 * CREATED          → QUEUED | CANCELLED
 * QUEUED           → PREPARING | CANCELLED
 * PREPARING        → RUNNING | FAILED | CANCELLED
 * RUNNING          → SUCCEEDED | FAILED | TIMED_OUT | CANCELLED | WAITING_APPROVAL
 * WAITING_APPROVAL → RUNNING | CANCELLED
 * ```
 *
 * `PREPARING → FAILED` existe porque a preparação faz trabalho que pode dar
 * errado antes de qualquer processo de agente subir: preflight da CLI, criação
 * do worktree, aquisição da trava de caminho. Uma falha ali não é um Run que
 * rodou mal; é um Run que não chegou a rodar, e precisa de um estado terminal
 * assim mesmo.
 *
 * `PREPARING` não vai direto a `TIMED_OUT`: os dois relógios de timeout — o de
 * ociosidade e o de conclusão — começam com o processo do agente, e um travamento
 * na preparação é falha de infraestrutura, que sai como `FAILED` com o motivo.
 *
 * **Transição para estado terminal só ocorre depois de confirmado que a árvore
 * de processos terminou** (planejamento v0.4, Fase 2A). Isso não cabe na tabela:
 * é responsabilidade de quem chama `AgentRuntime.cancel()` antes de escrever o
 * status. A tabela diz quais arestas existem; a confirmação diz quando é hora
 * de percorrê-las.
 *
 * O tipo do mapa força a exaustividade — um estado novo em `RunStatus` sem
 * linha aqui é erro de compilação.
 */
export const RUN_TRANSITIONS = {
  CREATED: ["QUEUED", "CANCELLED"],
  QUEUED: ["PREPARING", "CANCELLED"],
  PREPARING: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "WAITING_APPROVAL"],
  WAITING_APPROVAL: ["RUNNING", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  TIMED_OUT: [],
  CANCELLED: [],
} as const satisfies Record<RunStatus, readonly RunStatus[]>;

/**
 * Estados sem saída de um Run.
 *
 * Diferente de Task, aqui `FAILED` **é** terminal: a nova tentativa é um Run
 * novo, com `attempt` maior, e não o mesmo Run voltando à fila. É isso que
 * mantém o histórico de tentativas legível (documento técnico, seção 5.1).
 */
export const TERMINAL_RUN_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const satisfies readonly RunStatus[];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

/**
 * Estados em que o Run ainda não subiu processo nenhum.
 *
 * É o que permite à API cancelar na hora: nada foi criado, então não há árvore
 * de processos a confirmar e nem worker a avisar. Em qualquer outro estado o
 * cancelamento é só um pedido, e quem transiciona é quem matou a árvore.
 */
export const PRE_EXECUTION_RUN_STATUSES = [
  "CREATED",
  "QUEUED",
] as const satisfies readonly RunStatus[];

export function isPreExecutionRunStatus(status: RunStatus): boolean {
  return (PRE_EXECUTION_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

/** Os estados alcançáveis a partir de um estado. Vazio nos terminais. */
export function allowedRunTransitions(from: RunStatus): readonly RunStatus[] {
  return RUN_TRANSITIONS[from];
}

/** Verdadeiro quando a aresta existe na máquina de estados. */
export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return (RUN_TRANSITIONS[from] as readonly RunStatus[]).includes(to);
}

/** Por que uma transição de Run foi recusada. Código, não frase: a API traduz. */
export interface RunTransitionRejection {
  readonly code: "INVALID_TRANSITION";
  readonly from: RunStatus;
  readonly to: RunStatus;
  readonly allowed: readonly RunStatus[];
}

export type RunTransitionCheck =
  { readonly ok: true } | { readonly ok: false; readonly rejection: RunTransitionRejection };

/**
 * A checagem de uma transição de Run.
 *
 * Só a forma do grafo: o Run não tem vizinhança que possa recusá-lo do jeito
 * que uma Task tem filhas e dependências. As regras que ligam Run e Task ficam
 * em `run-task-coupling.ts`, e são aplicadas pelos dois lados da mesma
 * transação.
 */
export function checkRunTransition(from: RunStatus, to: RunStatus): RunTransitionCheck {
  if (!canTransitionRun(from, to)) {
    return {
      ok: false,
      rejection: { code: "INVALID_TRANSITION", from, to, allowed: allowedRunTransitions(from) },
    };
  }
  return { ok: true };
}
