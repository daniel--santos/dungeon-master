import type { SkillPage, SkillVersionPage } from "@dungeon-master/contracts";
import type { UpdateSkillPatch } from "@dungeon-master/database";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { SkillsPort } from "../ports.js";
import {
  skillsCreateRoute,
  skillsDeleteRoute,
  skillsGetRoute,
  skillsListRoute,
  skillsUpdateRoute,
  skillVersionsListRoute,
  skillVersionsPublishRoute,
} from "../routes/skills.js";
import { notFoundProblem, registryFailureProblem } from "./failures.js";

export function registerSkillRoutes(app: OpenAPIHono, skills: SkillsPort): void {
  app.openapi(skillsListRoute, async (c) => {
    const { page, pageSize } = resolvePage(c.req.valid("query"));
    const result = await skills.list({ page, pageSize });
    const body: SkillPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(skillsCreateRoute, async (c) => {
    const input = c.req.valid("json");
    const created = await skills.create({
      name: input.name,
      description: input.description ?? null,
      ...(input.content === undefined ? {} : { content: input.content }),
      changelog: input.changelog ?? null,
    });
    if (!created.ok) throw registryFailureProblem(created.failure);
    return c.json(created.value, 201);
  });

  app.openapi(skillsGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const skill = await skills.get(id);
    if (skill === null) throw notFoundProblem("Skill", id);
    return c.json(skill, 200);
  });

  app.openapi(skillsUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Chave ausente é "não mexa"; `null` explícito é "apague".
    const patch: UpdateSkillPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (Object.hasOwn(body, "description")) patch.description = body.description ?? null;

    const updated = await skills.update(id, patch);
    if (updated === null) throw notFoundProblem("Skill", id);
    if (!updated.ok) throw registryFailureProblem(updated.failure);
    return c.json(updated.value, 200);
  });

  app.openapi(skillsDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const removed = await skills.remove(id);
    if (removed === null) throw notFoundProblem("Skill", id);
    if (!removed.ok) throw registryFailureProblem(removed.failure);
    return c.body(null, 204);
  });

  app.openapi(skillVersionsListRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { page, pageSize } = resolvePage(c.req.valid("query"));
    const result = await skills.versions(id, { page, pageSize });
    if (result === null) throw notFoundProblem("Skill", id);
    const body: SkillVersionPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(skillVersionsPublishRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const published = await skills.publish(id, {
      content: body.content,
      changelog: body.changelog ?? null,
      ...(body.expectedLatestVersion === undefined
        ? {}
        : { expectedLatestVersion: body.expectedLatestVersion }),
    });
    if (published === null) throw notFoundProblem("Skill", id);
    if (!published.ok) throw registryFailureProblem(published.failure);
    return c.json(published.value, 201);
  });
}
