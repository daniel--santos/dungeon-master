import {
  DEFAULT_TASK_SORT,
  DEFAULT_TASK_SORT_ORDER,
  type SortOrder,
  type Task,
  type TaskDetail,
  type TaskKind,
  type TaskPriority,
  type TaskReopening,
  type TaskSort,
  type TaskStatus,
  type TaskSummary,
} from "@dungeon-master/contracts";
import {
  checkTaskDependencies,
  checkTaskTransition,
  type TaskDependencyEdge,
  type TaskTransitionRejection,
  taskStatusRequiresProject,
  wouldCreateDependencyCycle,
} from "@dungeon-master/domain";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";

import { recordDomainEvent } from "./activity.js";
import type { Database } from "./client.js";
import type { DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import {
  escapeLikePattern,
  failed,
  ok,
  type PageInput,
  type PageResult,
  type Result,
} from "./result.js";
import { findProjectRow } from "./project.js";
import { proposedTasks } from "./schema/proposed-task.js";
import { taskDependencies, tasks, type TaskRow } from "./schema/task.js";
import { findWorkflowRow } from "./workflow.js";

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    parentTaskId: row.parentTaskId,
    workflowId: row.workflowId,
    title: row.title,
    description: row.description,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const summaryColumns = {
  id: tasks.id,
  projectId: tasks.projectId,
  title: tasks.title,
  kind: tasks.kind,
  status: tasks.status,
  priority: tasks.priority,
} as const;

// --------------------------------------------------------------------------
// Falhas de regra
// --------------------------------------------------------------------------

/**
 * Por que uma escrita de Task foi recusada.
 *
 * Todas viram `409` na API, menos as de "não encontrado", que existem porque o
 * id recusado veio no corpo e não no caminho: um `projectId` inexistente em
 * `POST /tasks` não é o mesmo 404 de uma rota que não casa.
 */
export type TaskWriteFailure =
  | { readonly code: "PROJECT_NOT_FOUND"; readonly projectId: string }
  | { readonly code: "PROJECT_ARCHIVED"; readonly projectId: string }
  | { readonly code: "PARENT_NOT_FOUND"; readonly parentTaskId: string }
  | { readonly code: "PARENT_IN_OTHER_PROJECT"; readonly parentTaskId: string }
  | { readonly code: "PARENT_IN_INBOX"; readonly parentTaskId: string }
  | { readonly code: "PARENT_CYCLE"; readonly path: readonly string[] }
  | { readonly code: "TASK_IN_INBOX" }
  | { readonly code: "TASK_HAS_SUBTREE" }
  | { readonly code: "PROJECT_REQUIRED"; readonly to: TaskStatus }
  | { readonly code: "WORKFLOW_NOT_FOUND"; readonly workflowId: string }
  | { readonly code: "TRANSITION_REJECTED"; readonly rejection: TaskTransitionRejection };

/**
 * Por que uma escrita de dependência foi recusada.
 *
 * As duas portas exigem toda dependência no mesmo Project — o grafo é do
 * Project —, e por isso as duas podem não encontrar uma Task que existe, mas
 * em outro lugar. `DEPENDENCY_NOT_FOUND` e `DEPENDENCY_IN_INBOX` são só da
 * troca do conjunto inteiro (`replaceTaskDependencies`): na rota por aresta,
 * uma Task que não existe é `null` e uma em INBOX é `TASK_IN_INBOX`.
 */
export type DependencyWriteFailure =
  | { readonly code: "SELF_DEPENDENCY"; readonly taskId: string }
  | { readonly code: "TASK_IN_INBOX" }
  | { readonly code: "DEPENDENCY_CYCLE"; readonly path: readonly string[] }
  | { readonly code: "DEPENDENCY_NOT_FOUND"; readonly taskId: string }
  | { readonly code: "DEPENDENCY_IN_OTHER_PROJECT"; readonly taskId: string }
  | { readonly code: "DEPENDENCY_IN_INBOX"; readonly taskId: string };

// --------------------------------------------------------------------------
// Leitura
// --------------------------------------------------------------------------

export async function findTaskRow(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string },
): Promise<TaskRow | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)));

  return row ?? null;
}

