import type {
  AgentList,
  ExecutionProfileList,
  HarnessList,
  LoadoutList,
  LoadoutVersionPage,
  ModelList,
} from "@dungeon-master/contracts";
import type {
  UpdateAgentPatch,
  UpdateExecutionProfilePatch,
  UpdateLoadoutPatch,
} from "@dungeon-master/database";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type {
  AgentsPort,
  ExecutionProfilesPort,
  HarnessesPort,
  LoadoutsPort,
  ModelsPort,
} from "../ports.js";
import {
  agentsCreateRoute,
  agentsDeleteRoute,
  agentsGetRoute,
  agentsListRoute,
  agentsUpdateRoute,
  executionProfilesCreateRoute,
  executionProfilesDeleteRoute,
  executionProfilesGetRoute,
  executionProfilesListRoute,
  executionProfilesUpdateRoute,
  harnessesListRoute,
  harnessesUpdateRoute,
  loadoutPreflightRoute,
  loadoutsCreateRoute,
  loadoutsDeleteRoute,
  loadoutsGetRoute,
  loadoutsListRoute,
  loadoutsUpdateRoute,
  loadoutVersionsListRoute,
  loadoutVersionsRestoreRoute,
  modelsCreateRoute,
  modelsDeleteRoute,
  modelsListRoute,
  modelsUpdateRoute,
} from "../routes/registry.js";
import { notFoundProblem, registryFailureProblem, runFailureProblem } from "./failures.js";

/**
 * As rotas dos cadastros de execução.
 *
 * O padrão é o mesmo das rotas de Project e Task: a porta entra por injeção, e
 * o handler não sabe se atrás dela existe PostgreSQL. `null` é 404,
 * `{ ok: false }` vira o problem details que `registryFailureProblem` escreve,
 * e o resto é sucesso.
 */

export function registerHarnessRoutes(app: OpenAPIHono, harnesses: HarnessesPort): void {
  app.openapi(harnessesListRoute, async (c) => {
    const body: HarnessList = { items: await harnesses.list() };
    return c.json(body, 200);
  });

  app.openapi(harnessesUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { enabled } = c.req.valid("json");

    const harness = await harnesses.setEnabled(id, enabled);
    if (harness === null) throw notFoundProblem("Harness", id);

    return c.json(harness, 200);
  });
}

export function registerModelRoutes(app: OpenAPIHono, models: ModelsPort): void {
  app.openapi(modelsListRoute, async (c) => {
    const { harnessId, providerId } = c.req.valid("query");
    const body: ModelList = { items: await models.list({ harnessId, providerId }) };
    return c.json(body, 200);
  });

  app.openapi(modelsCreateRoute, async (c) => {
    const input = c.req.valid("json");

    const created = await models.create({
      harnessId: input.harnessId,
      providerId: input.providerId ?? null,
      key: input.key,
      name: input.name,
      ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
    });

    if (!created.ok) throw registryFailureProblem(created.failure);

    return c.json(created.value, 201);
  });

  app.openapi(modelsUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const patch: { providerId?: string | null; key?: string; name?: string; isDefault?: boolean } =
      {};
    if (Object.hasOwn(body, "providerId")) patch.providerId = body.providerId ?? null;
    if (body.key !== undefined) patch.key = body.key;
    if (body.name !== undefined) patch.name = body.name;
    if (body.isDefault !== undefined) patch.isDefault = body.isDefault;

    const updated = await models.update(id, patch);
    if (updated === null) throw notFoundProblem("Model", id);
    if (!updated.ok) throw registryFailureProblem(updated.failure);

    return c.json(updated.value, 200);
  });

  app.openapi(modelsDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");

    const removed = await models.remove(id);
    if (removed === null) throw notFoundProblem("Model", id);
    if (!removed.ok) throw registryFailureProblem(removed.failure);

    return c.body(null, 204);
  });
}

