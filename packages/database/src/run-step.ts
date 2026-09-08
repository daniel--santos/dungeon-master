import type { RunError, RunStep, RunStepResult, RunStepStatus } from "@dungeon-master/contracts";
import {
  checkRunStepTransition,
  isTerminalRunStepStatus,
  type RunStepTransitionRejection,
} from "@dungeon-master/domain";
import { sanitizeJson } from "@dungeon-master/events";
import { and, asc, eq, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import type { DatabaseExecutor } from "./dashboard-event.js";
import { failed, ok, type Result } from "./result.js";
import { insertRunEvent, type RunEventInput } from "./run-event.js";
import { type RunStepRow, runSteps } from "./schema/run-step.js";
import { runs } from "./schema/run.js";

/**
 * RunStep: o estado de cada step de um Run.
 *
 * **Contrato para o motor (Fase 4B).** O motor lê os steps com
 * `listRunSteps`, pergunta ao domínio quais estão prontos e move cada um com
 * `transitionRunStep`, que é um CAS no status: o chamador diz de onde acha
 * que o step está saindo, e se o banco já mostra outro estado a escrita não
 * acontece e a resposta traz o estado atual. É o que faz dois Workers, ou um
 * Worker e uma resolução de gate pela API, não pisarem um no outro.
 */

export function toRunStep(row: RunStepRow): RunStep {
  return {
    id: row.id,
    runId: row.runId,
    workflowStepId: row.workflowStepId,
    key: row.key,
    name: row.name,
    type: row.type,
    position: row.position,
    status: row.status,
    attempt: row.attempt,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    result: row.result,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type RunStepWriteFailure =
  | {
      readonly code: "RUN_STEP_TRANSITION_REJECTED";
      readonly rejection: RunStepTransitionRejection;
    }
  | {
      /** O CAS perdeu: o step já não está no estado que o chamador esperava. */
      readonly code: "RUN_STEP_STATUS_CHANGED";
      readonly expected: RunStepStatus;
      readonly current: RunStep;
    };

// --------------------------------------------------------------------------
// Leitura
// --------------------------------------------------------------------------

/** Os steps do Run, na ordem topológica da captura. */
export async function listRunSteps(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<RunStep[]> {
  const rows = await db
    .select()
    .from(runSteps)
    .where(and(eq(runSteps.userId, input.userId), eq(runSteps.runId, input.runId)))
    .orderBy(asc(runSteps.position), asc(runSteps.key));

  return rows.map(toRunStep);
}

export async function findRunStepRow(
  db: DatabaseExecutor,
  input: { userId: string; runId: string; stepKey: string },
): Promise<RunStepRow | null> {
  const [row] = await db
    .select()
    .from(runSteps)
    .where(
      and(
        eq(runSteps.userId, input.userId),
        eq(runSteps.runId, input.runId),
        eq(runSteps.key, input.stepKey),
      ),
    );

  return row ?? null;
}

export async function findRunStepRowById(
  db: DatabaseExecutor,
  input: { userId: string; runStepId: string },
): Promise<RunStepRow | null> {
  const [row] = await db
    .select()
    .from(runSteps)
    .where(and(eq(runSteps.userId, input.userId), eq(runSteps.id, input.runStepId)));

  return row ?? null;
}

// --------------------------------------------------------------------------
// Transição
// --------------------------------------------------------------------------

export interface RunStepPatch {
  result?: RunStepResult | null;
  error?: RunError | null;
}

export interface ApplyRunStepTransitionInput {
  userId: string;
  runId: string;
  stepKey: string;
  /** O estado de onde o chamador acredita que o step sai. É a condição do CAS. */
  from: RunStepStatus;
  to: RunStepStatus;
  /** Soma um à tentativa. Use ao entrar em `RUNNING`. */
  incrementAttempt?: boolean;
  patch?: RunStepPatch;
}

/**
 * O CAS dentro da transação de quem chama.
 *
 * `UPDATE ... WHERE status = from`: zero linhas é "outra escrita chegou
 * antes", e a resposta traz o estado atual para o chamador decidir. Devolve
 * `null` quando o step não existe.
 *
 * `started_at` é escrito uma vez, na primeira entrada em `RUNNING`;
 * `finished_at`, ao chegar num terminal. Uma retentativa (`RUNNING →
 * PENDING`) limpa o `finished_at` que não existe e mantém o `started_at` da
 * primeira tentativa, que é o que a duração total do step mede.
 */
export async function applyRunStepTransition(
  db: DatabaseExecutor,
  input: ApplyRunStepTransitionInput,
): Promise<Result<RunStepRow, RunStepWriteFailure> | null> {
  const check = checkRunStepTransition(input.from, input.to);
  if (!check.ok) {
    return failed<RunStepWriteFailure>({
      code: "RUN_STEP_TRANSITION_REJECTED",
      rejection: check.rejection,
    });
  }

  const agora = new Date();
  const patch = input.patch ?? {};

  const [row] = await db
    .update(runSteps)
    .set({
      status: input.to,
      ...(input.incrementAttempt === true ? { attempt: sql`${runSteps.attempt} + 1` } : {}),
      ...(input.to === "RUNNING"
        ? { startedAt: sql`coalesce(${runSteps.startedAt}, ${agora})` }
        : {}),
      ...(isTerminalRunStepStatus(input.to) ? { finishedAt: agora } : {}),
      ...(patch.result === undefined
        ? {}
        : { result: patch.result === null ? null : (sanitizeJson(patch.result) as RunStepResult) }),
      ...(patch.error === undefined
        ? {}
        : { error: patch.error === null ? null : (sanitizeJson(patch.error) as RunError) }),
    })
    .where(
      and(
        eq(runSteps.userId, input.userId),
        eq(runSteps.runId, input.runId),
        eq(runSteps.key, input.stepKey),
        eq(runSteps.status, input.from),
      ),
    )
    .returning();

  if (row !== undefined) return ok(row);

  const current = await findRunStepRow(db, input);
  if (current === null) return null;

  return failed<RunStepWriteFailure>({
    code: "RUN_STEP_STATUS_CHANGED",
    expected: input.from,
    current: toRunStep(current),
  });
}

export interface TransitionRunStepInput extends ApplyRunStepTransitionInput {
  /** Eventos gravados na mesma transação da transição. */
  events?: readonly RunEventInput[];
}

/**
 * Move um RunStep, com os eventos na mesma transação.
 *
 * A linha do Run é travada primeiro: é ela que serializa a `sequence` de
 * `run_event`, e travá-la aqui, antes do CAS, mantém a ordem "Run, depois
 * step" em todo caminho de escrita — a mesma de `createApprovalGate` e de
 * `resolveApprovalGate` —, o que é o que evita deadlock entre eles.
 */
export async function transitionRunStep(
  db: Database,
  input: TransitionRunStepInput,
): Promise<Result<RunStep, RunStepWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, input.runId), eq(runs.userId, input.userId)))
      .for("update");
    if (run === undefined) return null;

    const applied = await applyRunStepTransition(tx, input);
    if (applied === null) return null;
    if (!applied.ok) return applied;

    for (const event of input.events ?? []) {
      await insertRunEvent(tx, { userId: input.userId, runId: input.runId, event });
    }

    return ok(toRunStep(applied.value));
  });
}
