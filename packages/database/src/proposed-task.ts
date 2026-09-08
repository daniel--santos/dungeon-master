import {
  type DiscoveredTask,
  type ProposedTask,
  type ProposedTaskListItem,
  type ProposedTaskStatus,
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  type TaskKind,
  type TaskPriority,
} from "@dungeon-master/contracts";
import {
  checkProposalApproval,
  decideProposalPolicy,
  type ProposalApprovalRejection,
} from "@dungeon-master/domain";
import { sanitizeCredentials } from "@dungeon-master/events";
import { and, count, desc, eq, isNull, type SQL } from "drizzle-orm";

import { recordDomainEvent } from "./activity.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { findProjectRow } from "./project.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { projects } from "./schema/project.js";
import { type ProposedTaskRow, proposedTasks } from "./schema/proposed-task.js";
import { taskDependencies, type TaskRow, tasks } from "./schema/task.js";
import { findTaskRow, loadDependencyEdges, lockTaskGraph } from "./task.js";
import { findWorkflowRow } from "./workflow.js";

/**
 * ProposedTask: o trabalho que um Run encontrou e não fez (planejamento
 * v0.4, Fase 5).
 *
 * **Gravação.** `persistDiscoveredTasks` é chamada por
 * `writeRunTerminalStatus`, dentro da transação que grava `run.result` e o
 * status terminal — nunca fora dela. Idempotente por `(origin_run_id,
 * position)`: reprocessar o mesmo resultado não duplica. O evento
 * `task.proposed` sai no mesmo COMMIT.
 *
 * **Decisão.** Aprovar cria uma Task de verdade no mesmo Project, filha da
 * Task de origem por padrão, com as dependências que quem aprovou escolheu,
 * tudo numa transação com CAS na proposta. Recusar é o mesmo CAS, sem Task.
 * Quem perde a corrida recebe a proposta como ficou, e nada é sobrescrito.
 */

export type ProposedTaskWriteFailure =
  | {
      /** O CAS perdeu: a proposta já foi decidida. `proposedTask` é o estado atual. */
      readonly code: "PROPOSAL_ALREADY_DECIDED";
      readonly proposedTask: ProposedTask;
    }
  | { readonly code: "PROJECT_ARCHIVED"; readonly projectId: string }
  | { readonly code: "PARENT_NOT_FOUND"; readonly parentTaskId: string }
  | { readonly code: "PARENT_IN_OTHER_PROJECT"; readonly parentTaskId: string }
  | { readonly code: "PARENT_IN_INBOX"; readonly parentTaskId: string }
  | { readonly code: "DEPENDENCY_NOT_FOUND"; readonly taskId: string }
  | { readonly code: "DEPENDENCY_IN_OTHER_PROJECT"; readonly taskId: string }
  | { readonly code: "DEPENDENCY_IN_INBOX"; readonly taskId: string }
  | { readonly code: "SELF_DEPENDENCY"; readonly taskId: string }
  | { readonly code: "DEPENDENCY_CYCLE"; readonly path: readonly string[] }
  | { readonly code: "WORKFLOW_NOT_FOUND"; readonly workflowId: string };

export function toProposedTask(row: ProposedTaskRow): ProposedTask {
  return {
    id: row.id,
    projectId: row.projectId,
    originTaskId: row.originTaskId,
    originRunId: row.originRunId,
    title: row.title,
    description: row.description,
    rationale: row.rationale,
    status: row.status,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    note: row.note,
    createdTaskId: row.createdTaskId,
    createdAt: row.createdAt.toISOString(),
  };
}

// --------------------------------------------------------------------------
// Gravação no desfecho do Run
// --------------------------------------------------------------------------

export interface PersistDiscoveredTasksInput {
  userId: string;
  projectId: string;
  originTaskId: string;
  originRunId: string;
  discovered: readonly DiscoveredTask[];
}

/**
 * Um título que a Task criada na aprovação aceita.
 *
 * O agente escreve o que quiser; a Task exige título não vazio e com teto. A
 * normalização é feita **na gravação** da proposta, e não na aprovação, para
 * a lista mostrar exatamente o que a aprovação vai criar.
 */