export interface TaskFilters {
  projectId?: string | undefined;
  parentTaskId?: string | undefined;
  kind?: TaskKind | undefined;
  priority?: TaskPriority | undefined;
  status?: readonly TaskStatus[] | undefined;
  /**
   * Estados escondidos, aplicados depois de `status`.
   *
   * Existe para o caso mais comum da tela de Missões, "tudo menos as capturas":
   * sem ele, tirar um estado obrigaria a listar os outros oito na URL, e cada
   * estado novo da máquina sumiria da lista em silêncio.
   */
  excludeStatus?: readonly TaskStatus[] | undefined;
  /** Trecho do título, sem diferenciar maiúsculas. */
  q?: string | undefined;
}

export interface ListTasksInput extends PageInput {
  userId: string;
  filters?: TaskFilters;
  /** Campo de ordenação. Padrão: `updatedAt`. */
  sort?: TaskSort | undefined;
  /** Direção. Padrão: `desc`. */
  order?: SortOrder | undefined;
}

/**
 * Prioridade em número, para `sort=priority` ordenar por urgência.
 *
 * `ORDER BY priority` sozinho ordenaria pela ordem do tipo `task_priority` no
 * PostgreSQL, que hoje coincide com o peso mas é decisão de migração, não de
 * apresentação; e um `ORDER BY priority::text` ordenaria pelo alfabeto, pondo
 * `HIGH` antes de `URGENT`. O peso fica escrito aqui, onde alguém consegue lê-lo
 * sem abrir a migração. Um valor novo de prioridade sem linha neste `CASE` cai
 * no `else` e vai para o fim da lista.
 */
const PRIORITY_RANK = sql`case ${tasks.priority}
  when 'URGENT' then 4
  when 'HIGH' then 3
  when 'MEDIUM' then 2
  when 'LOW' then 1
  else 0
end`;

/**
 * A expressão de ordenação, já com o desempate.
 *
 * O desempate por `id` é obrigatório e vem sempre na mesma direção do pedido:
 * sem ele, duas Tasks com o mesmo `updated_at` — ou com a mesma prioridade, que
 * é o caso comum — poderiam trocar de lugar entre uma página e a seguinte, e um
 * item apareceria duas vezes ou nenhuma.
 */
function taskOrderBy(sort: TaskSort, order: SortOrder): SQL[] {
  const direcao = order === "asc" ? asc : desc;

  const campo: Record<TaskSort, SQL> = {
    updatedAt: direcao(tasks.updatedAt),
    createdAt: direcao(tasks.createdAt),
    priority: direcao(PRIORITY_RANK),
    title: direcao(tasks.title),
  };

  return [campo[sort], direcao(tasks.id)];
}

/**
 * A listagem com filtros, ordenada por `sort` e `order`.
 *
 * O padrão é `updatedAt desc`, a ordem de "no que eu estava mexendo": é o que a
 * tela abre mostrando, e o que valia antes de existir escolha.
 */
/**
 * O que conta como reabertura: uma linha de `activity` do tipo
 * `task.status_changed` cuja transição **sai** de `COMPLETED`.
 *
 * Um fragmento só, usado pela contagem do Bestiário e pela instanciação da
 * Conquista de nêmesis: duas definições de "reaberta" divergiriam na primeira
 * mudança, e a tela mostraria um número que a Conquista não reconhece. O
 * fragmento pressupõe `activity` com o alias `a`.
 *
 * A máquina de estados de hoje não tem aresta saindo de `COMPLETED`, então a
 * consulta não encontra nada; ela existe pronta porque é ela que passa a valer
 * no dia em que reabrir uma Task for possível.
 */
export const TASK_REOPENING_ACTIVITY = sql`a.type = 'task.status_changed'
  and a.payload ->> 'from' = 'COMPLETED'
  and a.task_id is not null`;

export interface ListTaskReopeningsInput {
  userId: string;
  kind?: TaskKind | undefined;
}

/**
 * As Tasks que já saíram de `COMPLETED`, com quantas vezes e quando foi a última.
 *
 * Só quem tem pelo menos uma: a lista é esparsa de propósito, e quem lê junta
 * por `taskId` com a página de Tasks que já tem. Da reabertura mais recente
 * para a mais antiga, com desempate por id para a ordem ser estável.
 */
export async function listTaskReopenings(
  db: DatabaseExecutor,
  input: ListTaskReopeningsInput,
): Promise<TaskReopening[]> {
  const kindFilter = input.kind === undefined ? sql`` : sql`and k.kind = ${input.kind}`;

  const result = await db.execute<{ task_id: string; total: string; last_at: Date }>(
    sql`select a.task_id, count(*) as total, max(a.created_at) as last_at
        from activity a
        join task k on k.id = a.task_id
        where a.user_id = ${input.userId}
          and ${TASK_REOPENING_ACTIVITY}
          ${kindFilter}
        group by a.task_id
        order by max(a.created_at) desc, a.task_id desc`,
  );

  return result.rows.map((row) => ({
    taskId: row.task_id,
    count: Number(row.total),
    lastReopenedAt: new Date(row.last_at).toISOString(),
  }));
}

