import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalGateListItem,
  ApprovalGateStatus,
  ApprovalGrantedEvent,
  ApprovalRejectedEvent,
  ApprovalRequestedEvent,
  RunStatus,
  StepFinishedEvent,
} from "@dungeon-master/contracts";
import { sanitizeCredentials } from "@dungeon-master/events";
import { and, asc, count, desc, eq, isNull, type SQL } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { insertRunEvent } from "./run-event.js";
import {
  applyRunStepTransition,
  findRunStepRow,
  findRunStepRowById,
  type RunStepWriteFailure,
} from "./run-step.js";
import { applyRunStatus, lockRunRow, type RunWriteFailure } from "./run.js";
import { type ApprovalGateRow, approvalGates } from "./schema/run-step.js";
import { runs } from "./schema/run.js";
import { tasks } from "./schema/task.js";

/**
 * ApprovalGate: a pausa humana de um Run (documento técnico, seção 26).
 *
 * **Contrato para o motor (Fase 4B).** Ao chegar num step `approval`, o
 * motor chama `createApprovalGate` com a `gateKey` da definição. A função é
 * idempotente por `(run_id, gate_key)`: um Worker que reinicia e reencontra
 * o mesmo step recebe o gate que já existe, sem abrir um segundo nem pular o
 * humano. Na criação, RunStep e Run vão para `WAITING_APPROVAL`, o
 * `ApprovalRequested` entra em `run_event` e `approval.requested` acorda a
 * interface — tudo no mesmo COMMIT.
 *
 * A decisão vem pela API, em `resolveApprovalGate`, e é um **CAS**: um único
 * `UPDATE ... WHERE status = 'PENDING' AND resolved_at IS NULL`. Zero linhas
 * é "outra decisão chegou antes", e a resposta traz o gate como ele está.
 * Na mesma transação o RunStep assenta (`SUCCEEDED` ao aprovar, `FAILED` ao
 * recusar), o Run volta a `QUEUED` e os eventos de auditoria são gravados. O
 * motor reclama o Run de novo, lê os RunSteps e continua o grafo: o step de
 * aprovação já tem desfecho, e os predicados dos dependentes decidem o resto.
 */

export type ApprovalGateWriteFailure =
  | {
      /** O CAS perdeu: o gate já foi decidido. `gate` é o estado atual. */
      readonly code: "GATE_ALREADY_RESOLVED";
      readonly gate: ApprovalGate;
    }
  | {
      /** O Run não está parado neste gate: foi cancelado, ou nunca parou. */
      readonly code: "RUN_NOT_WAITING_APPROVAL";
      readonly runId: string;
      readonly status: RunStatus;
    }
  | { readonly code: "RUN_STEP_NOT_FOUND"; readonly runId: string; readonly stepKey: string }
  | { readonly code: "RUN_STEP_WRITE_REJECTED"; readonly failure: RunStepWriteFailure }
  | { readonly code: "RUN_WRITE_REJECTED"; readonly failure: RunWriteFailure };

export function toApprovalGate(row: ApprovalGateRow): ApprovalGate {
  return {
    id: row.id,
    runId: row.runId,
    runStepId: row.runStepId,
    gateKey: row.gateKey,
    title: row.title,
    description: row.description,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    note: row.note,
  };
}

// --------------------------------------------------------------------------
// Leitura
// --------------------------------------------------------------------------

export async function findApprovalGateRow(
  db: DatabaseExecutor,
  input: { userId: string; gateId: string },
): Promise<ApprovalGateRow | null> {
  const [row] = await db
    .select()
    .from(approvalGates)
    .where(and(eq(approvalGates.id, input.gateId), eq(approvalGates.userId, input.userId)));

  return row ?? null;
}

async function findGateByKey(
  db: DatabaseExecutor,
  input: { userId: string; runId: string; gateKey: string },
): Promise<ApprovalGateRow | null> {
  const [row] = await db
    .select()
    .from(approvalGates)
    .where(
      and(
        eq(approvalGates.userId, input.userId),
        eq(approvalGates.runId, input.runId),
        eq(approvalGates.gateKey, input.gateKey),
      ),
    );

  return row ?? null;
}