export function registerAgentRoutes(app: OpenAPIHono, agents: AgentsPort): void {
  app.openapi(agentsListRoute, async (c) => {
    const body: AgentList = { items: await agents.list() };
    return c.json(body, 200);
  });

  app.openapi(agentsGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const agent = await agents.get(id);
    if (agent === null) throw notFoundProblem("Agent", id);
    return c.json(agent, 200);
  });

  app.openapi(agentsCreateRoute, async (c) => {
    const input = c.req.valid("json");

    const created = await agents.create({
      name: input.name,
      role: input.role,
      instructions: input.instructions,
      description: input.description ?? null,
    });

    if (!created.ok) throw registryFailureProblem(created.failure);

    return c.json(created.value, 201);
  });

  app.openapi(agentsUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Chave ausente é "não mexa"; `null` explícito é "apague". As duas chegam
    // diferentes do JSON e precisam continuar diferentes até o repositório.
    const patch: UpdateAgentPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.role !== undefined) patch.role = body.role;
    if (body.instructions !== undefined) patch.instructions = body.instructions;
    if (Object.hasOwn(body, "description")) patch.description = body.description ?? null;

    const updated = await agents.update(id, patch);
    if (updated === null) throw notFoundProblem("Agent", id);
    if (!updated.ok) throw registryFailureProblem(updated.failure);

    return c.json(updated.value, 200);
  });

  app.openapi(agentsDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");

    const removed = await agents.remove(id);
    if (removed === null) throw notFoundProblem("Agent", id);
    if (!removed.ok) throw registryFailureProblem(removed.failure);

    return c.body(null, 204);
  });
}

export function registerExecutionProfileRoutes(
  app: OpenAPIHono,
  profiles: ExecutionProfilesPort,
): void {
  app.openapi(executionProfilesListRoute, async (c) => {
    const body: ExecutionProfileList = { items: await profiles.list() };
    return c.json(body, 200);
  });

  app.openapi(executionProfilesGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const profile = await profiles.get(id);
    if (profile === null) throw notFoundProblem("ExecutionProfile", id);
    return c.json(profile, 200);
  });

  app.openapi(executionProfilesCreateRoute, async (c) => {
    const input = c.req.valid("json");

    const created = await profiles.create({
      name: input.name,
      mode: input.mode,
      workspaceStrategy: input.workspaceStrategy,
      enforcement: input.enforcement,
      ...(input.permissionPolicy === undefined ? {} : { permissionPolicy: input.permissionPolicy }),
      ...(input.environmentPolicy === undefined
        ? {}
        : { environmentPolicy: input.environmentPolicy }),
      ...(input.networkPolicy === undefined ? {} : { networkPolicy: input.networkPolicy }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
    });

    if (!created.ok) throw registryFailureProblem(created.failure);

    return c.json(created.value, 201);
  });

  app.openapi(executionProfilesUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const patch: UpdateExecutionProfilePatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.mode !== undefined) patch.mode = body.mode;
    if (body.workspaceStrategy !== undefined) patch.workspaceStrategy = body.workspaceStrategy;
    if (body.enforcement !== undefined) patch.enforcement = body.enforcement;
    if (body.permissionPolicy !== undefined) patch.permissionPolicy = body.permissionPolicy;
    if (body.environmentPolicy !== undefined) patch.environmentPolicy = body.environmentPolicy;
    if (body.networkPolicy !== undefined) patch.networkPolicy = body.networkPolicy;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.isDefault !== undefined) patch.isDefault = body.isDefault;

    const updated = await profiles.update(id, patch);
    if (updated === null) throw notFoundProblem("ExecutionProfile", id);
    if (!updated.ok) throw registryFailureProblem(updated.failure);

    return c.json(updated.value, 200);
  });

  app.openapi(executionProfilesDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");

    const removed = await profiles.remove(id);
    if (removed === null) throw notFoundProblem("ExecutionProfile", id);
    if (!removed.ok) throw registryFailureProblem(removed.failure);

    return c.body(null, 204);
  });
}