function normalizarTitulo(title: string): string {
  const limpo = sanitizeCredentials(title).trim().slice(0, TASK_TITLE_MAX_LENGTH).trim();
  return limpo.length === 0 ? "(proposta sem título)" : limpo;
}

function normalizarTexto(text: string | undefined): string | null {
  if (text === undefined) return null;
  const limpo = sanitizeCredentials(text).trim().slice(0, TASK_DESCRIPTION_MAX_LENGTH);
  return limpo.length === 0 ? null : limpo;
}

/**
 * Grava os `discoveredTasks` de um resultado como propostas.
 *
 * Recebe um `DatabaseExecutor` porque **nunca é chamada sozinha**: quem chama
 * está na transação do desfecho do Run, e uma proposta que commitasse
 * separada do resultado poderia se perder em silêncio (CLAUDE.md, seção 9:
 * nada fire-and-forget no caminho de escrita de resultado).
 *
 * `ON CONFLICT DO NOTHING` sobre `(origin_run_id, position)` é a
 * idempotência. O evento de dashboard só sai quando alguma linha entrou de
 * fato, e leva a contagem: a tela mostra "N propostas novas" sem reler.
 */
export async function persistDiscoveredTasks(
  db: DatabaseExecutor,
  input: PersistDiscoveredTasksInput,
): Promise<{ inserted: number; proposedTaskIds: string[] }> {
  if (input.discovered.length === 0) return { inserted: 0, proposedTaskIds: [] };

  const values = input.discovered.map((discovered, position) => {
    const title = normalizarTitulo(discovered.title);
    const rationale = normalizarTexto(discovered.rationale);

    // O ponto de extensão da autoaprovação. Hoje só existe revisão humana; um
    // valor novo aqui precisa de implementação na mesma transação, e não de um
    // `if` esquecido que gravasse a proposta como se nada tivesse sido decidido.
    const policy = decideProposalPolicy({
      projectId: input.projectId,
      originTaskId: input.originTaskId,
      title,
      rationale,
    });
    if (policy !== "human-review") {
      throw new Error(`A política de proposta "${policy}" ainda não tem implementação.`);
    }

    return {
      id: newId(),
      userId: input.userId,
      projectId: input.projectId,
      originTaskId: input.originTaskId,
      originRunId: input.originRunId,
      position,
      title,
      description: normalizarTexto(discovered.description),
      rationale,
      status: "PROPOSED" as const,
    };
  });

  const inserted = await db
    .insert(proposedTasks)
    .values(values)
    .onConflictDoNothing({ target: [proposedTasks.originRunId, proposedTasks.position] })
    .returning({ id: proposedTasks.id });

  if (inserted.length > 0) {
    await appendDashboardEvent(db, {
      userId: input.userId,
      type: "task.proposed",
      payload: {
        projectId: input.projectId,
        taskId: input.originTaskId,
        runId: input.originRunId,
        count: inserted.length,
        proposedTaskIds: inserted.map((row) => row.id),
      },
    });
  }

  return { inserted: inserted.length, proposedTaskIds: inserted.map((row) => row.id) };
}

// --------------------------------------------------------------------------
// Leitura
// --------------------------------------------------------------------------

export async function findProposedTaskRow(
  db: DatabaseExecutor,
  input: { userId: string; proposedTaskId: string },
): Promise<ProposedTaskRow | null> {
  const [row] = await db
    .select()
    .from(proposedTasks)
    .where(and(eq(proposedTasks.id, input.proposedTaskId), eq(proposedTasks.userId, input.userId)));

  return row ?? null;
}

/** Trava a linha da proposta para o resto da transação. */
async function lockProposedTaskRow(
  db: DatabaseExecutor,
  input: { userId: string; proposedTaskId: string },
): Promise<ProposedTaskRow | null> {
  const [row] = await db
    .select()
    .from(proposedTasks)
    .where(and(eq(proposedTasks.id, input.proposedTaskId), eq(proposedTasks.userId, input.userId)))
    .for("update");

  return row ?? null;
}

const listItemSelection = {
  proposal: proposedTasks,
  originTaskTitle: tasks.title,
  projectTitle: projects.title,
} as const;

