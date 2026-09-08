import type {
  Run,
  RunCancelledEvent,
  RunStatus,
  StepFinishedEvent,
} from "@dungeon-master/contracts";
import { type EventsLogger, requireTerminalStatusWrite } from "@dungeon-master/events";
import { and, asc, eq, isNotNull } from "drizzle-orm";

import type { Database } from "./client.js";
import type { DatabaseExecutor } from "./dashboard-event.js";
import { failed, ok, type Result } from "./result.js";
import { insertRunEvent } from "./run-event.js";
import { applyRunStepTransition } from "./run-step.js";
import { applyRunStatus, lockRunRow, toRun, type RunWriteFailure } from "./run.js";
import { runSteps } from "./schema/run-step.js";
import { runs } from "./schema/run.js";
import { tasks } from "./schema/task.js";
import { releaseWorkspaceLock } from "./workspace-lock.js";

/**
 * O que o Worker precisa de um Run com Workflow e o motor não sabe fazer: os
 * dois desfechos que acontecem **sem** um runner em pé.
 *
 * - **Cancelamento em `WAITING_APPROVAL`.** Ninguém está executando: o Run
 *   soltou o Worker ao abrir o gate. O pedido de cancelamento só marca
 *   `cancel_requested_at`, e é o laço ocioso do Worker quem fecha o Run —
 *   passo do gate em `CANCELLED`, Run em `CANCELLED` com `RunCancelled` no
 *   diário. O gate continua `PENDING`: uma decisão que chegue depois recebe
 *   `RUN_NOT_WAITING_APPROVAL` da resolução, que confere o status do Run.
 * - **Reconciliação de órfão.** Um Run com Workflow que ficou `RUNNING` num
 *   Worker que morreu tem RunSteps abertos junto; fechá-los antes do desfecho
 *   do Run é o que deixa a tela por passos coerente com o Run `FAILED`.
 */

export type CancelWaitingRunFailure =
  | RunWriteFailure
  | {
      readonly code: "RUN_NOT_WAITING_APPROVAL";
      readonly runId: string;
      readonly status: RunStatus;
    }
  | { readonly code: "CANCEL_NOT_REQUESTED"; readonly runId: string };

/** Os Runs parados em gate com cancelamento pedido. O laço ocioso os fecha. */
export async function listRunsWaitingApprovalWithCancelRequested(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<string[]> {
  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.userId, input.userId),
        eq(runs.status, "WAITING_APPROVAL"),
        isNotNull(runs.cancelRequestedAt),
      ),
    )
    .orderBy(asc(runs.createdAt), asc(runs.id));

  return rows.map((row) => row.id);
}

export interface CancelRunWaitingApprovalInput {
  userId: string;
  runId: string;
  /** Vai para o erro do Run e para o `RunCancelled`. Padrão: `user_request`. */
  reason?: string;
  logger?: EventsLogger;
}

/**
 * Fecha como `CANCELLED` um Run parado em gate com cancelamento pedido.
 *
 * Tudo ou nada, como toda escrita terminal: os RunSteps abertos, o Run, a
 * Task (que volta a `READY`, pela regra de sempre), os eventos e a trava de
 * workspace saem na mesma transação. `processTreeTerminated: true` porque
 * não há árvore: nenhum processo sustenta um Run em `WAITING_APPROVAL`.
 *
 * @throws TerminalStatusWriteError
 */