export function registerLoadoutRoutes(app: OpenAPIHono, loadouts: LoadoutsPort): void {
  app.openapi(loadoutsListRoute, async (c) => {
    const body: LoadoutList = { items: await loadouts.list() };
    return c.json(body, 200);
  });

  app.openapi(loadoutsGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const loadout = await loadouts.get(id);
    if (loadout === null) throw notFoundProblem("Loadout", id);
    return c.json(loadout, 200);
  });

  app.openapi(loadoutsCreateRoute, async (c) => {
    const input = c.req.valid("json");

    const created = await loadouts.create({
      name: input.name,
      agentId: input.agentId,
      harnessId: input.harnessId,
      modelId: input.modelId ?? null,
      executionProfileId: input.executionProfileId,
      ...(input.skillRefs === undefined ? {} : { skillRefs: input.skillRefs }),
      ...(input.toolIds === undefined ? {} : { toolIds: input.toolIds }),
      ...(input.mcpServerIds === undefined ? {} : { mcpServerIds: input.mcpServerIds }),
      ...(input.skills === undefined ? {} : { skills: input.skills }),
      ...(input.tools === undefined ? {} : { tools: input.tools }),
      ...(input.mcpServers === undefined ? {} : { mcpServers: input.mcpServers }),
      ...(input.knowledgePolicy === undefined ? {} : { knowledgePolicy: input.knowledgePolicy }),
      ...(input.contextPolicy === undefined ? {} : { contextPolicy: input.contextPolicy }),
      ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
    });

    if (!created.ok) throw registryFailureProblem(created.failure);

    return c.json(created.value, 201);
  });

  app.openapi(loadoutsUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const patch: UpdateLoadoutPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.agentId !== undefined) patch.agentId = body.agentId;
    if (body.harnessId !== undefined) patch.harnessId = body.harnessId;
    if (Object.hasOwn(body, "modelId")) patch.modelId = body.modelId ?? null;
    if (body.executionProfileId !== undefined) {
      patch.executionProfileId = body.executionProfileId;
    }
    if (body.skillRefs !== undefined) patch.skillRefs = body.skillRefs;
    if (body.toolIds !== undefined) patch.toolIds = body.toolIds;
    if (body.mcpServerIds !== undefined) patch.mcpServerIds = body.mcpServerIds;
    if (body.skills !== undefined) patch.skills = body.skills;
    if (body.tools !== undefined) patch.tools = body.tools;
    if (body.mcpServers !== undefined) patch.mcpServers = body.mcpServers;
    if (body.knowledgePolicy !== undefined) patch.knowledgePolicy = body.knowledgePolicy;
    if (body.contextPolicy !== undefined) patch.contextPolicy = body.contextPolicy;
    if (body.isDefault !== undefined) patch.isDefault = body.isDefault;

    const updated = await loadouts.update(id, patch);
    if (updated === null) throw notFoundProblem("Loadout", id);
    if (!updated.ok) throw registryFailureProblem(updated.failure);

    return c.json(updated.value, 200);
  });

  app.openapi(loadoutsDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");

    const removed = await loadouts.remove(id);
    if (removed === null) throw notFoundProblem("Loadout", id);
    if (!removed.ok) throw registryFailureProblem(removed.failure);

    return c.body(null, 204);
  });

  app.openapi(loadoutVersionsListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { page, pageSize } = resolvePage(c.req.valid("query"));
    const result = await loadouts.versions(id, { page, pageSize });
    if (result === null) throw notFoundProblem("Loadout", id);
    const body: LoadoutVersionPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(loadoutVersionsRestoreRoute, async (c) => {
    const { id, version } = c.req.valid("param");
    const restored = await loadouts.restore(id, Number.parseInt(version, 10));
    if (restored === null) throw notFoundProblem("Loadout", id);
    if (!restored.ok) throw registryFailureProblem(restored.failure);
    return c.json(restored.value, 200);
  });

  app.openapi(loadoutPreflightRoute, async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const checked = await loadouts.preflight.check({
      loadoutId: id,
      executionProfileId: query.executionProfileId,
      resume: query.resume === "true",
    });
    if (checked === null) throw notFoundProblem("Loadout", id);
    if (!checked.ok) throw runFailureProblem(checked.failure);
    return c.json(checked.value, 200);
  });
}