export async function listTasks(
  db: DatabaseExecutor,
  input: ListTasksInput,
): Promise<PageResult<Task>> {
  const filters = input.filters ?? {};
  const conditions = [eq(tasks.userId, input.userId)];

  if (filters.projectId !== undefined) conditions.push(eq(tasks.projectId, filters.projectId));
  if (filters.parentTaskId !== undefined) {
    conditions.push(eq(tasks.parentTaskId, filters.parentTaskId));
  }
  if (filters.kind !== undefined) conditions.push(eq(tasks.kind, filters.kind));
  if (filters.priority !== undefined) conditions.push(eq(tasks.priority, filters.priority));
  if (filters.status !== undefined && filters.status.length > 0) {
    conditions.push(inArray(tasks.status, [...filters.status]));
  }
  if (filters.excludeStatus !== undefined && filters.excludeStatus.length > 0) {
    conditions.push(notInArray(tasks.status, [...filters.excludeStatus]));
  }
  if (filters.q !== undefined && filters.q !== "") {
    conditions.push(ilike(tasks.title, `%${escapeLikePattern(filters.q)}%`));
  }

  const where = and(...conditions);

  const rows = await db
    .select()
    .from(tasks)
    .where(where)
    .orderBy(
      ...taskOrderBy(input.sort ?? DEFAULT_TASK_SORT, input.order ?? DEFAULT_TASK_SORT_ORDER),
    )
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(tasks).where(where);

  return { items: rows.map(toTask), total: counted?.total ?? 0 };
}

async function loadChildren(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string },
): Promise<TaskSummary[]> {
  return await db
    .select(summaryColumns)
    .from(tasks)
    .where(and(eq(tasks.userId, input.userId), eq(tasks.parentTaskId, input.taskId)))
    .orderBy(asc(tasks.createdAt), asc(tasks.id));
}

/**
 * O outro lado de uma aresta precisa estar no mesmo Project.
 *
 * post-mortem #19 (2026-09-08): a leitura da linhagem filtrava só por
 * `user_id`, então uma aresta entre Projects diferentes — que a rota por
 * aresta aceitava criar — levava título, descrição e resumo do último Run de
 * uma Task de outra Campanha para dentro do bloco `<context>` e do
 * `get_task_context`. O sistema é single-user: não é vazamento entre
 * usuários, é a promessa da Fase 7 ("só o contexto relevante da Campanha")
 * furada. A criação passou a recusar a aresta, mas quem já tem uma gravada
 * só é protegido por este filtro na leitura.
 *
 * `undefined` é "sem filtro", e existe para um caso só: o portão de transição
 * de estado, que continua esperando **toda** dependência gravada, inclusive a
 * torta. Ali a aresta atrasa o trabalho; ela não vira texto de prompt.
 */
function mesmoProject(projectId: string | null | undefined): SQL | undefined {
  if (projectId === undefined) return undefined;
  return projectId === null ? isNull(tasks.projectId) : eq(tasks.projectId, projectId);
}

/** As Tasks das quais esta depende, no Project dela. */
async function loadDependencies(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string; projectId?: string | null },
): Promise<TaskSummary[]> {
  return await db
    .select(summaryColumns)
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(
      and(
        eq(taskDependencies.userId, input.userId),
        eq(taskDependencies.taskId, input.taskId),
        mesmoProject(input.projectId),
      ),
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id));
}

/** As Tasks que esperam por esta, no Project dela. */
async function loadDependents(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string; projectId?: string | null },
): Promise<TaskSummary[]> {
  return await db
    .select(summaryColumns)
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .where(
      and(
        eq(taskDependencies.userId, input.userId),
        eq(taskDependencies.dependsOnTaskId, input.taskId),
        mesmoProject(input.projectId),
      ),
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id));
}

/**
 * Os ids do outro lado das arestas desta Task, **sem** filtrar por Project.
 *
 * Quem troca o conjunto inteiro precisa enxergar também a aresta torta que
 * uma versão anterior gravou entre Projects: escondê-la aqui a deixaria para
 * sempre no banco, porque um `PUT` só apaga o que ele vê.
 */
