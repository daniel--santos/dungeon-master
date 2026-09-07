import type { TaskStatus } from "@dungeon-master/contracts";

import { allowedTaskTransitions, canTransitionTask, isTerminalTaskStatus } from "./task-status.js";

/**
 * As regras de transição que dependem de outras Tasks.
 *
 * Tudo aqui é função pura sobre dados já lidos: quem chama é responsável por
 * ler filhas e dependências **dentro da mesma transação** em que vai aplicar a
 * mudança, senão a checagem responde sobre um estado que já passou.
 */

/** O mínimo que uma regra precisa saber sobre outra Task. */
export interface TaskNode {
  readonly id: string;
  readonly status: TaskStatus;
}

/**
 * Por que uma transição foi recusada.
 *
 * Códigos, e não frases: o domínio não escreve texto de interface. A API traduz
 * cada código no `detail` do problem details, em português, com os ids que
 * vieram junto.
 */
export type TaskTransitionRejection =
  | {
      readonly code: "INVALID_TRANSITION";
      readonly from: TaskStatus;
      readonly to: TaskStatus;
      readonly allowed: readonly TaskStatus[];
    }
  | {
      readonly code: "CHILDREN_NOT_SETTLED";
      /** Ids das subtarefas que ainda não estão `COMPLETED` nem `CANCELLED`. */
      readonly blocking: readonly string[];
    }
  | {
      readonly code: "DEPENDENCIES_NOT_COMPLETED";
      /** Ids das dependências que ainda não estão `COMPLETED`. */
      readonly blocking: readonly string[];
    };

export type TaskTransitionCheck =
  { readonly ok: true } | { readonly ok: false; readonly rejection: TaskTransitionRejection };

export interface TaskTransitionInput {
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  /** Subtarefas diretas. Ausente é o mesmo que nenhuma. */
  readonly children?: readonly TaskNode[];
  /** Tasks das quais esta depende. Ausente é o mesmo que nenhuma. */
  readonly dependencies?: readonly TaskNode[];
}

/**
 * Subtarefas que impedem a mãe de ser concluída.
 *
 * "Resolvida" é `COMPLETED` ou `CANCELLED`: uma subtarefa cancelada é uma
 * decisão de não fazer, e continuar bloqueando a mãe transformaria cancelar em
 * um beco sem saída.
 */
export function unsettledChildren(children: readonly TaskNode[]): readonly string[] {
  return children.filter((child) => !isTerminalTaskStatus(child.status)).map((child) => child.id);
}

/**
 * Dependências que impedem a Task de ser enfileirada.
 *
 * Só `COMPLETED` libera. Uma dependência `CANCELLED` continua bloqueando de
 * propósito: o trabalho que ela representava não foi feito, e quem cancelou
 * precisa decidir explicitamente se a aresta ainda faz sentido — o que é
 * remover a dependência, não ignorá-la em silêncio.
 */
export function uncompletedDependencies(dependencies: readonly TaskNode[]): readonly string[] {
  return dependencies
    .filter((dependency) => dependency.status !== "COMPLETED")
    .map((dependency) => dependency.id);
}

/**
 * A checagem completa de uma transição: forma do grafo e depois as regras de
 * vizinhança.
 *
 * A regra de dependências vale para **toda** entrada em `QUEUED`, e não só a
 * partir de `READY`. `FAILED → QUEUED` é uma nova tentativa, e uma dependência
 * pendente bloqueia a nova tentativa pelo mesmo motivo que bloqueou a primeira.
 */
export function checkTaskTransition(input: TaskTransitionInput): TaskTransitionCheck {
  const { from, to } = input;

  if (!canTransitionTask(from, to)) {
    return {
      ok: false,
      rejection: { code: "INVALID_TRANSITION", from, to, allowed: allowedTaskTransitions(from) },
    };
  }

  if (to === "COMPLETED") {
    const blocking = unsettledChildren(input.children ?? []);
    if (blocking.length > 0) {
      return { ok: false, rejection: { code: "CHILDREN_NOT_SETTLED", blocking } };
    }
  }

  if (to === "QUEUED") {
    const blocking = uncompletedDependencies(input.dependencies ?? []);
    if (blocking.length > 0) {
      return { ok: false, rejection: { code: "DEPENDENCIES_NOT_COMPLETED", blocking } };
    }
  }

  return { ok: true };
}