/** Os gates de um Run, do pedido mais antigo para o mais novo. */
export async function listRunApprovalGates(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<ApprovalGate[]> {
  const rows = await db
    .select()
    .from(approvalGates)
    .where(and(eq(approvalGates.userId, input.userId), eq(approvalGates.runId, input.runId)))
    .orderBy(asc(approvalGates.requestedAt), asc(approvalGates.id));

  return rows.map(toApprovalGate);
}

export interface ApprovalGateFilters {
  status?: ApprovalGateStatus | undefined;
  runId?: string | undefined;
}

export interface ListApprovalGatesInput extends PageInput {
  userId: string;
  filters?: ApprovalGateFilters;
}

/**
 * A listagem por usuário, do pedido mais recente para o mais antigo.
 *
 * `GET /approval-gates?status=PENDING` é a caixa de entrada de aprovações da
 * interface. A Task vem por junção, como em `listRuns`: a lista mostra o
 * título em toda linha, e sem ele seria uma leitura por gate.
 */
export async function listApprovalGates(
  db: DatabaseExecutor,
  input: ListApprovalGatesInput,
): Promise<PageResult<ApprovalGateListItem>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(approvalGates.userId, input.userId)];
  if (filters.status !== undefined) conditions.push(eq(approvalGates.status, filters.status));
  if (filters.runId !== undefined) conditions.push(eq(approvalGates.runId, filters.runId));

  const where = and(...conditions);

  const rows = await db
    .select({ gate: approvalGates, taskId: tasks.id, taskTitle: tasks.title })
    .from(approvalGates)
    .innerJoin(runs, eq(runs.id, approvalGates.runId))
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(where)
    .orderBy(desc(approvalGates.requestedAt), desc(approvalGates.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db
    .select({ total: count() })
    .from(approvalGates)
    .innerJoin(runs, eq(runs.id, approvalGates.runId))
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(where);

  return {
    items: rows.map((row) => ({
      ...toApprovalGate(row.gate),
      taskId: row.taskId,
      taskTitle: row.taskTitle,
    })),
    total: counted?.total ?? 0,
  };
}

// --------------------------------------------------------------------------
// Criação
// --------------------------------------------------------------------------

export interface CreateApprovalGateInput {
  userId: string;
  runId: string;
  /** Chave do RunStep de tipo `approval` que está pedindo. */
  stepKey: string;
  /** Chave do gate, vinda da definição. Única no Run. */
  gateKey: string;
  title: string;
  description?: string | null;
}

export interface CreatedApprovalGate {
  readonly gate: ApprovalGate;
  /** `false` quando o gate já existia e nada foi escrito. */
  readonly created: boolean;
}

/**
 * Abre o gate, ou devolve o que já existe para esta chave.
 *
 * Toda checagem acontece antes da primeira escrita: quando a função devolve
 * `failed`, nada foi gravado. A ordem de travas é a mesma de todo caminho de
 * escrita de Run — a linha do Run primeiro —, o que é o que evita deadlock com
 * a resolução vinda pela API.
 *
 * Exige o RunStep em `RUNNING` (o motor marca o início do step antes de pedir
 * o gate) e o Run em `RUNNING`. Devolve `null` quando o Run não existe.
 */
export async function createApprovalGate(
  db: Database,
  input: CreateApprovalGateInput,
): Promise<Result<CreatedApprovalGate, ApprovalGateWriteFailure> | null> {
  return await db
    .transaction(async (tx) => {
      const run = await lockRunRow(tx, input);
      if (run === null) return null;

      const existing = await findGateByKey(tx, input);
      if (existing !== null) return ok({ gate: toApprovalGate(existing), created: false });

      const step = await findRunStepRow(tx, input);
      if (step === null) {
        return failed<ApprovalGateWriteFailure>({
          code: "RUN_STEP_NOT_FOUND",
          runId: input.runId,
          stepKey: input.stepKey,
        });
      }

      const stepMoved = await applyRunStepTransition(tx, {
        userId: input.userId,
        runId: input.runId,
        stepKey: input.stepKey,
        from: step.status,
        to: "WAITING_APPROVAL",
      });
      if (stepMoved === null) {
        return failed<ApprovalGateWriteFailure>({
          code: "RUN_STEP_NOT_FOUND",
          runId: input.runId,
          stepKey: input.stepKey,
        });
      }
      if (!stepMoved.ok) {
        return failed<ApprovalGateWriteFailure>({
          code: "RUN_STEP_WRITE_REJECTED",
          failure: stepMoved.failure,
        });
      }

      const runMoved = await applyRunStatus(tx, {
        userId: input.userId,
        run,
        to: "WAITING_APPROVAL",
      });
      if (!runMoved.ok) {
        // A transação aborta com a exceção: o step já foi escrito acima, e uma
        // recusa devolvida agora commitaria metade da mudança.
        throw new ApprovalGateRollback({ code: "RUN_WRITE_REJECTED", failure: runMoved.failure });
      }

      const [gate] = await tx
        .insert(approvalGates)
        .values({
          id: newId(),
          userId: input.userId,
          runId: input.runId,
          runStepId: step.id,
          gateKey: input.gateKey,
          title: input.title,
          description: input.description ?? null,
          status: "PENDING",
        })
        .returning();

      if (gate === undefined) throw new Error("A inserção em approval_gate não devolveu linha.");

      const requested: ApprovalRequestedEvent = {
        type: "ApprovalRequested",
        timestamp: gate.requestedAt.toISOString(),
        harness: run.harnessKey,
        approvalKey: gate.gateKey,
        summary: gate.title,
        gateId: gate.id,
        stepKey: step.key,
      };
      await insertRunEvent(tx, {
        userId: input.userId,
        runId: input.runId,
        event: { type: requested.type, timestamp: gate.requestedAt, payload: requested },
      });

      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "approval.requested",
        payload: {
          runId: input.runId,
          taskId: run.taskId,
          gateId: gate.id,
          gateKey: gate.gateKey,
          title: gate.title,
        },
      });

      return ok({ gate: toApprovalGate(gate), created: true });
    })
    .catch((error: unknown) => {
      if (error instanceof ApprovalGateRollback) return failed(error.failure);
      throw error;
    });
}