async function loadDependencyTargetIds(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string },
): Promise<string[]> {
  const rows = await db
    .select({ id: taskDependencies.dependsOnTaskId })
    .from(taskDependencies)
    .where(
      and(eq(taskDependencies.userId, input.userId), eq(taskDependencies.taskId, input.taskId)),
    );
  return rows.map((row) => row.id);
}

/**
 * Quantas propostas de trabalho vindas dos Runs desta Task ainda esperam
 * decisão. Uma contagem só, sobre o índice `(origin_task_id, status)`.
 */
export async function countOpenProposalsForTask(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string },
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(proposedTasks)
    .where(
      and(
        eq(proposedTasks.userId, input.userId),
        eq(proposedTasks.originTaskId, input.taskId),
        eq(proposedTasks.status, "PROPOSED"),
      ),
    );
  return row?.total ?? 0;
}

export async function getTaskDetail(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string },
): Promise<TaskDetail | null> {
  const row = await findTaskRow(db, input);
  if (row === null) return null;

  // Em série, e não em `Promise.all`: dentro de uma transação as consultas
  // compartilham a mesma conexão, e o `pg` avisa (e vai passar a recusar) duas
  // consultas simultâneas no mesmo cliente.
  const children = await loadChildren(db, input);
  const dependencies = await loadDependencies(db, { ...input, projectId: row.projectId });
  const dependents = await loadDependents(db, { ...input, projectId: row.projectId });
  const openProposalCount = await countOpenProposalsForTask(db, input);

  return { ...toTask(row), children, dependencies, dependents, openProposalCount };
}

// --------------------------------------------------------------------------
// Grafos: dependências e hierarquia
// --------------------------------------------------------------------------

/**
 * Todas as arestas de dependência do usuário.
 *
 * O grafo inteiro cabe na memória com folga num sistema pessoal, e carregá-lo
 * de uma vez deixa a checagem de ciclo ser a função pura já testada em
 * `@dungeon-master/domain`, em vez de uma consulta recursiva escrita de novo em
 * SQL e nunca exercitada.
 */
export async function loadDependencyEdges(
  db: DatabaseExecutor,
  userId: string,
): Promise<TaskDependencyEdge[]> {
  return await db
    .select({ taskId: taskDependencies.taskId, dependsOnTaskId: taskDependencies.dependsOnTaskId })
    .from(taskDependencies)
    .where(eq(taskDependencies.userId, userId));
}

/**
 * As arestas "esta Task é filha daquela", no mesmo formato do grafo de
 * dependências, para reaproveitar a mesma detecção de ciclo. Uma hierarquia com
 * ciclo é tão inalcançável quanto um impasse de dependências.
 */
async function loadParentEdges(
  db: DatabaseExecutor,
  userId: string,
): Promise<TaskDependencyEdge[]> {
  const rows = await db
    .select({ id: tasks.id, parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNotNull(tasks.parentTaskId)));

  return rows.flatMap((row) =>
    row.parentTaskId === null ? [] : [{ taskId: row.id, dependsOnTaskId: row.parentTaskId }],
  );
}

/**
 * Serializa as escritas que dependem de ler o grafo antes de mudá-lo.
 *
 * Sem a trava, duas requisições simultâneas leem o mesmo grafo sem ciclo, cada
 * uma insere a sua aresta e o ciclo aparece com as duas transações commitadas —
 * a checagem de cada uma respondia sobre um grafo que já não existia. A trava é
 * por usuário e é liberada no fim da transação.
 */
export async function lockTaskGraph(db: DatabaseExecutor, userId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
}

// --------------------------------------------------------------------------
// Escrita
// --------------------------------------------------------------------------

export interface CreateTaskInput {
  userId: string;
  projectId: string;
  parentTaskId?: string | null;
  /** Workflow que os Runs desta Task seguem. Precisa existir para o usuário. */
  workflowId?: string | null;
  title: string;
  description?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority;
}

/**
 * Cria uma Task já em `READY`.
 *
 * `INBOX` é alcançado só pela captura da Inbox: uma Task criada com Project
 * escolhido já passou pelo trabalho que promover faria.
 */
