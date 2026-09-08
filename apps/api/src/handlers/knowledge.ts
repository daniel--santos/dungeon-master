import type {
  DecisionPage,
  DistillationRequested,
  DistillationRunPage,
  KnowledgeItemPage,
} from "@dungeon-master/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { KnowledgePort } from "../ports.js";
import {
  distillationRunsListRoute,
  knowledgeItemApproveRoute,
  knowledgeItemGetRoute,
  knowledgeItemRejectRoute,
  knowledgeItemUpdateRoute,
  projectDecisionsRoute,
  projectDistillRoute,
  projectKnowledgeListRoute,
  projectSummaryRoute,
} from "../routes/knowledge.js";
import { knowledgeItemFailureProblem, notFoundProblem } from "./failures.js";

/**
 * As rotas do Grimório (Fase 6).
 *
 * A porta entra por injeção, como em todo handler: o que existe atrás dela é
 * decisão da composição, e o `pnpm gen` instancia a app com portas inertes.
 */
export function registerKnowledgeRoutes(app: OpenAPIHono, knowledge: KnowledgePort): void {
  app.openapi(projectKnowledgeListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);

    const result = await knowledge.listItems(id, {
      page,
      pageSize,
      filters: { type: query.type, status: query.status, review: query.review, q: query.q },
    });
    if (result === null) throw notFoundProblem("Project", id);

    const body: KnowledgeItemPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(knowledgeItemGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const item = await knowledge.getItem(id);
    if (item === null) throw notFoundProblem("KnowledgeItem", id);
    return c.json(item, 200);
  });

  app.openapi(knowledgeItemUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updated = await knowledge.updateItem(id, {
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.content === undefined ? {} : { content: body.content }),
      ...(body.type === undefined ? {} : { type: body.type }),
      ...(body.archived === undefined ? {} : { archived: body.archived }),
    });
    if (updated === null) throw notFoundProblem("KnowledgeItem", id);
    if (!updated.ok) throw knowledgeItemFailureProblem(updated.failure);

    return c.json(updated.value, 200);
  });

  app.openapi(knowledgeItemApproveRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const approved = await knowledge.approveItem(id, {
      ...(body.note === undefined ? {} : { note: body.note }),
    });
    if (approved === null) throw notFoundProblem("KnowledgeItem", id);
    if (!approved.ok) throw knowledgeItemFailureProblem(approved.failure);

    return c.json(approved.value, 200);
  });

  app.openapi(knowledgeItemRejectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const rejected = await knowledge.rejectItem(id, {
      ...(body.note === undefined ? {} : { note: body.note }),
    });
    if (rejected === null) throw notFoundProblem("KnowledgeItem", id);
    if (!rejected.ok) throw knowledgeItemFailureProblem(rejected.failure);

    return c.json(rejected.value, 200);
  });

  app.openapi(projectSummaryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const summary = await knowledge.summary(id);
    if (summary === null) throw notFoundProblem("Project", id);
    return c.json(summary, 200);
  });

  app.openapi(projectDecisionsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);

    const result = await knowledge.decisions(id, { page, pageSize, status: query.status });
    if (result === null) throw notFoundProblem("Project", id);

    const body: DecisionPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(projectDistillRoute, async (c) => {
    const { id } = c.req.valid("param");
    const requested = await knowledge.distill(id);
    if (requested === null) throw notFoundProblem("Project", id);

    const body: DistillationRequested = {
      projectId: id,
      pendingCandidates: requested.pendingCandidates,
      requestedAt: new Date().toISOString(),
    };
    return c.json(body, 202);
  });

  app.openapi(distillationRunsListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);

    const result = await knowledge.distillationRuns({
      page,
      pageSize,
      filters: { projectId: query.projectId, status: query.status },
    });

    const body: DistillationRunPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });
}