/**
 * Aborta a transação carregando uma recusa de domínio.
 *
 * Existe para o caso em que uma checagem só pode ser feita depois de uma
 * escrita — o Run é movido depois do step —, e a recusa precisa desfazer a
 * escrita anterior em vez de commitá-la pela metade.
 */
class ApprovalGateRollback extends Error {
  constructor(readonly failure: ApprovalGateWriteFailure) {
    super(`approval_gate rollback: ${failure.code}`);
    this.name = "ApprovalGateRollback";
  }
}

// --------------------------------------------------------------------------
// Resolução
// --------------------------------------------------------------------------

export interface ResolveApprovalGateInput {
  userId: string;
  gateId: string;
  decision: ApprovalDecision;
  note?: string | null;
}

/**
 * Decide o gate. CAS transacional; nunca sobrescreve uma decisão.
 *
 * Ordem: trava do Run, checagens (gate `PENDING`, Run em `WAITING_APPROVAL`,
 * RunStep em `WAITING_APPROVAL`), e só então as escritas — o `UPDATE`
 * condicional do gate, o desfecho do RunStep, a volta do Run a `QUEUED`, os
 * eventos `ApprovalGranted`/`ApprovalRejected` e `StepFinished` em
 * `run_event`, e `approval.resolved` no dashboard. Devolve `null` quando o
 * gate não existe.
 */