export async function createTask(
  db: Database,
  input: CreateTaskInput,
): Promise<Result<Task, TaskWriteFailure>> {
  return await db.transaction(async (tx) => {
    const project = await findProjectRow(tx, { userId: input.userId, projectId: input.projectId });
    if (project === null) {
      return failed<TaskWriteFailure>({ code: "PROJECT_NOT_FOUND", projectId: input.projectId });
    }
    if (project.status === "ARCHIVED") {
      return failed<TaskWriteFailure>({ code: "PROJECT_ARCHIVED", projectId: input.projectId });
    }

    const parentTaskId = input.parentTaskId ?? null;

    if (parentTaskId !== null) {
      const parent = await findTaskRow(tx, { userId: input.userId, taskId: parentTaskId });
      if (parent === null) {
        return failed<TaskWriteFailure>({ code: "PARENT_NOT_FOUND", parentTaskId });
      }
      if (parent.status === "INBOX") {
        return failed<TaskWriteFailure>({ code: "PARENT_IN_INBOX", parentTaskId });
      }
      if (parent.projectId !== input.projectId) {
        return failed<TaskWriteFailure>({ code: "PARENT_IN_OTHER_PROJECT", parentTaskId });
      }
    }

    const workflowId = input.workflowId ?? null;
    if (workflowId !== null) {
      const workflow = await findWorkflowRow(tx, { userId: input.userId, workflowId });
      if (workflow === null) {
        return failed<TaskWriteFailure>({ code: "WORKFLOW_NOT_FOUND", workflowId });
      }
    }

    const [row] = await tx
      .insert(tasks)
      .values({
        id: newId(),
        userId: input.userId,
        projectId: input.projectId,
        parentTaskId,
        workflowId,
        title: input.title,
        description: input.description ?? null,
        kind: input.kind ?? "FEATURE",
        priority: input.priority ?? "MEDIUM",
        status: "READY",
      })
      .returning();

    if (row === undefined) {
      throw new Error("A inserção em task não devolveu linha.");
    }

    const task = toTask(row);

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
      },
    });

    return ok(task);
  });
}

export interface UpdateTaskPatch {
  projectId?: string;
  parentTaskId?: string | null;
  /** `null` volta ao Run simples. Não afeta Runs já criados: cada um congelou a sua versão. */
  workflowId?: string | null;
  title?: string;
  description?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority;
}

export interface UpdateTaskInput {
  userId: string;
  taskId: string;
  patch: UpdateTaskPatch;
}

/**
 * Edita os campos editáveis. `status` não passa por aqui.
 *
 * Trocar o Project só é permitido numa Task sem mãe e sem filhas: mover uma
 * árvore inteira é trabalho da Fase 5, e mover só um nó deixaria mãe e filha em
 * Projects diferentes, o que nenhuma outra regra conseguiria consertar depois.
 */