export async function cancelRunWaitingApproval(
  db: Database,
  input: CancelRunWaitingApprovalInput,
): Promise<Result<Run, CancelWaitingRunFailure> | null> {
  const reason = input.reason ?? "user_request";

  return await requireTerminalStatusWrite(
    db.transaction(async (tx) => {
      const run = await lockRunRow(tx, input);
      if (run === null) return null;

      if (run.status !== "WAITING_APPROVAL") {
        return failed<CancelWaitingRunFailure>({
          code: "RUN_NOT_WAITING_APPROVAL",
          runId: run.id,
          status: run.status,
        });
      }
      if (run.cancelRequestedAt === null) {
        return failed<CancelWaitingRunFailure>({ code: "CANCEL_NOT_REQUESTED", runId: run.id });
      }

      const agora = new Date();
      const steps = await tx
        .select()
        .from(runSteps)
        .where(and(eq(runSteps.userId, input.userId), eq(runSteps.runId, run.id)))
        .orderBy(asc(runSteps.position));

      for (const step of steps) {
        if (
          step.status !== "PENDING" &&
          step.status !== "RUNNING" &&
          step.status !== "WAITING_APPROVAL"
        ) {
          continue;
        }
        const moved = await applyRunStepTransition(tx, {
          userId: input.userId,
          runId: run.id,
          stepKey: step.key,
          from: step.status,
          to: "CANCELLED",
          patch: {
            error: {
              code: "CANCELLED",
              message:
                step.status === "WAITING_APPROVAL"
                  ? "O Run foi cancelado enquanto esperava a aprovação."
                  : "O Run foi cancelado antes deste passo rodar.",
            },
          },
        });
        if (moved === null || !moved.ok) {
          throw new Error(
            `O RunStep ${step.id} recusou o cancelamento: ${JSON.stringify(moved?.failure ?? null)}`,
          );
        }
        if (step.status === "WAITING_APPROVAL") {
          const finished: StepFinishedEvent = {
            type: "StepFinished",
            timestamp: agora.toISOString(),
            runStepId: step.id,
            stepKey: step.key,
            status: "CANCELLED",
            attempt: Math.max(step.attempt, 1),
            summary: "Cancelado enquanto esperava a aprovação.",
          };
          await insertRunEvent(tx, {
            userId: input.userId,
            runId: run.id,
            event: { type: finished.type, timestamp: agora, payload: finished },
          });
        }
      }

      const aplicado = await applyRunStatus(tx, {
        userId: input.userId,
        run,
        to: "CANCELLED",
        patch: {
          error: {
            code: "CANCELLED",
            message: "O Run foi cancelado a pedido enquanto esperava a aprovação.",
            reason,
            retryable: false,
            processTreeTerminated: true,
          },
        },
      });
      if (!aplicado.ok) return aplicado;

      const cancelled: RunCancelledEvent = {
        type: "RunCancelled",
        timestamp: agora.toISOString(),
        harness: run.harnessKey,
        reason,
        processTreeTerminated: true,
        elapsedMs: Math.max(0, agora.getTime() - (run.startedAt ?? run.createdAt).getTime()),
      };
      await insertRunEvent(tx, {
        userId: input.userId,
        runId: run.id,
        event: { type: cancelled.type, timestamp: agora, payload: cancelled },
      });

      await releaseWorkspaceLock(tx, { userId: input.userId, runId: run.id });

      const [task] = await tx
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, run.taskId));

      return ok(toRun(aplicado.value, task?.projectId ?? null));
    }),
    {
      runId: input.runId,
      site: "run.terminal_status_cancelled_waiting_approval",
      ...(input.logger === undefined ? {} : { logger: input.logger }),
    },
  );
}

export interface SettleOrphanRunStepsInput {
  userId: string;
  runId: string;
  workerId: string;
}

export interface SettledOrphanRunSteps {
  /** Chaves dos passos que estavam em `RUNNING` e assentaram em `FAILED`. */
  readonly failed: readonly string[];
  /** Chaves dos passos que estavam em `PENDING` e assentaram em `CANCELLED`. */
  readonly cancelled: readonly string[];
}

/**
 * Assenta os RunSteps abertos de um Run órfão, antes de o Run ser fechado.
 *
 * `RUNNING` vira `FAILED` com `WORKER_LOST` — a tentativa se perdeu com o
 * processo — e `PENDING` vira `CANCELLED`: nada mais vai rodar neste Run. Um
 * passo em `WAITING_APPROVAL` não é tocado, porque um Run órfão está em
 * `PREPARING`/`RUNNING` e um gate pendente ali seria estado que a reconciliação
 * não sabe explicar; ele fica visível como está.
 */
export async function settleOrphanRunSteps(
  db: Database,
  input: SettleOrphanRunStepsInput,
): Promise<SettledOrphanRunSteps> {
  return await db.transaction(async (tx) => {
    const run = await lockRunRow(tx, input);
    if (run === null) return { failed: [], cancelled: [] };

    const agora = new Date();
    const steps = await tx
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.userId, input.userId), eq(runSteps.runId, run.id)))
      .orderBy(asc(runSteps.position));

    const failedKeys: string[] = [];
    const cancelledKeys: string[] = [];

    for (const step of steps) {
      if (step.status === "RUNNING") {
        const moved = await applyRunStepTransition(tx, {
          userId: input.userId,
          runId: run.id,
          stepKey: step.key,
          from: "RUNNING",
          to: "FAILED",
          patch: {
            error: {
              code: "WORKER_LOST",
              message: "O Worker que executava este passo terminou sem escrever o desfecho dele.",
              retryable: true,
              reconciledBy: input.workerId,
            },
          },
        });
        if (moved === null || !moved.ok) continue;
        failedKeys.push(step.key);
        const finished: StepFinishedEvent = {
          type: "StepFinished",
          timestamp: agora.toISOString(),
          runStepId: step.id,
          stepKey: step.key,
          status: "FAILED",
          attempt: Math.max(step.attempt, 1),
          summary: "O Worker terminou sem gravar o desfecho deste passo.",
        };
        await insertRunEvent(tx, {
          userId: input.userId,
          runId: run.id,
          event: { type: finished.type, timestamp: agora, payload: finished },
        });
        continue;
      }
      if (step.status === "PENDING") {
        const moved = await applyRunStepTransition(tx, {
          userId: input.userId,
          runId: run.id,
          stepKey: step.key,
          from: "PENDING",
          to: "CANCELLED",
          patch: {
            error: {
              code: "CANCELLED",
              message: "O Run foi reconciliado como FAILED antes deste passo rodar.",
            },
          },
        });
        if (moved !== null && moved.ok) cancelledKeys.push(step.key);
      }
    }

    return { failed: failedKeys, cancelled: cancelledKeys };
  });
}
