import type {
  Project,
  ProjectDetail,
  ProjectStatus,
  TaskStatusCounts,
} from "@dungeon-master/contracts";
import { and, count, desc, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import type { DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { recordDomainEvent } from "./activity.js";
import { type PageInput, type PageResult } from "./result.js";
import { projects, type ProjectRow } from "./schema/project.js";
import { tasks } from "./schema/task.js";

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Todas as chaves presentes e zeradas.
 *
 * Escrita à mão, e não derivada de `TASK_STATUS_VALUES`: o tipo exige as nove
 * chaves, então um estado novo no contrato quebra a compilação aqui, que é
 * exatamente onde alguém precisa decidir se a tela mostra o estado novo.
 */
function zeroedTaskCounts(): TaskStatusCounts {
  return {
    INBOX: 0,
    READY: 0,
    QUEUED: 0,
    RUNNING: 0,
    WAITING: 0,
    BLOCKED: 0,
    COMPLETED: 0,
    FAILED: 0,
    CANCELLED: 0,
  };
}

export interface ListProjectsInput extends PageInput {
  userId: string;
  status?: ProjectStatus | undefined;
}

export async function listProjects(
  db: DatabaseExecutor,
  input: ListProjectsInput,
): Promise<PageResult<Project>> {
  const conditions = [eq(projects.userId, input.userId)];
  if (input.status !== undefined) conditions.push(eq(projects.status, input.status));
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(projects).where(where);

  return { items: rows.map(toProject), total: counted?.total ?? 0 };
}

/** A linha crua, já escopada pelo usuário. Base de toda checagem de posse. */
export async function findProjectRow(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<ProjectRow | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)));

  return row ?? null;
}

export async function countProjectTasksByStatus(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<TaskStatusCounts> {
  const rows = await db
    .select({ status: tasks.status, total: count() })
    .from(tasks)
    .where(and(eq(tasks.userId, input.userId), eq(tasks.projectId, input.projectId)))
    .groupBy(tasks.status);

  const counts = zeroedTaskCounts();
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}

export async function getProject(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<ProjectDetail | null> {
  const row = await findProjectRow(db, input);
  if (row === null) return null;

  return { ...toProject(row), taskCounts: await countProjectTasksByStatus(db, input) };
}

export interface CreateProjectInput {
  userId: string;
  title: string;
  description?: string | null;
}

export async function createProject(db: Database, input: CreateProjectInput): Promise<Project> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        id: newId(),
        userId: input.userId,
        title: input.title,
        description: input.description ?? null,
      })
      .returning();

    if (row === undefined) {
      throw new Error("A inserção em project não devolveu linha.");
    }

    const project = toProject(row);

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: project.id,
      taskId: null,
      type: "project.created",
      payload: { projectId: project.id, title: project.title },
    });

    return project;
  });
}

export interface UpdateProjectInput {
  userId: string;
  projectId: string;
  patch: {
    title?: string;
    description?: string | null;
  };
}

/**
 * Edita título e descrição. `null` em `data` já resolvida a `null`.
 *
 * Devolve `null` quando o Project não existe ou é de outro usuário — os dois
 * casos são o mesmo 404, de propósito: responder "existe, mas não é seu" seria
 * contar sobre dados alheios.
 */
export async function updateProject(
  db: Database,
  input: UpdateProjectInput,
): Promise<ProjectDetail | null> {
  return await db.transaction(async (tx) => {
    const current = await findProjectRow(tx, input);
    if (current === null) return null;

    const changed: string[] = [];
    const values: { title?: string; description?: string | null } = {};

    if (input.patch.title !== undefined && input.patch.title !== current.title) {
      values.title = input.patch.title;
      changed.push("title");
    }
    if (input.patch.description !== undefined && input.patch.description !== current.description) {
      values.description = input.patch.description;
      changed.push("description");
    }

    // Um PATCH que não muda nada não vira linha no diário: o diário conta o que
    // aconteceu, e "alguém enviou os mesmos valores" não aconteceu.
    if (changed.length === 0) {
      return await getProject(tx, input);
    }

    await tx
      .update(projects)
      .set(values)
      .where(and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)));

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: input.projectId,
      taskId: null,
      type: "project.updated",
      payload: { projectId: input.projectId, changed },
    });

    return await getProject(tx, input);
  });
}

export interface SetProjectArchivedInput {
  userId: string;
  projectId: string;
  archived: boolean;
}

/**
 * Arquiva ou desarquiva, escrevendo `archived_at` junto.
 *
 * Idempotente: pedir o estado que o Project já tem devolve o Project sem
 * gravar evento. Arquivar duas vezes não é um segundo fato.
 */
export async function setProjectArchived(
  db: Database,
  input: SetProjectArchivedInput,
): Promise<ProjectDetail | null> {
  return await db.transaction(async (tx) => {
    const current = await findProjectRow(tx, input);
    if (current === null) return null;

    const target: ProjectStatus = input.archived ? "ARCHIVED" : "ACTIVE";
    if (current.status === target) {
      return await getProject(tx, input);
    }

    await tx
      .update(projects)
      .set({ status: target, archivedAt: input.archived ? new Date() : null })
      .where(and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)));

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: input.projectId,
      taskId: null,
      type: "project.updated",
      payload: {
        projectId: input.projectId,
        changed: ["status"],
        from: current.status,
        to: target,
      },
    });

    return await getProject(tx, input);
  });
}
