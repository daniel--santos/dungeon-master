import type {
  ApprovalPolicyPage,
  BudgetPage,
  CircuitBreakerPage,
  RoutingRulePage,
} from "@dungeon-master/contracts";
import type {
  UpdateApprovalPolicyPatch,
  UpdateBudgetPatch,
  UpdateCircuitBreakerPatch,
  UpdateRoutingRulePatch,
} from "@dungeon-master/database";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { AutonomyPort } from "../ports.js";
import {
  approvalPoliciesCreateRoute,
  approvalPoliciesDeleteRoute,
  approvalPoliciesGetRoute,
  approvalPoliciesListRoute,
  approvalPoliciesUpdateRoute,
  budgetsCreateRoute,
  budgetsDeleteRoute,
  budgetsGetRoute,
  budgetsListRoute,
  budgetsUpdateRoute,
  budgetsUsageRoute,
  circuitBreakersCreateRoute,
  circuitBreakersDeleteRoute,
  circuitBreakersGetRoute,
  circuitBreakersListRoute,
  circuitBreakersResetRoute,
  circuitBreakersUpdateRoute,
  projectAutonomyGetRoute,
  projectAutonomyUpdateRoute,
  routingRulesCreateRoute,
  routingRulesDeleteRoute,
  routingRulesGetRoute,
  routingRulesListRoute,
  routingRulesUpdateRoute,
  taskSuggestionsRoute,
} from "../routes/autonomy.js";
import { autonomyFailureProblem, notFoundProblem } from "./failures.js";

/**
 * As rotas da autonomia controlada (Fase 9A). A porta entra por injeção,
 * como em todo handler; o `pnpm gen` instancia a app com portas inertes.
 *
 * Nos `PATCH`, `Object.hasOwn` distingue "chave ausente" de `null`: em
 * `projectId`, `null` é "torne global" e a chave ausente é "não mexa"; num
 * teto de orçamento, `null` é "desligue o teto".
 */
