import type { ProviderPage } from "@dungeon-master/contracts";
import type { UpdateProviderPatch } from "@dungeon-master/database";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { ProvidersPort } from "../ports.js";
import {
  providersCreateRoute,
  providersDeleteRoute,
  providersGetRoute,
  providersListRoute,
  providersUpdateRoute,
} from "../routes/providers.js";
import { notFoundProblem, registryFailureProblem } from "./failures.js";

export function registerProviderRoutes(app: OpenAPIHono, providers: ProvidersPort): void {
  app.openapi(providersListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);
    const result = await providers.list({ page, pageSize, harnessKey: query.harnessKey });
    const body: ProviderPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(providersCreateRoute, async (c) => {
    const input = c.req.valid("json");
    const created = await providers.create({
      name: input.name,
      kind: input.kind,
      ...(input.authEnvKeys === undefined ? {} : { authEnvKeys: input.authEnvKeys }),
      ...(input.harnessKeys === undefined ? {} : { harnessKeys: input.harnessKeys }),
      docsUrl: input.docsUrl ?? null,
    });
    if (!created.ok) throw registryFailureProblem(created.failure);
    return c.json(created.value, 201);
  });

  app.openapi(providersGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const provider = await providers.get(id);
    if (provider === null) throw notFoundProblem("Provider", id);
    return c.json(provider, 200);
  });

  app.openapi(providersUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const patch: UpdateProviderPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.authEnvKeys !== undefined) patch.authEnvKeys = body.authEnvKeys;
    if (body.harnessKeys !== undefined) patch.harnessKeys = body.harnessKeys;
    if (Object.hasOwn(body, "docsUrl")) patch.docsUrl = body.docsUrl ?? null;

    const updated = await providers.update(id, patch);
    if (updated === null) throw notFoundProblem("Provider", id);
    if (!updated.ok) throw registryFailureProblem(updated.failure);
    return c.json(updated.value, 200);
  });

  app.openapi(providersDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const removed = await providers.remove(id);
    if (removed === null) throw notFoundProblem("Provider", id);
    if (!removed.ok) throw registryFailureProblem(removed.failure);
    return c.body(null, 204);
  });
}
