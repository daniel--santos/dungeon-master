import type { DiagnosticEvent, RoutingDecision, RunCreated } from "@dungeon-master/contracts";
import { AUTONOMY_MINIMUM_LEVEL, LIVE_RUN_STATUSES } from "@dungeon-master/domain";
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";

import { recordDomainEvent } from "./activity.js";
import { computeTaskSuggestions } from "./autonomy.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { insertRunEvent } from "./run-event.js";
import { createRunWithin } from "./run.js";
import { projects } from "./schema/project.js";
import { runs } from "./schema/run.js";
import { tasks } from "./schema/task.js";

/**
 * O auto-despacho (planejamento v0.4, Fase 9B): o Worker enfileira, por conta
 * própria, as Tasks que uma política criou (`created_by = POLICY`) num
 * Project cujo nível libera `AUTO_DISPATCH`.
 *
 * O que se lê e o que se decide:
 *
 * - **Elegível** é a Task `POLICY` em `READY` sem Run nenhum, num Project
 *   ativo de nível ≥ 3. Uma Task com Run — mesmo cancelado — já ganhou a
 *   sua chance automática: o que vier depois é decisão do usuário.
 * - **Um de cada vez por Project**: enquanto um Run automático do Project
 *   estiver vivo, o próximo espera.
 * - **As sugestões decidem o Loadout e o Workflow** (regras de roteamento ou
 *   os padrões); o Model é roteado dentro da criação, como em `POST /runs`.
 *   Sem Loadout sugerido não há despacho.
 * - **As mesmas recusas** da criação pela API — disjuntor, orçamento,
 *   capability — e a política de partida exigindo `AUTO_APPROVE`: uma
 *   partida que uma política não autorizou expressamente é do usuário.
 *
 * Tudo idempotente: a Task é travada, a elegibilidade é reconferida sob a
 * trava, e um Run só nasce se ainda não houver nenhum.
 */

export interface DispatchableTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
}

/**
 * As Tasks elegíveis, uma por Project, da mais antiga para a mais nova.
 *
 * O nível é comparado no SQL com o degrau do domínio: é a única fonte de
 * "o que o nível 3 libera", e uma Task de um Project rebaixado some da lista
 * na passada seguinte — é assim que `autonomy.changed` para baixo para o laço.
 */
export async function listDispatchableTasks(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<DispatchableTask[]> {
  const nivelMinimo = AUTONOMY_MINIMUM_LEVEL.AUTO_DISPATCH;
  const rows = await db
    .select({ taskId: tasks.id, projectId: tasks.projectId, title: tasks.title })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.userId, input.userId),
        eq(tasks.createdBy, "POLICY"),
        eq(tasks.status, "READY"),
        eq(projects.status, "ACTIVE"),
        sql`${projects.autonomyLevel} >= ${nivelMinimo}`,
        notExists(db.select({ id: runs.id }).from(runs).where(eq(runs.taskId, tasks.id))),
      ),
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id));

  const porProject = new Map<string, DispatchableTask>();
  for (const row of rows) {
    if (row.projectId === null || porProject.has(row.projectId)) continue;
    porProject.set(row.projectId, {
      taskId: row.taskId,
      projectId: row.projectId,
      title: row.title,
    });
  }
  return [...porProject.values()];
}