export async function updateTask(
  db: Database,
  input: UpdateTaskInput,
): Promise<Result<TaskDetail, TaskWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    await lockTaskGraph(tx, input.userId);

    const current = await findTaskRow(tx, input);
    if (current === null) return null;

    const { patch } = input;
    const mexeNaEstrutura = patch.projectId !== undefined || patch.parentTaskId !== undefined;

    // Uma Task de Inbox não tem mãe, filhas nem dependências: dar Project a ela
    // é promover, e promover tem rota própria, que também muda o status.
    if (current.status === "INBOX" && mexeNaEstrutura) {
      return failed<TaskWriteFailure>({ code: "TASK_IN_INBOX" });
    }

    const targetProjectId = patch.projectId ?? current.projectId;

    if (patch.projectId !== undefined && patch.projectId !== current.projectId) {
      const project = await findProjectRow(tx, {
        userId: input.userId,
        projectId: patch.projectId,
      });
      if (project === null) {
        return failed<TaskWriteFailure>({ code: "PROJECT_NOT_FOUND", projectId: patch.projectId });
      }
      if (project.status === "ARCHIVED") {
        return failed<TaskWriteFailure>({ code: "PROJECT_ARCHIVED", projectId: patch.projectId });
      }

      const children = await loadChildren(tx, input);
      if (current.parentTaskId !== null || children.length > 0) {
        return failed<TaskWriteFailure>({ code: "TASK_HAS_SUBTREE" });
      }
    }

    if (patch.parentTaskId !== undefined && patch.parentTaskId !== null) {
      const parentTaskId = patch.parentTaskId;

      if (parentTaskId === input.taskId) {
        return failed<TaskWriteFailure>({
          code: "PARENT_CYCLE",
          path: [input.taskId, input.taskId],
        });
      }

      const parent = await findTaskRow(tx, { userId: input.userId, taskId: parentTaskId });
      if (parent === null) {
        return failed<TaskWriteFailure>({ code: "PARENT_NOT_FOUND", parentTaskId });
      }
      if (parent.status === "INBOX") {
        return failed<TaskWriteFailure>({ code: "PARENT_IN_INBOX", parentTaskId });
      }
      if (parent.projectId !== targetProjectId) {
        return failed<TaskWriteFailure>({ code: "PARENT_IN_OTHER_PROJECT", parentTaskId });
      }

      // A aresta atual sai antes da checagem: trocar de mãe não pode ser
      // recusado por causa do ciclo que a mãe antiga formaria.
      const edges = (await loadParentEdges(tx, input.userId)).filter(
        (edge) => edge.taskId !== input.taskId,
      );
      const cycle = wouldCreateDependencyCycle(edges, {
        taskId: input.taskId,
        dependsOnTaskId: parentTaskId,
      });
      if (cycle !== null) {
        return failed<TaskWriteFailure>({ code: "PARENT_CYCLE", path: cycle });
      }
    }

    if (
      patch.workflowId !== undefined &&
      patch.workflowId !== null &&
      patch.workflowId !== current.workflowId
    ) {
      const workflow = await findWorkflowRow(tx, {
        userId: input.userId,
        workflowId: patch.workflowId,
      });
      if (workflow === null) {
        return failed<TaskWriteFailure>({
          code: "WORKFLOW_NOT_FOUND",
          workflowId: patch.workflowId,
        });
      }
    }

    const changed: string[] = [];
    const values: UpdateTaskPatch = {};

    if (patch.workflowId !== undefined && patch.workflowId !== current.workflowId) {
      values.workflowId = patch.workflowId;
      changed.push("workflowId");
    }
    if (patch.projectId !== undefined && patch.projectId !== current.projectId) {
      values.projectId = patch.projectId;
      changed.push("projectId");
    }
    if (patch.parentTaskId !== undefined && patch.parentTaskId !== current.parentTaskId) {
      values.parentTaskId = patch.parentTaskId;
      changed.push("parentTaskId");
    }
    if (patch.title !== undefined && patch.title !== current.title) {
      values.title = patch.title;
      changed.push("title");
    }
    if (patch.description !== undefined && patch.description !== current.description) {
      values.description = patch.description;
      changed.push("description");
    }
    if (patch.kind !== undefined && patch.kind !== current.kind) {
      values.kind = patch.kind;
      changed.push("kind");
    }
    if (patch.priority !== undefined && patch.priority !== current.priority) {
      values.priority = patch.priority;
      changed.push("priority");
    }

    if (changed.length === 0) {
      const detail = await getTaskDetail(tx, input);
      return detail === null ? null : ok(detail);
    }

    await tx
      .update(tasks)
      .set(values)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)));

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: targetProjectId,
      taskId: input.taskId,
      taskTitle: values.title ?? current.title,
      type: "task.updated",
      payload: { taskId: input.taskId, projectId: targetProjectId, changed },
    });

    const detail = await getTaskDetail(tx, input);
    return detail === null ? null : ok(detail);
  });
}

export interface ChangeTaskStatusInput {
  userId: string;
  taskId: string;
  to: TaskStatus;
}

/**
 * A única porta para mudar o estado de uma Task.
 *
 * Filhas e dependências são lidas **dentro** da transação que aplica a
 * mudança: lidas fora, a checagem responderia sobre um estado que outra
 * requisição já mudou.
 */
export async function changeTaskStatus(
  db: Database,
  input: ChangeTaskStatusInput,
): Promise<Result<TaskDetail, TaskWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    await lockTaskGraph(tx, input.userId);

    const current = await findTaskRow(tx, input);
    if (current === null) return null;

    const children = await loadChildren(tx, input);
    const dependencies = await loadDependencies(tx, input);

    const check = checkTaskTransition({
      from: current.status,
      to: input.to,
      children,
      dependencies,
    });

    if (!check.ok) {
      return failed<TaskWriteFailure>({
        code: "TRANSITION_REJECTED",
        rejection: check.rejection,
      });
    }

    // A metade da restrição do banco que dá para explicar: sair de `INBOX` sem
    // Project violaria o `CHECK`, e um erro de constraint não diz ao usuário
    // que o que faltou foi escolher um Project.
    if (taskStatusRequiresProject(input.to) && current.projectId === null) {
      return failed<TaskWriteFailure>({ code: "PROJECT_REQUIRED", to: input.to });
    }

    await tx
      .update(tasks)
      .set({
        status: input.to,
        // `completed_at` é escrito uma vez só: `COMPLETED` é terminal, então
        // nada depois disso pode reabrir a Task e sujar o instante.
        ...(input.to === "COMPLETED" ? { completedAt: new Date() } : {}),
      })
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)));

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: current.projectId,
      taskId: input.taskId,
      taskTitle: current.title,
      type: "task.status_changed",
      payload: {
        taskId: input.taskId,
        projectId: current.projectId,
        from: current.status,
        to: input.to,
      },
    });

    const detail = await getTaskDetail(tx, input);
    return detail === null ? null : ok(detail);
  });
}

