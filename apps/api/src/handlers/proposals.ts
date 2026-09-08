import type { KnowledgeCandidatePage, ProposedTaskPage } from "@dungeon-master/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type {
  ApproveProposedTaskRequest,
  KnowledgeCandidatesPort,
  ProposedTasksPort,
} from "../ports.js";
import {
  knowledgeCandidatesListRoute,
  proposedTasksApproveRoute,
  proposedTasksGetRoute,
  proposedTasksListRoute,
  proposedTasksRejectRoute,
} from "../routes/proposals.js";
import { notFoundProblem, proposedTaskFailureProblem } from "./failures.js";

/**
 * As rotas de ProposedTask e de KnowledgeCandidate (Fase 5).
 *
 * A porta entra por injeção, como em todo handler: o que existe atrás dela é
 * decisão da composição, e o `pnpm gen` instancia a app com portas inertes.
 */
export function registerProposedTaskRoutes(
  app: OpenAPIHono,
  proposedTasks: ProposedTasksPort,
): void {
  app.openapi(proposedTasksListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);

    const result = await proposedTasks.list({
      page,
      pageSize,
      filters: { status: query.status, projectId: query.projectId, taskId: query.taskId },
    });

    const body: ProposedTaskPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(proposedTasksGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const proposal = await proposedTasks.get(id);
    if (proposal === null) throw notFoundProblem("ProposedTask", id);
    return c.json(proposal, 200);
  });

  app.openapi(proposedTasksApproveRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Chave ausente é "a Task de origem"; `null` explícito é "sem mãe". As duas
    // chegam diferentes do JSON e precisam continuar diferentes até o repositório.
    const input: ApproveProposedTaskRequest = {};
    if (Object.hasOwn(body, "parentTaskId")) input.parentTaskId = body.parentTaskId ?? null;
    if (body.dependsOn !== undefined) input.dependsOn = body.dependsOn;
    if (body.kind !== undefined) input.kind = body.kind;
    if (body.priority !== undefined) input.priority = body.priority;
    if (body.workflowId !== undefined) input.workflowId = body.workflowId;
    if (body.note !== undefined) input.note = body.note;

    const approved = await proposedTasks.approve(id, input);
    if (approved === null) throw notFoundProblem("ProposedTask", id);
    if (!approved.ok) throw proposedTaskFailureProblem(approved.failure);

    return c.json(approved.value, 200);
  });

  app.openapi(proposedTasksRejectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const rejected = await proposedTasks.reject(id, {
      ...(body.note === undefined ? {} : { note: body.note }),
    });
    if (rejected === null) throw notFoundProblem("ProposedTask", id);
    if (!rejected.ok) throw proposedTaskFailureProblem(rejected.failure);

    return c.json(rejected.value, 200);
  });
}

export function registerKnowledgeCandidateRoutes(
  app: OpenAPIHono,
  knowledgeCandidates: KnowledgeCandidatesPort,
): void {
  app.openapi(knowledgeCandidatesListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);

    const result = await knowledgeCandidates.list({
      page,
      pageSize,
      filters: {
        projectId: query.projectId,
        status: query.status,
        taskId: query.taskId,
        runId: query.runId,
      },
    });

    const body: KnowledgeCandidatePage = {
      items: result.items,
      page,
      pageSize,
      total: result.total,
    };
    return c.json(body, 200);
  });
}
