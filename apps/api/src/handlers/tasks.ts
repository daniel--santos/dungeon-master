import {
  DEFAULT_TASK_SORT,
  DEFAULT_TASK_SORT_ORDER,
  type TaskPage,
  type TaskReopeningList,
  type TaskStatus,
} from "@dungeon-master/contracts";
import type { TaskFilters } from "@dungeon-master/database";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { TasksPort, UpdateTaskRequest } from "../ports.js";
import {
  tasksAddDependencyRoute,
  tasksChangeStatusRoute,
  tasksCreateRoute,
  tasksGetRoute,
  tasksListRoute,
  tasksRemoveDependencyRoute,
  tasksReopeningsRoute,
  tasksUpdateRoute,
} from "../routes/tasks.js";
import {
  dependencyFailureProblem,
  dependencyNotFoundProblem,
  notFoundProblem,
  taskFailureProblem,
} from "./failures.js";

/**
 * `?status=READY` chega como texto e `?status=READY&status=BLOCKED` como array,
 * que é como o Hono entrega parâmetro repetido. As duas formas viram lista.
 */
function normalizarStatus(
  status: TaskStatus | TaskStatus[] | undefined,
): readonly TaskStatus[] | undefined {
  if (status === undefined) return undefined;
  return Array.isArray(status) ? status : [status];
}

export function registerTaskRoutes(app: OpenAPIHono, tasks: TasksPort): void {
  app.openapi(tasksListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);

    const filters: TaskFilters = {
      projectId: query.projectId,
      parentTaskId: query.parentTaskId,
      kind: query.kind,
      priority: query.priority,
      status: normalizarStatus(query.status),
      excludeStatus: normalizarStatus(query.excludeStatus),
      q: query.q,
    };

    // O padrão é resolvido aqui, e não no repositório, porque é o contrato da
    // rota que o anuncia na spec: quem chama a API sabe o que recebe sem pedir.
    const result = await tasks.list({
      page,
      pageSize,
      filters,
      sort: query.sort ?? DEFAULT_TASK_SORT,
      order: query.order ?? DEFAULT_TASK_SORT_ORDER,
    });

    const body: TaskPage = { items: result.items, page, pageSize, total: result.total };

    return c.json(body, 200);
  });

  app.openapi(tasksReopeningsRoute, async (c) => {
    const { kind } = c.req.valid("query");
    const body: TaskReopeningList = { items: await tasks.reopenings({ kind }) };

    return c.json(body, 200);
  });

  app.openapi(tasksCreateRoute, async (c) => {
    const input = c.req.valid("json");

    const created = await tasks.create({
      projectId: input.projectId,
      parentTaskId: input.parentTaskId ?? null,
      workflowId: input.workflowId ?? null,
      title: input.title,
      description: input.description ?? null,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
    });

    if (!created.ok) throw taskFailureProblem(created.failure);

    return c.json(created.value, 201);
  });

  app.openapi(tasksGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const task = await tasks.get(id);

    if (task === null) throw notFoundProblem("Task", id);

    return c.json(task, 200);
  });

  app.openapi(tasksUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Chave ausente é "não mexa"; `null` explícito é "apague". As duas chegam
    // diferentes do JSON e precisam continuar diferentes até o repositório.
    const patch: UpdateTaskRequest = {};
    if (body.projectId !== undefined) patch.projectId = body.projectId;
    if (Object.hasOwn(body, "parentTaskId")) patch.parentTaskId = body.parentTaskId ?? null;
    if (Object.hasOwn(body, "workflowId")) patch.workflowId = body.workflowId ?? null;
    if (body.title !== undefined) patch.title = body.title;
    if (Object.hasOwn(body, "description")) patch.description = body.description ?? null;
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.priority !== undefined) patch.priority = body.priority;

    const updated = await tasks.update(id, patch);
    if (updated === null) throw notFoundProblem("Task", id);
    if (!updated.ok) throw taskFailureProblem(updated.failure);

    return c.json(updated.value, 200);
  });

  app.openapi(tasksChangeStatusRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { to } = c.req.valid("json");

    const changed = await tasks.changeStatus(id, to);
    if (changed === null) throw notFoundProblem("Task", id);
    if (!changed.ok) throw taskFailureProblem(changed.failure);

    return c.json(changed.value, 200);
  });

  app.openapi(tasksAddDependencyRoute, async (c) => {
    const { id, dependsOnId } = c.req.valid("param");

    const result = await tasks.addDependency(id, dependsOnId);
    if (result === null) throw dependencyNotFoundProblem(id, dependsOnId);
    if (!result.ok) throw dependencyFailureProblem(result.failure);

    return c.json(result.value, 200);
  });

  app.openapi(tasksRemoveDependencyRoute, async (c) => {
    const { id, dependsOnId } = c.req.valid("param");

    const task = await tasks.removeDependency(id, dependsOnId);
    if (task === null) throw dependencyNotFoundProblem(id, dependsOnId);

    return c.json(task, 200);
  });
}