export interface TaskDependencyInput {
  userId: string;
  taskId: string;
  dependsOnTaskId: string;
}

/**
 * Cria a aresta "esta Task espera aquela".
 *
 * Idempotente, como todo `PUT`: repetir devolve o mesmo estado e não grava um
 * segundo fato. Devolve `null` quando qualquer das duas Tasks não existe. As
 * duas precisam estar no mesmo Project, pela mesma razão de
 * `replaceTaskDependencies`: o grafo é do Project.
 */
export async function addTaskDependency(
  db: Database,
  input: TaskDependencyInput,
): Promise<Result<TaskDetail, DependencyWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    await lockTaskGraph(tx, input.userId);

    const task = await findTaskRow(tx, input);
    if (task === null) return null;

    if (input.taskId === input.dependsOnTaskId) {
      return failed<DependencyWriteFailure>({ code: "SELF_DEPENDENCY", taskId: input.taskId });
    }

    const dependency = await findTaskRow(tx, {
      userId: input.userId,
      taskId: input.dependsOnTaskId,
    });
    if (dependency === null) return null;

    if (task.status === "INBOX" || dependency.status === "INBOX") {
      return failed<DependencyWriteFailure>({ code: "TASK_IN_INBOX" });
    }

    // post-mortem #19 (2026-09-08): esta rota checava dono, autodependência,
    // INBOX e ciclo, mas não o Project — só `replaceTaskDependencies` checava.
    // A aresta entre Campanhas que passava por aqui punha o texto de uma delas
    // no contexto de uma Expedição da outra. Mesma recusa das duas portas.
    if (task.projectId === null || dependency.projectId !== task.projectId) {
      return failed<DependencyWriteFailure>({
        code: "DEPENDENCY_IN_OTHER_PROJECT",
        taskId: input.dependsOnTaskId,
      });
    }

    const edges = await loadDependencyEdges(tx, input.userId);
    const cycle = wouldCreateDependencyCycle(edges, {
      taskId: input.taskId,
      dependsOnTaskId: input.dependsOnTaskId,
    });
    if (cycle !== null) {
      return failed<DependencyWriteFailure>({ code: "DEPENDENCY_CYCLE", path: cycle });
    }

    const inserted = await tx
      .insert(taskDependencies)
      .values({
        userId: input.userId,
        taskId: input.taskId,
        dependsOnTaskId: input.dependsOnTaskId,
      })
      .onConflictDoNothing({
        target: [taskDependencies.taskId, taskDependencies.dependsOnTaskId],
      })
      .returning({ taskId: taskDependencies.taskId });

    if (inserted.length > 0) {
      await recordDomainEvent(tx, {
        userId: input.userId,
        projectId: task.projectId,
        taskId: input.taskId,
        taskTitle: task.title,
        type: "task.dependency_created",
        payload: {
          taskId: input.taskId,
          dependsOnTaskId: input.dependsOnTaskId,
          projectId: task.projectId,
        },
      });
    }

    const detail = await getTaskDetail(tx, input);
    return detail === null ? null : ok(detail);
  });
}

/**
 * Remove a aresta. Idempotente: remover o que não existe devolve o estado atual
 * sem gravar fato nenhum. `null` só quando alguma das Tasks não existe.
 */