/** O Project tem um Run automático vivo? Então o próximo espera. */
export async function hasLivePolicyRun(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: runs.id })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(
      and(
        eq(runs.userId, input.userId),
        eq(tasks.projectId, input.projectId),
        eq(runs.createdBy, "POLICY"),
        inArray(runs.status, [...LIVE_RUN_STATUSES]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type DispatchSkipCode =
  | "TASK_NOT_ELIGIBLE"
  | "PROJECT_BUSY"
  | "NO_LOADOUT"
  | "AUTOMATION_NOT_ALLOWED"
  | "POLICY_REQUIRES_APPROVAL"
  | "POLICY_DENIED"
  | "BUDGET_EXCEEDED"
  | "BREAKER_OPEN"
  | "CAPABILITY_BLOCKED"
  | "RUN_NOT_ALLOWED"
  | "OTHER";

export type DispatchOutcome =
  | {
      readonly kind: "created";
      readonly run: RunCreated;
      readonly loadout: RoutingDecision;
      readonly workflow: RoutingDecision;
    }
  | { readonly kind: "skipped"; readonly code: DispatchSkipCode; readonly reason: string };

/**
 * Despacha uma Task elegível: um Run com `createdBy = POLICY`, tudo ou nada.
 *
 * Uma recusa não lança e **commita** o que a explica — o `budget.exceeded`,
 * o `policy.decided`, o `dispatch.skipped` —, porque a auditoria de uma
 * decisão automática é metade da decisão.
 */
export async function dispatchTask(
  db: Database,
  input: { userId: string; taskId: string; now?: Date },
): Promise<DispatchOutcome> {
  const now = input.now ?? new Date();

  return await db.transaction(async (tx) => {
    const travada = await tx.execute<{ id: string }>(
      sql`select ${tasks.id} from ${tasks}
          where ${tasks.id} = ${input.taskId} and ${tasks.userId} = ${input.userId}
          for update`,
    );
    if (travada.rows.length === 0) {
      return { kind: "skipped", code: "TASK_NOT_ELIGIBLE", reason: "A Task não existe mais." };
    }

    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)));
    if (task === undefined || task.projectId === null) {
      return { kind: "skipped", code: "TASK_NOT_ELIGIBLE", reason: "A Task não tem Project." };
    }

    const pular = async (code: DispatchSkipCode, reason: string): Promise<DispatchOutcome> => {
      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "dispatch.skipped",
        payload: { taskId: task.id, projectId: task.projectId, title: task.title, code, reason },
      });
      return { kind: "skipped", code, reason };
    };

    if (task.createdBy !== "POLICY" || task.status !== "READY") {
      return await pular(
        "TASK_NOT_ELIGIBLE",
        `A Task está em ${task.status} com origem ${task.createdBy}; só uma Task POLICY em READY é despachada.`,
      );
    }
    const [existente] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.taskId, task.id))
      .limit(1);
    if (existente !== undefined) {
      return await pular(
        "TASK_NOT_ELIGIBLE",
        `A Task já tem o Run ${existente.id}; uma Task só ganha um Run automático.`,
      );
    }
    if (await hasLivePolicyRun(tx, { userId: input.userId, projectId: task.projectId })) {
      return await pular(
        "PROJECT_BUSY",
        "O Project já tem um Run automático vivo; um de cada vez.",
      );
    }

    // -------------------------------------------------------- sugestões
    const sugestoes = await computeTaskSuggestions(tx, {
      userId: input.userId,
      taskId: task.id,
      now,
    });
    if (sugestoes === null) {
      return await pular("TASK_NOT_ELIGIBLE", "A Task sumiu durante o despacho.");
    }
    if (!sugestoes.ok) {
      return await pular(
        sugestoes.failure.code === "AUTOMATION_NOT_ALLOWED"
          ? "AUTOMATION_NOT_ALLOWED"
          : "TASK_NOT_ELIGIBLE",
        `As sugestões foram recusadas: ${sugestoes.failure.code}.`,
      );
    }
    const { loadout, workflow } = sugestoes.value;
    if (loadout.selectedId === null) {
      return await pular("NO_LOADOUT", `Sem Loadout sugerido: ${loadout.reason}`);
    }

    // Um Workflow escolhido por regra passa a ser o da Task antes da captura:
    // é assim que o Run congela a versão certa. O padrão (o Workflow que a
    // Task já tinha, ou nenhum) não muda nada.
    if (workflow.ruleId !== null && workflow.selectedId !== task.workflowId) {
      await tx
        .update(tasks)
        .set({ workflowId: workflow.selectedId })
        .where(and(eq(tasks.id, task.id), eq(tasks.userId, input.userId)));
      await recordDomainEvent(tx, {
        userId: input.userId,
        projectId: task.projectId,
        taskId: task.id,
        taskTitle: task.title,
        type: "task.updated",
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          changed: ["workflowId"],
          from: task.workflowId,
          to: workflow.selectedId,
          decidedBy: workflow.decidedBy,
        },
      });
    }

    // ------------------------------------------------------------ o Run
    const criado = await createRunWithin(tx, {
      userId: input.userId,
      taskId: task.id,
      loadoutId: loadout.selectedId,
      createdBy: "POLICY",
      requireAutoApproval: true,
    });
    if (criado === null) {
      return await pular("TASK_NOT_ELIGIBLE", "A Task sumiu durante a criação do Run.");
    }
    if (!criado.ok) {
      const code = codigoDaRecusa(criado.failure.code);
      return await pular(code, descreverRecusa(criado.failure));
    }

    const diagnostico: DiagnosticEvent = {
      type: "Diagnostic",
      timestamp: now.toISOString(),
      harness: criado.value.harnessKey,
      level: "INFO",
      source: "RUNTIME",
      code: "AUTO_DISPATCHED",
      message:
        `Run enfileirado pelo auto-despacho: Loadout ${loadout.decidedBy} (${loadout.reason}); ` +
        `Workflow ${workflow.decidedBy} (${workflow.reason}); partida ${criado.value.policyDecision.decidedBy}.`,
    };
    await insertRunEvent(tx, {
      userId: input.userId,
      runId: criado.value.id,
      event: { type: diagnostico.type, timestamp: now, payload: diagnostico },
    });

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "dispatch.created",
      payload: {
        taskId: task.id,
        projectId: task.projectId,
        title: task.title,
        runId: criado.value.id,
        loadoutId: loadout.selectedId,
        loadoutDecidedBy: loadout.decidedBy,
        workflowId: workflow.selectedId,
        workflowDecidedBy: workflow.decidedBy,
        policyDecidedBy: criado.value.policyDecision.decidedBy,
      },
    });

    return { kind: "created", run: criado.value, loadout, workflow };
  });
}

function codigoDaRecusa(code: string): DispatchSkipCode {
  switch (code) {
    case "POLICY_REQUIRES_APPROVAL":
    case "POLICY_DENIED":
    case "BUDGET_EXCEEDED":
    case "BREAKER_OPEN":
    case "CAPABILITY_BLOCKED":
    case "RUN_NOT_ALLOWED":
      return code;
    default:
      return "OTHER";
  }
}

function descreverRecusa(failure: { code: string } & Record<string, unknown>): string {
  switch (failure.code) {
    case "POLICY_REQUIRES_APPROVAL":
    case "POLICY_DENIED":
      return (failure["decision"] as { reason: string }).reason;
    case "BUDGET_EXCEEDED":
      return (failure["breach"] as { reason: string }).reason;
    case "BREAKER_OPEN":
      return (failure["breaker"] as { reason: string }).reason;
    default:
      return `A criação do Run foi recusada: ${failure.code}.`;
  }
}
