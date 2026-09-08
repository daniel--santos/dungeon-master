import type { Task, TaskKind, TaskPriority } from "@dungeon-master/contracts";
import { and, count, desc, eq } from "drizzle-orm";

import { recordDomainEvent } from "./activity.js";
import type { Database } from "./client.js";
import type { DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { findProjectRow } from "./project.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { tasks } from "./schema/task.js";
import { findTaskRow, toTask } from "./task.js";
import { findWorkflowRow } from "./workflow.js";

/**
 * A Inbox são as Tasks em `INBOX` (documento técnico, seção 38).
 *
 * Não há tabela nem entidade próprias: capturar é criar uma Task sem Project,
 * promover é dar Project e ir para `READY`, descartar é ir para `CANCELLED`.
 * Nenhuma das duas apaga linha — o que foi capturado continua auditável.
 */

export type InboxFailure =
  | { readonly code: "NOT_IN_INBOX"; readonly status: Task["status"] }
  | { readonly code: "PROJECT_NOT_FOUND"; readonly projectId: string }
  | { readonly code: "PROJECT_ARCHIVED"; readonly projectId: string }
  | { readonly code: "WORKFLOW_NOT_FOUND"; readonly workflowId: string };

export interface CaptureInboxInput {
  userId: string;
  /** O texto cru da captura. Vira o título. */
  text: string;
}

export async function captureInboxTask(db: Database, input: CaptureInboxInput): Promise<Task> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tasks)
      .values({
        id: newId(),
        userId: input.userId,
        projectId: null,
        title: input.text,
        status: "INBOX",
      })
      .returning();

    if (row === undefined) {
      throw new Error("A inserção da captura de Inbox não devolveu linha.");
    }

    const task = toTask(row);

    // `projectId` nulo: a captura ainda não pertence a Project nenhum, e é
    // justamente essa a informação que promover acrescenta.
    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: null,
      taskId: task.id,
      taskTitle: task.title,
      type: "task.created",
      payload: { taskId: task.id, projectId: null, status: task.status, kind: task.kind },
    });

    return task;
  });
}

export interface ListInboxInput extends PageInput {
  userId: string;
}

/** A Inbox, da captura mais recente para a mais antiga. */
export async function listInboxTasks(
  db: DatabaseExecutor,
  input: ListInboxInput,
): Promise<PageResult<Task>> {
  const where = and(eq(tasks.userId, input.userId), eq(tasks.status, "INBOX"));

  const rows = await db
    .select()
    .from(tasks)
    .where(where)
    .orderBy(desc(tasks.createdAt), desc(tasks.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(tasks).where(where);

  return { items: rows.map(toTask), total: counted?.total ?? 0 };
}

export interface PromoteInboxInput {
  userId: string;
  taskId: string;
  projectId: string;
  title?: string;
  kind?: TaskKind;
  priority?: TaskPriority;
  /** Ausente deixa a Task sem Workflow: uma captura nunca tem um para manter. */
  workflowId?: string;
}

/**
 * Dá Project à captura e leva para `READY`.
 *
 * Grava dois fatos, não um: a Task ganhou Project (e talvez título, tipo e
 * prioridade) e a Task mudou de estado. São coisas diferentes, e o diário que
 * juntasse as duas perderia a informação de qual campo mudou.
 */
export async function promoteInboxTask(
  db: Database,
  input: PromoteInboxInput,
): Promise<Result<Task, InboxFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findTaskRow(tx, input);
    if (current === null) return null;

    if (current.status !== "INBOX") {
      return failed<InboxFailure>({ code: "NOT_IN_INBOX", status: current.status });
    }

    const project = await findProjectRow(tx, { userId: input.userId, projectId: input.projectId });
    if (project === null) {
      return failed<InboxFailure>({ code: "PROJECT_NOT_FOUND", projectId: input.projectId });
    }
    if (project.status === "ARCHIVED") {
      return failed<InboxFailure>({ code: "PROJECT_ARCHIVED", projectId: input.projectId });
    }

    const workflowId = input.workflowId ?? null;
    if (workflowId !== null) {
      const workflow = await findWorkflowRow(tx, { userId: input.userId, workflowId });
      if (workflow === null) {
        return failed<InboxFailure>({ code: "WORKFLOW_NOT_FOUND", workflowId });
      }
    }

    const changed = ["projectId"];
    if (input.title !== undefined && input.title !== current.title) changed.push("title");
    if (input.kind !== undefined && input.kind !== current.kind) changed.push("kind");
    if (input.priority !== undefined && input.priority !== current.priority) {
      changed.push("priority");
    }
    if (workflowId !== null) changed.push("workflowId");

    const [row] = await tx
      .update(tasks)
      .set({
        projectId: input.projectId,
        status: "READY",
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(workflowId === null ? {} : { workflowId }),
      })
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)))
      .returning();

    if (row === undefined) {
      throw new Error("A promoção da captura de Inbox não devolveu linha.");
    }

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: input.projectId,
      taskId: input.taskId,
      taskTitle: row.title,
      type: "task.updated",
      payload: { taskId: input.taskId, projectId: input.projectId, changed },
    });

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: input.projectId,
      taskId: input.taskId,
      taskTitle: row.title,
      type: "task.status_changed",
      payload: {
        taskId: input.taskId,
        projectId: input.projectId,
        from: "INBOX",
        to: "READY",
      },
    });

    return ok(toTask(row));
  });
}

/** Descarta a captura: `INBOX → CANCELLED`, sem Project e sem apagar a linha. */
export async function discardInboxTask(
  db: Database,
  input: { userId: string; taskId: string },
): Promise<Result<Task, InboxFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findTaskRow(tx, input);
    if (current === null) return null;

    if (current.status !== "INBOX") {
      return failed<InboxFailure>({ code: "NOT_IN_INBOX", status: current.status });
    }

    const [row] = await tx
      .update(tasks)
      .set({ status: "CANCELLED" })
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)))
      .returning();

    if (row === undefined) {
      throw new Error("O descarte da captura de Inbox não devolveu linha.");
    }

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: null,
      taskId: input.taskId,
      taskTitle: row.title,
      type: "task.status_changed",
      payload: { taskId: input.taskId, projectId: null, from: "INBOX", to: "CANCELLED" },
    });

    return ok(toTask(row));
  });
}