export function registerAutonomyRoutes(app: OpenAPIHono, autonomy: AutonomyPort): void {
  const { approvalPolicies, budgets, circuitBreakers, routingRules, projectAutonomy, suggestions } =
    autonomy;

  // ---------------------------------------------------------- políticas

  app.openapi(approvalPoliciesListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);
    const result = await approvalPolicies.list({
      page,
      pageSize,
      filters: { projectId: query.projectId, subject: query.subject },
    });
    const body: ApprovalPolicyPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(approvalPoliciesCreateRoute, async (c) => {
    const input = c.req.valid("json");
    const created = await approvalPolicies.create({
      name: input.name,
      subject: input.subject,
      projectId: input.projectId ?? null,
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.conditions === undefined ? {} : { conditions: input.conditions }),
      action: input.action,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    });
    if (!created.ok) throw autonomyFailureProblem(created.failure);
    return c.json(created.value, 201);
  });

  app.openapi(approvalPoliciesGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const policy = await approvalPolicies.get(id);
    if (policy === null) throw notFoundProblem("ApprovalPolicy", id);
    return c.json(policy, 200);
  });

  app.openapi(approvalPoliciesUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const patch: UpdateApprovalPolicyPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.subject !== undefined) patch.subject = body.subject;
    if (Object.hasOwn(body, "projectId")) patch.projectId = body.projectId ?? null;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.conditions !== undefined) patch.conditions = body.conditions;
    if (body.action !== undefined) patch.action = body.action;
    if (body.enabled !== undefined) patch.enabled = body.enabled;

    const updated = await approvalPolicies.update(id, patch);
    if (updated === null) throw notFoundProblem("ApprovalPolicy", id);
    if (!updated.ok) throw autonomyFailureProblem(updated.failure);
    return c.json(updated.value, 200);
  });

  app.openapi(approvalPoliciesDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const removed = await approvalPolicies.remove(id);
    if (!removed) throw notFoundProblem("ApprovalPolicy", id);
    return c.body(null, 204);
  });

  // --------------------------------------------------------- orçamentos

  app.openapi(budgetsListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);
    const result = await budgets.list({
      page,
      pageSize,
      filters: { scope: query.scope, projectId: query.projectId, loadoutId: query.loadoutId },
    });
    const body: BudgetPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(budgetsCreateRoute, async (c) => {
    const input = c.req.valid("json");
    const created = await budgets.create({
      name: input.name,
      scope: input.scope,
      projectId: input.projectId ?? null,
      loadoutId: input.loadoutId ?? null,
      window: input.window,
      maxTokens: input.maxTokens ?? null,
      maxRuns: input.maxRuns ?? null,
      maxWallClockMs: input.maxWallClockMs ?? null,
      maxConcurrentRuns: input.maxConcurrentRuns ?? null,
      ...(input.action === undefined ? {} : { action: input.action }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    });
    if (!created.ok) throw autonomyFailureProblem(created.failure);
    return c.json(created.value, 201);
  });

  app.openapi(budgetsGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const budget = await budgets.get(id);
    if (budget === null) throw notFoundProblem("Budget", id);
    return c.json(budget, 200);
  });

  app.openapi(budgetsUsageRoute, async (c) => {
    const { id } = c.req.valid("param");
    const usage = await budgets.usage(id);
    if (usage === null) throw notFoundProblem("Budget", id);
    return c.json(usage, 200);
  });

  app.openapi(budgetsUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const patch: UpdateBudgetPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (Object.hasOwn(body, "maxTokens")) patch.maxTokens = body.maxTokens ?? null;
    if (Object.hasOwn(body, "maxRuns")) patch.maxRuns = body.maxRuns ?? null;
    if (Object.hasOwn(body, "maxWallClockMs")) patch.maxWallClockMs = body.maxWallClockMs ?? null;
    if (Object.hasOwn(body, "maxConcurrentRuns")) {
      patch.maxConcurrentRuns = body.maxConcurrentRuns ?? null;
    }
    if (body.action !== undefined) patch.action = body.action;
    if (body.enabled !== undefined) patch.enabled = body.enabled;

    const updated = await budgets.update(id, patch);
    if (updated === null) throw notFoundProblem("Budget", id);
    if (!updated.ok) throw autonomyFailureProblem(updated.failure);
    return c.json(updated.value, 200);
  });

  app.openapi(budgetsDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const removed = await budgets.remove(id);
    if (!removed) throw notFoundProblem("Budget", id);
    return c.body(null, 204);
  });

  // -------------------------------------------------------- disjuntores

  app.openapi(circuitBreakersListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);
    const result = await circuitBreakers.list({
      page,
      pageSize,
      filters: { scope: query.scope, state: query.state, projectId: query.projectId },
    });
    const body: CircuitBreakerPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(circuitBreakersCreateRoute, async (c) => {
    const input = c.req.valid("json");
    const created = await circuitBreakers.create({
      name: input.name,
      scope: input.scope,
      projectId: input.projectId ?? null,
      loadoutId: input.loadoutId ?? null,
      harnessKey: input.harnessKey ?? null,
      consecutiveFailures: input.consecutiveFailures ?? null,
      failuresInWindow: input.failuresInWindow ?? null,
      permissionDeniedInWindow: input.permissionDeniedInWindow ?? null,
      ...(input.authNotAuthenticated === undefined
        ? {}
        : { authNotAuthenticated: input.authNotAuthenticated }),
      ...(input.cooldownMs === undefined ? {} : { cooldownMs: input.cooldownMs }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    });
    if (!created.ok) throw autonomyFailureProblem(created.failure);
    return c.json(created.value, 201);
  });

  app.openapi(circuitBreakersGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const breaker = await circuitBreakers.get(id);
    if (breaker === null) throw notFoundProblem("CircuitBreaker", id);
    return c.json(breaker, 200);
  });

  app.openapi(circuitBreakersUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const patch: UpdateCircuitBreakerPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (Object.hasOwn(body, "consecutiveFailures")) {
      patch.consecutiveFailures = body.consecutiveFailures ?? null;
    }
    if (Object.hasOwn(body, "failuresInWindow")) patch.failuresInWindow = body.failuresInWindow ?? null;
    if (Object.hasOwn(body, "permissionDeniedInWindow")) {
      patch.permissionDeniedInWindow = body.permissionDeniedInWindow ?? null;
    }
    if (body.authNotAuthenticated !== undefined) {
      patch.authNotAuthenticated = body.authNotAuthenticated;
    }
    if (body.cooldownMs !== undefined) patch.cooldownMs = body.cooldownMs;
    if (body.enabled !== undefined) patch.enabled = body.enabled;

    const updated = await circuitBreakers.update(id, patch);
    if (updated === null) throw notFoundProblem("CircuitBreaker", id);
    if (!updated.ok) throw autonomyFailureProblem(updated.failure);
    return c.json(updated.value, 200);
  });

  app.openapi(circuitBreakersDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const removed = await circuitBreakers.remove(id);
    if (!removed) throw notFoundProblem("CircuitBreaker", id);
    return c.body(null, 204);
  });

  app.openapi(circuitBreakersResetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const breaker = await circuitBreakers.reset(id);
    if (breaker === null) throw notFoundProblem("CircuitBreaker", id);
    return c.json(breaker, 200);
  });

  // --------------------------------------------------------- roteamento

  app.openapi(routingRulesListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);
    const result = await routingRules.list({
      page,
      pageSize,
      filters: { kind: query.kind, projectId: query.projectId },
    });
    const body: RoutingRulePage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(routingRulesCreateRoute, async (c) => {
    const input = c.req.valid("json");
    const created = await routingRules.create({
      name: input.name,
      kind: input.kind,
      projectId: input.projectId ?? null,
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.conditions === undefined ? {} : { conditions: input.conditions }),
      targetId: input.targetId,
      ...(input.fallbackIds === undefined ? {} : { fallbackIds: input.fallbackIds }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    });
    if (!created.ok) throw autonomyFailureProblem(created.failure);
    return c.json(created.value, 201);
  });

  app.openapi(routingRulesGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const rule = await routingRules.get(id);
    if (rule === null) throw notFoundProblem("RoutingRule", id);
    return c.json(rule, 200);
  });

  app.openapi(routingRulesUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const patch: UpdateRoutingRulePatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (Object.hasOwn(body, "projectId")) patch.projectId = body.projectId ?? null;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.conditions !== undefined) patch.conditions = body.conditions;
    if (body.targetId !== undefined) patch.targetId = body.targetId;
    if (body.fallbackIds !== undefined) patch.fallbackIds = body.fallbackIds;
    if (body.enabled !== undefined) patch.enabled = body.enabled;

    const updated = await routingRules.update(id, patch);
    if (updated === null) throw notFoundProblem("RoutingRule", id);
    if (!updated.ok) throw autonomyFailureProblem(updated.failure);
    return c.json(updated.value, 200);
  });

  app.openapi(routingRulesDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const removed = await routingRules.remove(id);
    if (!removed) throw notFoundProblem("RoutingRule", id);
    return c.body(null, 204);
  });

  // ---------------------------------------------- autonomia e sugestões

  app.openapi(projectAutonomyGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const autonomy = await projectAutonomy.get(id);
    if (autonomy === null) throw notFoundProblem("Project", id);
    return c.json(autonomy, 200);
  });

  app.openapi(projectAutonomyUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const autonomy = await projectAutonomy.update(id, body.autonomyLevel);
    if (autonomy === null) throw notFoundProblem("Project", id);
    return c.json(autonomy, 200);
  });

  app.openapi(taskSuggestionsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const computed = await suggestions.compute(id);
    if (computed === null) throw notFoundProblem("Task", id);
    if (!computed.ok) throw autonomyFailureProblem(computed.failure);
    return c.json(computed.value, 200);
  });
}