export async function removeTaskDependency(
  db: Database,
  input: TaskDependencyInput,
): Promise<TaskDetail | null> {
  return await db.transaction(async (tx) => {
    const task = await findTaskRow(tx, input);
    if (task === null) return null;

    const dependency = await findTaskRow(tx, {
      userId: input.userId,
      taskId: input.dependsOnTaskId,
    });
    if (dependency === null) return null;

    const removed = await tx
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.userId, input.userId),
          eq(taskDependencies.taskId, input.taskId),
          eq(taskDependencies.dependsOnTaskId, input.dependsOnTaskId),
        ),
      )
      .returning({ taskId: taskDependencies.taskId });

    if (removed.length > 0) {
      await recordDomainEvent(tx, {
        userId: input.userId,
        projectId: task.projectId,
        taskId: input.taskId,
        taskTitle: task.title,
        type: "task.dependency_removed",
        payload: {
          taskId: input.taskId,
          dependsOnTaskId: input.dependsOnTaskId,
          projectId: task.projectId,
        },
      });
    }

    return await getTaskDetail(tx, input);
  });
}

export interface ReplaceTaskDependenciesInput {
  userId: string;
  taskId: string;
  /** O conjunto completo. Vazio remove todas. Repetições são ignoradas. */
  dependsOn: readonly string[];
}

/**
 * Troca o conjunto inteiro de dependências de uma Task (Fase 5, grafo
 * editável).
 *
 * É um `PUT` de verdade: o que saiu da lista é removido, o que entrou é
 * inserido, o que ficou não gera fato nenhum. Idempotente. Toda dependência
 * precisa estar no **mesmo Project**, porque é o grafo do Project que está
 * sendo editado; uma Task de outro Project é "não encontrada" aqui, e não um
 * conflito — ela não existe neste grafo.
 *
 * A checagem de ciclo é feita sobre o grafo **sem** as arestas atuais desta
 * Task mais o conjunto novo inteiro, de uma vez: uma troca não pode ser
 * recusada por causa de uma aresta que está justamente removendo, e duas
 * arestas novas que só fecham ciclo juntas não podem passar por serem
 * checadas uma a uma. Devolve `null` quando a Task não existe.
 */
export async function replaceTaskDependencies(
  db: Database,
  input: ReplaceTaskDependenciesInput,
): Promise<Result<TaskDetail, DependencyWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    await lockTaskGraph(tx, input.userId);

    const task = await findTaskRow(tx, input);
    if (task === null) return null;

    if (task.status === "INBOX" || task.projectId === null) {
      return failed<DependencyWriteFailure>({ code: "TASK_IN_INBOX" });
    }

    const desired = [...new Set(input.dependsOn)];
    const dependencies: TaskRow[] = [];
    for (const dependsOnTaskId of desired) {
      const row = await findTaskRow(tx, { userId: input.userId, taskId: dependsOnTaskId });
      if (row === null) {
        return failed<DependencyWriteFailure>({
          code: "DEPENDENCY_NOT_FOUND",
          taskId: dependsOnTaskId,
        });
      }
      dependencies.push(row);
    }

    const edges = (await loadDependencyEdges(tx, input.userId)).filter(
      (edge) => edge.taskId !== input.taskId,
    );
    const check = checkTaskDependencies({
      taskId: input.taskId,
      projectId: task.projectId,
      dependencies: dependencies.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        status: row.status,
      })),
      edges,
    });
    if (!check.ok) return failed<DependencyWriteFailure>(check.rejection);

    const current = new Set(await loadDependencyTargetIds(tx, input));
    const wanted = new Set(desired);

    for (const dependsOnTaskId of current) {
      if (wanted.has(dependsOnTaskId)) continue;

      await tx
        .delete(taskDependencies)
        .where(
          and(
            eq(taskDependencies.userId, input.userId),
            eq(taskDependencies.taskId, input.taskId),
            eq(taskDependencies.dependsOnTaskId, dependsOnTaskId),
          ),
        );

      await recordDomainEvent(tx, {
        userId: input.userId,
        projectId: task.projectId,
        taskId: input.taskId,
        taskTitle: task.title,
        type: "task.dependency_removed",
        payload: { taskId: input.taskId, dependsOnTaskId, projectId: task.projectId },
      });
    }

    for (const dependsOnTaskId of desired) {
      if (current.has(dependsOnTaskId)) continue;

      await tx
        .insert(taskDependencies)
        .values({ userId: input.userId, taskId: input.taskId, dependsOnTaskId });

      await recordDomainEvent(tx, {
        userId: input.userId,
        projectId: task.projectId,
        taskId: input.taskId,
        taskTitle: task.title,
        type: "task.dependency_created",
        payload: { taskId: input.taskId, dependsOnTaskId, projectId: task.projectId },
      });
    }

    const detail = await getTaskDetail(tx, input);
    return detail === null ? null : ok(detail);
  });
}