function toListItem(row: {
  proposal: ProposedTaskRow;
  originTaskTitle: string;
  projectTitle: string;
}): ProposedTaskListItem {
  return {
    ...toProposedTask(row.proposal),
    originTaskTitle: row.originTaskTitle,
    projectTitle: row.projectTitle,
  };
}

export async function getProposedTask(
  db: DatabaseExecutor,
  input: { userId: string; proposedTaskId: string },
): Promise<ProposedTaskListItem | null> {
  const [row] = await db
    .select(listItemSelection)
    .from(proposedTasks)
    .innerJoin(tasks, eq(tasks.id, proposedTasks.originTaskId))
    .innerJoin(projects, eq(projects.id, proposedTasks.projectId))
    .where(and(eq(proposedTasks.id, input.proposedTaskId), eq(proposedTasks.userId, input.userId)));

  return row === undefined ? null : toListItem(row);
}

export interface ProposedTaskFilters {
  status?: ProposedTaskStatus | undefined;
  projectId?: string | undefined;
  /** A Task de origem. */
  taskId?: string | undefined;
}

export interface ListProposedTasksInput extends PageInput {
  userId: string;
  filters?: ProposedTaskFilters;
}

/**
 * A listagem, da proposta mais recente para a mais antiga.
 *
 * Os títulos da Task de origem e do Project vêm por junção, como em
 * `listApprovalGates`: a lista mostra os dois em toda linha, e sem eles seria
 * uma leitura por proposta. O desempate por `id` é obrigatório: o id é
 * UUIDv7, então dentro do mesmo instante ele é a ordem de inserção.
 */
