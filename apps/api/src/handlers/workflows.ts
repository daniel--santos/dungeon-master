import type {
  ApprovalGateList,
  ApprovalGatePage,
  RunStepList,
  WorkflowPage,
  WorkflowVersionPage,
} from "@dungeon-master/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { ApprovalGatesPort, RunsPort, WorkflowsPort } from "../ports.js";
import {
  approvalGatesListRoute,
  approvalGatesResolveRoute,
  runsGatesRoute,
  runsStepsRoute,
  workflowsCreateRoute,
  workflowsDeleteRoute,
  workflowsGetRoute,
  workflowsListRoute,
  workflowsUpdateRoute,
  workflowsVersionsRoute,
  workflowVersionsGetRoute,
} from "../routes/workflows.js";
import { approvalGateFailureProblem, notFoundProblem, workflowFailureProblem } from "./failures.js";

export function registerWorkflowRoutes(app: OpenAPIHono, workflows: WorkflowsPort): void {
  app.openapi(workflowsListRoute, async (c) => {
    const { page, pageSize } = resolvePage(c.req.valid("query"));
    const result = await workflows.list({ page, pageSize });
    const body: WorkflowPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(workflowsCreateRoute, async (c) => {
    const definition = c.req.valid("json");
    const created = await workflows.create(definition);
    if (!created.ok) throw workflowFailureProblem(created.failure);
    return c.json(created.value, 201);
  });

  app.openapi(workflowsGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workflow = await workflows.get(id);
    if (workflow === null) throw notFoundProblem("Workflow", id);
    return c.json(workflow, 200);
  });

  app.openapi(workflowsUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const definition = c.req.valid("json");
    const updated = await workflows.update(id, definition);
    if (updated === null) throw notFoundProblem("Workflow", id);
    if (!updated.ok) throw workflowFailureProblem(updated.failure);
    return c.json(updated.value, 200);
  });

  app.openapi(workflowsDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const removed = await workflows.remove(id);
    if (removed === null) throw notFoundProblem("Workflow", id);
    if (!removed.ok) throw workflowFailureProblem(removed.failure);
    return c.body(null, 204);
  });

  app.openapi(workflowsVersionsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { page, pageSize } = resolvePage(c.req.valid("query"));
    const result = await workflows.versions(id, { page, pageSize });
    if (result === null) throw notFoundProblem("Workflow", id);
    const body: WorkflowVersionPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(workflowVersionsGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const version = await workflows.version(id);
    if (version === null) throw notFoundProblem("WorkflowVersion", id);
    return c.json(version, 200);
  });
}

/**
 * As duas leituras de Run que a Fase 4 acrescenta.
 *
 * Ficam aqui, e não em `handlers/runs.ts`, para o arquivo de Run não crescer
 * a cada fase; a existência do Run continua sendo checada antes de listar,
 * senão os steps de um Run inexistente seriam uma lista vazia em vez de 404.
 */
export function registerRunWorkflowRoutes(app: OpenAPIHono, runs: RunsPort): void {
  app.openapi(runsStepsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const run = await runs.get(id);
    if (run === null) throw notFoundProblem("Run", id);
    const body: RunStepList = { items: await runs.steps(id) };
    return c.json(body, 200);
  });

  app.openapi(runsGatesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const run = await runs.get(id);
    if (run === null) throw notFoundProblem("Run", id);
    const body: ApprovalGateList = { items: await runs.gates(id) };
    return c.json(body, 200);
  });
}

export function registerApprovalGateRoutes(app: OpenAPIHono, gates: ApprovalGatesPort): void {
  app.openapi(approvalGatesListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);
    const result = await gates.list({
      page,
      pageSize,
      filters: { status: query.status, runId: query.runId },
    });
    const body: ApprovalGatePage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(approvalGatesResolveRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const resolved = await gates.resolve(id, {
      decision: input.decision,
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    if (resolved === null) throw notFoundProblem("ApprovalGate", id);
    if (!resolved.ok) throw approvalGateFailureProblem(resolved.failure);
    return c.json(resolved.value, 200);
  });
}