export async function resolveApprovalGate(
  db: Database,
  input: ResolveApprovalGateInput,
): Promise<Result<ApprovalGate, ApprovalGateWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const located = await findApprovalGateRow(tx, input);
    if (located === null) return null;

    const run = await lockRunRow(tx, { userId: input.userId, runId: located.runId });
    if (run === null) return null;

    // Relido com a trava do Run em mãos: quem resolveu antes já commitou, e a
    // primeira leitura pode ter visto o gate ainda pendente.
    const gate = await findApprovalGateRow(tx, input);
    if (gate === null) return null;

    if (gate.status !== "PENDING") {
      return failed<ApprovalGateWriteFailure>({
        code: "GATE_ALREADY_RESOLVED",
        gate: toApprovalGate(gate),
      });
    }

    if (run.status !== "WAITING_APPROVAL") {
      return failed<ApprovalGateWriteFailure>({
        code: "RUN_NOT_WAITING_APPROVAL",
        runId: run.id,
        status: run.status,
      });
    }

    const step = await findRunStepRowById(tx, { userId: input.userId, runStepId: gate.runStepId });
    if (step === null) {
      return failed<ApprovalGateWriteFailure>({
        code: "RUN_STEP_NOT_FOUND",
        runId: run.id,
        stepKey: gate.gateKey,
      });
    }
    if (step.status !== "WAITING_APPROVAL") {
      return failed<ApprovalGateWriteFailure>({
        code: "RUN_STEP_WRITE_REJECTED",
        failure: {
          code: "RUN_STEP_TRANSITION_REJECTED",
          rejection: {
            code: "INVALID_TRANSITION",
            from: step.status,
            to: input.decision === "approve" ? "SUCCEEDED" : "FAILED",
            allowed: [],
          },
        },
      });
    }

    const agora = new Date();
    const note =
      input.note === undefined || input.note === null || input.note === ""
        ? null
        : sanitizeCredentials(input.note);
    const status: ApprovalGateStatus = input.decision === "approve" ? "GRANTED" : "REJECTED";

    // O CAS. `status = 'PENDING' AND resolved_at IS NULL` é a condição inteira:
    // se outra decisão commitou entre a leitura e aqui, zero linhas.
    const [resolved] = await tx
      .update(approvalGates)
      .set({ status, resolvedAt: agora, note })
      .where(
        and(
          eq(approvalGates.id, gate.id),
          eq(approvalGates.userId, input.userId),
          eq(approvalGates.status, "PENDING"),
          isNull(approvalGates.resolvedAt),
        ),
      )
      .returning();

    if (resolved === undefined) {
      const current = await findApprovalGateRow(tx, input);
      if (current === null) return null;
      return failed<ApprovalGateWriteFailure>({
        code: "GATE_ALREADY_RESOLVED",
        gate: toApprovalGate(current),
      });
    }

    const stepMoved = await applyRunStepTransition(tx, {
      userId: input.userId,
      runId: run.id,
      stepKey: step.key,
      from: "WAITING_APPROVAL",
      to: input.decision === "approve" ? "SUCCEEDED" : "FAILED",
      patch:
        input.decision === "approve"
          ? {
              result: {
                kind: "approval",
                gateId: gate.id,
                decision: "approve",
                note,
                resolvedAt: agora.toISOString(),
              },
              error: null,
            }
          : {
              result: {
                kind: "approval",
                gateId: gate.id,
                decision: "reject",
                note,
                resolvedAt: agora.toISOString(),
              },
              error: {
                code: "APPROVAL_REJECTED",
                message:
                  note === null
                    ? `O gate "${gate.gateKey}" foi recusado.`
                    : `O gate "${gate.gateKey}" foi recusado: ${note}`,
              },
            },
    });
    if (stepMoved === null || !stepMoved.ok) {
      // As checagens acima garantiram o step em WAITING_APPROVAL com a linha do
      // Run travada. Chegar aqui é defeito: abortar desfaz o CAS do gate.
      throw new Error(
        `O RunStep ${step.id} recusou o desfecho do gate ${gate.id}: ` +
          JSON.stringify(stepMoved?.failure ?? null),
      );
    }

    const runMoved = await applyRunStatus(tx, { userId: input.userId, run, to: "QUEUED" });
    if (!runMoved.ok) {
      throw new Error(
        `O Run ${run.id} recusou a volta à fila após o gate ${gate.id}: ` +
          JSON.stringify(runMoved.failure),
      );
    }

    const decision: ApprovalGrantedEvent | ApprovalRejectedEvent = {
      type: input.decision === "approve" ? "ApprovalGranted" : "ApprovalRejected",
      timestamp: agora.toISOString(),
      gateId: gate.id,
      gateKey: gate.gateKey,
      runStepId: step.id,
      stepKey: step.key,
      decidedBy: input.userId,
      note,
    };
    await insertRunEvent(tx, {
      userId: input.userId,
      runId: run.id,
      event: { type: decision.type, timestamp: agora, payload: decision },
    });

    const finished: StepFinishedEvent = {
      type: "StepFinished",
      timestamp: agora.toISOString(),
      runStepId: step.id,
      stepKey: step.key,
      status: stepMoved.value.status,
      attempt: Math.max(stepMoved.value.attempt, 1),
      summary: input.decision === "approve" ? `Aprovado: ${gate.title}` : `Recusado: ${gate.title}`,
    };
    await insertRunEvent(tx, {
      userId: input.userId,
      runId: run.id,
      event: { type: finished.type, timestamp: agora, payload: finished },
    });

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "approval.resolved",
      payload: {
        runId: run.id,
        taskId: run.taskId,
        gateId: gate.id,
        gateKey: gate.gateKey,
        title: gate.title,
        decision: input.decision,
        status,
      },
    });

    return ok(toApprovalGate(resolved));
  });
}