export async function listProposedTasks(
  db: DatabaseExecutor,
  input: ListProposedTasksInput,
): Promise<PageResult<ProposedTaskListItem>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(proposedTasks.userId, input.userId)];
  if (filters.status !== undefined) conditions.push(eq(proposedTasks.status, filters.status));
  if (filters.projectId !== undefined) {
    conditions.push(eq(proposedTasks.projectId, filters.projectId));
  }
  if (filters.taskId !== undefined) conditions.push(eq(proposedTasks.originTaskId, filters.taskId));

  const where = and(...conditions);

  const rows = await db
    .select(listItemSelection)
    .from(proposedTasks)
    .innerJoin(tasks, eq(tasks.id, proposedTasks.originTaskId))
    .innerJoin(projects, eq(projects.id, proposedTasks.projectId))
    .where(where)
    .orderBy(desc(proposedTasks.createdAt), desc(proposedTasks.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(proposedTasks).where(where);

  return { items: rows.map(toListItem), total: counted?.total ?? 0 };
}

// --------------------------------------------------------------------------
// Decisão
// --------------------------------------------------------------------------

export interface ApproveProposedTaskInput {
  userId: string;
  proposedTaskId: string;
  /**
   * Mãe da Task criada.
   *
   * `undefined` é o padrão — a Task de origem da proposta —, e `null` cria uma
   * Task sem mãe. As duas chegam diferentes do JSON e precisam continuar
   * diferentes até aqui.
   */
  parentTaskId?: string | null | undefined;
  dependsOn?: readonly string[] | undefined;
  kind?: TaskKind | undefined;
  priority?: TaskPriority | undefined;
  workflowId?: string | null | undefined;
  note?: string | null | undefined;
}

/**
 * Aborta a transação carregando uma recusa de domínio.
 *
 * Existe para o caso em que o CAS da proposta perde **depois** de a Task ter
 * sido inserida: a recusa precisa desfazer a Task em vez de commitá-la órfã.
 */
class ProposedTaskRollback extends Error {
  constructor(readonly failure: ProposedTaskWriteFailure) {
    super(`proposed_task rollback: ${failure.code}`);
    this.name = "ProposedTaskRollback";
  }
}

function normalizarNota(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const limpo = sanitizeCredentials(note).trim();
  return limpo.length === 0 ? null : limpo;
}

function toTaskRef(row: TaskRow): {
  id: string;
  projectId: string | null;
  status: TaskRow["status"];
} {
  return { id: row.id, projectId: row.projectId, status: row.status };
}

/** Traduz a recusa do domínio na recusa do repositório, que carrega a proposta atual. */
function traduzirRecusa(
  rejection: ProposalApprovalRejection,
  proposal: ProposedTaskRow,
): ProposedTaskWriteFailure {
  if (rejection.code === "PROPOSAL_ALREADY_DECIDED") {
    return { code: "PROPOSAL_ALREADY_DECIDED", proposedTask: toProposedTask(proposal) };
  }
  return rejection;
}

/**
 * Aprova a proposta e cria a Task. Tudo ou nada.
 *
 * Ordem: a trava do grafo do usuário (a mesma de toda escrita de dependência,
 * porque a checagem de ciclo lê o grafo antes de mudá-lo), a linha da proposta
 * travada, **todas** as checagens, e só então as escritas — a Task em `READY`,
 * as arestas, o diário, o CAS na proposta e o evento de dashboard. Devolve
 * `null` quando a proposta não existe.
 *
 * Nada aqui pergunta a um modelo: mãe e dependências vêm de quem aprovou.
 */
export async function approveProposedTask(
  db: Database,
  input: ApproveProposedTaskInput,
): Promise<Result<ProposedTask, ProposedTaskWriteFailure> | null> {
  return await db
    .transaction(async (tx) => {
      await lockTaskGraph(tx, input.userId);

      const proposal = await lockProposedTaskRow(tx, input);
      if (proposal === null) return null;

      if (proposal.status !== "PROPOSED") {
        return failed<ProposedTaskWriteFailure>({
          code: "PROPOSAL_ALREADY_DECIDED",
          proposedTask: toProposedTask(proposal),
        });
      }

      const project = await findProjectRow(tx, {
        userId: input.userId,
        projectId: proposal.projectId,
      });
      if (project === null) {
        // A chave estrangeira garante o Project; chegar aqui é defeito.
        throw new Error(`O Project ${proposal.projectId} da proposta ${proposal.id} sumiu.`);
      }
      if (project.status === "ARCHIVED") {
        return failed<ProposedTaskWriteFailure>({
          code: "PROJECT_ARCHIVED",
          projectId: project.id,
        });
      }

      const parentTaskId =
        input.parentTaskId === undefined ? proposal.originTaskId : input.parentTaskId;
      let parent: TaskRow | null = null;
      if (parentTaskId !== null) {
        parent = await findTaskRow(tx, { userId: input.userId, taskId: parentTaskId });
        if (parent === null) {
          return failed<ProposedTaskWriteFailure>({ code: "PARENT_NOT_FOUND", parentTaskId });
        }
      }

      const dependsOn = [...new Set(input.dependsOn ?? [])];
      const dependencies: TaskRow[] = [];
      for (const taskId of dependsOn) {
        const row = await findTaskRow(tx, { userId: input.userId, taskId });
        if (row === null) {
          return failed<ProposedTaskWriteFailure>({ code: "DEPENDENCY_NOT_FOUND", taskId });
        }
        dependencies.push(row);
      }

      const workflowId = input.workflowId ?? null;
      if (workflowId !== null) {
        const workflow = await findWorkflowRow(tx, { userId: input.userId, workflowId });
        if (workflow === null) {
          return failed<ProposedTaskWriteFailure>({ code: "WORKFLOW_NOT_FOUND", workflowId });
        }
      }

      const newTaskId = newId();
      const edges = await loadDependencyEdges(tx, input.userId);
      const check = checkProposalApproval({
        proposal: { status: proposal.status, projectId: proposal.projectId },
        newTaskId,
        parent: parent === null ? null : toTaskRef(parent),
        dependencies: dependencies.map(toTaskRef),
        edges,
      });
      if (!check.ok) {
        return failed<ProposedTaskWriteFailure>(traduzirRecusa(check.rejection, proposal));
      }

      // ------------------------------------------------------------ escritas
      const agora = new Date();
      const note = normalizarNota(input.note);

      const [task] = await tx
        .insert(tasks)
        .values({
          id: newTaskId,
          userId: input.userId,
          projectId: proposal.projectId,
          parentTaskId,
          workflowId,
          title: proposal.title,
          description: proposal.description,
          kind: input.kind ?? "FEATURE",
          priority: input.priority ?? "MEDIUM",
          status: "READY",
        })
        .returning();

      if (task === undefined) throw new Error("A inserção em task não devolveu linha.");

      await recordDomainEvent(tx, {
        userId: input.userId,
        projectId: task.projectId,
        taskId: task.id,
        taskTitle: task.title,
        type: "task.created",
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          parentTaskId: task.parentTaskId,
          workflowId: task.workflowId,
          status: task.status,
          kind: task.kind,
          proposedTaskId: proposal.id,
          originTaskId: proposal.originTaskId,
          originRunId: proposal.originRunId,
        },
      });

      for (const dependency of dependencies) {
        await tx.insert(taskDependencies).values({
          userId: input.userId,
          taskId: task.id,
          dependsOnTaskId: dependency.id,
        });

        await recordDomainEvent(tx, {
          userId: input.userId,
          projectId: task.projectId,
          taskId: task.id,
          taskTitle: task.title,
          type: "task.dependency_created",
          payload: {
            taskId: task.id,
            dependsOnTaskId: dependency.id,
            projectId: task.projectId,
          },
        });
      }

      // O CAS. A linha está travada desde o começo, então perder aqui é defeito
      // — mas a condição fica escrita, porque é ela que define o contrato.
      const [decided] = await tx
        .update(proposedTasks)
        .set({ status: "APPROVED", decidedAt: agora, note, createdTaskId: task.id })
        .where(
          and(
            eq(proposedTasks.id, proposal.id),
            eq(proposedTasks.userId, input.userId),
            eq(proposedTasks.status, "PROPOSED"),
            isNull(proposedTasks.decidedAt),
          ),
        )
        .returning();

      if (decided === undefined) {
        const current = await findProposedTaskRow(tx, input);
        throw new ProposedTaskRollback({
          code: "PROPOSAL_ALREADY_DECIDED",
          proposedTask: toProposedTask(current ?? proposal),
        });
      }

      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "task.proposal.resolved",
        payload: {
          proposedTaskId: decided.id,
          projectId: decided.projectId,
          originTaskId: decided.originTaskId,
          originRunId: decided.originRunId,
          decision: "approve",
          status: decided.status,
          createdTaskId: task.id,
          title: decided.title,
        },
      });

      return ok(toProposedTask(decided));
    })
    .catch((error: unknown) => {
      if (error instanceof ProposedTaskRollback) return failed(error.failure);
      throw error;
    });
}

