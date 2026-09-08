import type {
  ProjectStatus,
  RunResultStatus,
  RunStatus,
  TaskStatus,
} from "@dungeon-master/contracts";

import { type TaskNode, uncompletedDependencies } from "./task-rules.js";

/**
 * As regras que ligam Task e Run.
 *
 * Task e Run **não** têm transição 1:1 (documento técnico, seção 36): um Run é
 * uma tentativa, e a Task acompanha o que a tentativa fez com ela. Este arquivo
 * é a tradução entre as duas máquinas, em funções puras — quem chama lê o
 * estado e aplica as duas mudanças na mesma transação.
 *
 * ```text
 * Run criado                    → Task QUEUED
 * Run PREPARING | RUNNING       → Task RUNNING
 * Run SUCCEEDED, result completed → Task COMPLETED
 * Run SUCCEEDED, result blocked   → Task BLOCKED
 * Run SUCCEEDED, result failed    → Task FAILED
 * Run FAILED | TIMED_OUT        → Task FAILED
 * Run CANCELLED                 → Task READY
 * ```
 */

/**
 * De quais estados uma Task aceita um Run novo.
 *
 * `READY` é o caso normal. `FAILED` é a retentativa: a Task falhou, o usuário
 * quer tentar de novo, e isso é um Run novo com `attempt` maior — não o Run
 * antigo revivido. Todo outro estado ou já tem um Run em voo (`QUEUED`,
 * `RUNNING`, `WAITING`), ou é trabalho que ninguém pediu para executar
 * (`INBOX`, `BLOCKED`), ou está resolvido (`COMPLETED`, `CANCELLED`).
 */
export const RUN_CREATION_TASK_STATUSES = [
  "READY",
  "FAILED",
] as const satisfies readonly TaskStatus[];

export function taskAcceptsNewRun(status: TaskStatus): boolean {
  return (RUN_CREATION_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

/** Por que a criação de um Run foi recusada. */
export type RunCreationRejection =
  | {
      readonly code: "TASK_NOT_RUNNABLE";
      readonly status: TaskStatus;
      readonly allowed: readonly TaskStatus[];
    }
  | { readonly code: "TASK_WITHOUT_PROJECT" }
  | { readonly code: "PROJECT_ARCHIVED"; readonly projectId: string }
  | { readonly code: "PROJECT_WITHOUT_WORKSPACE"; readonly projectId: string }
  | {
      readonly code: "DEPENDENCIES_NOT_COMPLETED";
      /** Ids das dependências que ainda não estão `COMPLETED`. */
      readonly blocking: readonly string[];
    };

export type RunCreationCheck =
  { readonly ok: true } | { readonly ok: false; readonly rejection: RunCreationRejection };

export interface RunCreationInput {
  readonly taskStatus: TaskStatus;
  /** Nulo é uma captura de Inbox, que não tem onde rodar. */
  readonly projectId: string | null;
  readonly projectStatus: ProjectStatus;
  /**
   * Caminho do workspace do Project. Sem ele não há diretório de trabalho, e um
   * agente sem diretório de trabalho não é um Run que roda pior: é um Run que
   * não pode nem começar.
   */
  readonly projectWorkspacePath: string | null;
  /** Tasks das quais esta depende. Ausente é o mesmo que nenhuma. */
  readonly dependencies?: readonly TaskNode[];
}

/**
 * Pode criar um Run para esta Task agora?
 *
 * A regra de dependências é a mesma de `QUEUED` na máquina de Task, e não uma
 * segunda cópia dela: criar um Run **é** enfileirar a Task, e uma dependência
 * pendente bloqueia os dois pelo mesmo motivo.
 */
export function checkRunCreation(input: RunCreationInput): RunCreationCheck {
  if (!taskAcceptsNewRun(input.taskStatus)) {
    return {
      ok: false,
      rejection: {
        code: "TASK_NOT_RUNNABLE",
        status: input.taskStatus,
        allowed: RUN_CREATION_TASK_STATUSES,
      },
    };
  }

  if (input.projectId === null) {
    return { ok: false, rejection: { code: "TASK_WITHOUT_PROJECT" } };
  }

  if (input.projectStatus === "ARCHIVED") {
    return { ok: false, rejection: { code: "PROJECT_ARCHIVED", projectId: input.projectId } };
  }

  if (input.projectWorkspacePath === null || input.projectWorkspacePath === "") {
    return {
      ok: false,
      rejection: { code: "PROJECT_WITHOUT_WORKSPACE", projectId: input.projectId },
    };
  }

  const blocking = uncompletedDependencies(input.dependencies ?? []);
  if (blocking.length > 0) {
    return { ok: false, rejection: { code: "DEPENDENCIES_NOT_COMPLETED", blocking } };
  }

  return { ok: true };
}

/**
 * Para onde a Task vai quando o Run entra em `status`.
 *
 * `null` significa "a Task não se mexe": um Run em `CREATED` ainda não foi
 * enfileirado, e `WAITING_APPROVAL` acontece com a Task já em `RUNNING` — o
 * gate é do Run, não do trabalho.
 *
 * `resultStatus` só é lido em `SUCCEEDED`, e é o que separa as duas perguntas:
 * "a execução correu bem?" é o `RunStatus`; "o trabalho ficou pronto?" é o
 * veredito do agente. Um Run pode terminar impecavelmente e reportar que a
 * Task ficou bloqueada.
 */
export function taskStatusForRun(
  status: RunStatus,
  resultStatus: RunResultStatus | null = null,
): TaskStatus | null {
  switch (status) {
    case "CREATED":
      return null;
    case "QUEUED":
      return "QUEUED";
    case "PREPARING":
    case "RUNNING":
      return "RUNNING";
    case "WAITING_APPROVAL":
      return null;
    case "SUCCEEDED":
      // Sem resultado estruturado não dá para afirmar que o trabalho ficou
      // pronto. `FAILED` deixa a Task retentável, que é o desfecho seguro:
      // marcar `COMPLETED` sem prova fecharia a Task por otimismo.
      if (resultStatus === "completed") return "COMPLETED";
      if (resultStatus === "blocked") return "BLOCKED";
      return "FAILED";
    case "FAILED":
    case "TIMED_OUT":
      return "FAILED";
    case "CANCELLED":
      // O trabalho volta ao quadro: cancelar a execução não cancela a tarefa.
      return "READY";
  }
}

export interface RunTransitionInput {
  readonly from: RunStatus;
  readonly to: RunStatus;
  /** O veredito que vai ficar gravado. Só é lido em `SUCCEEDED`. */
  readonly resultStatus?: RunResultStatus | null;
}

/**
 * Para onde a Task vai quando o Run **sai de `from` para `to`**.
 *
 * É `taskStatusForRun` com uma exceção: `WAITING_APPROVAL → QUEUED` não mexe
 * na Task. A volta à fila depois de um gate de aprovação não é um
 * enfileiramento novo — a Task nunca saiu de `RUNNING`, porque o gate é do
 * Run e não do trabalho —, e `RUNNING → QUEUED` não existe na máquina de
 * Task por bom motivo: trabalho em curso não volta para a fila sem um Run ter
 * terminado. Quando o Worker reclamar o Run de novo, `PREPARING` encontra a
 * Task já em `RUNNING` e não a move.
 *
 * Todo outro par delega à tabela por destino, que continua sendo a verdade
 * para quem só conhece o estado de chegada.
 */
export function taskStatusForRunTransition(input: RunTransitionInput): TaskStatus | null {
  if (input.from === "WAITING_APPROVAL" && input.to === "QUEUED") return null;
  return taskStatusForRun(input.to, input.resultStatus ?? null);
}