export interface RejectProposedTaskInput {
  userId: string;
  proposedTaskId: string;
  note?: string | null | undefined;
}

/**
 * Recusa a proposta. O mesmo CAS da aprovação, sem Task.
 *
 * Devolve `null` quando a proposta não existe, e `PROPOSAL_ALREADY_DECIDED`
 * com a proposta atual quando outra decisão chegou antes.
 */
export async function rejectProposedTask(
  db: Database,
  input: RejectProposedTaskInput,
): Promise<Result<ProposedTask, ProposedTaskWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const proposal = await lockProposedTaskRow(tx, input);
    if (proposal === null) return null;

    if (proposal.status !== "PROPOSED") {
      return failed<ProposedTaskWriteFailure>({
        code: "PROPOSAL_ALREADY_DECIDED",
        proposedTask: toProposedTask(proposal),
      });
    }

    const [decided] = await tx
      .update(proposedTasks)
      .set({ status: "REJECTED", decidedAt: new Date(), note: normalizarNota(input.note) })
      .where(
        and(
          eq(proposedTasks.id, proposal.id),
          eq(proposedTasks.userId, input.userId),
          eq(proposedTasks.status, "PROPOSED"),
          isNull(proposedTasks.decidedAt),
        ),
      )
      .returning();

    if (decided === undefined) {
      const current = await findProposedTaskRow(tx, input);
      return failed<ProposedTaskWriteFailure>({
        code: "PROPOSAL_ALREADY_DECIDED",
        proposedTask: toProposedTask(current ?? proposal),
      });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "task.proposal.resolved",
      payload: {
        proposedTaskId: decided.id,
        projectId: decided.projectId,
        originTaskId: decided.originTaskId,
        originRunId: decided.originRunId,
        decision: "reject",
        status: decided.status,
        createdTaskId: null,
        title: decided.title,
      },
    });

    return ok(toProposedTask(decided));
  });
}
