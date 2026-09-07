import type { ActivityPage, ProjectPage } from "@dungeon-master/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { ProjectsPort } from "../ports.js";
import {
  projectsActivityRoute,
  projectsArchiveRoute,
  projectsCreateRoute,
  projectsGetRoute,
  projectsListRoute,
  projectsUnarchiveRoute,
  projectsUpdateRoute,
} from "../routes/projects.js";
import { notFoundProblem } from "./failures.js";

/**
 * As rotas de Project.
 *
 * Ficam fora de `createApp` porque a app tem rotas demais para um arquivo só,
 * mas a fiação é a mesma: a porta entra por injeção e o handler não sabe se
 * atrás dela existe PostgreSQL.
 */
export function registerProjectRoutes(app: OpenAPIHono, projects: ProjectsPort): void {
  app.openapi(projectsListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);

    const result = await projects.list({ page, pageSize, status: query.status });
    const body: ProjectPage = { items: result.items, page, pageSize, total: result.total };

    return c.json(body, 200);
  });

  app.openapi(projectsCreateRoute, async (c) => {
    const input = c.req.valid("json");

    return c.json(
      await projects.create({ title: input.title, description: input.description ?? null }),
      201,
    );
  });

  app.openapi(projectsGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const project = await projects.get(id);

    if (project === null) throw notFoundProblem("Project", id);

    return c.json(project, 200);
  });

  app.openapi(projectsUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // `Object.hasOwn` e não `!== undefined`: `description: null` é "apague a
    // descrição" e a chave ausente é "não mexa nela". As duas chegam como
    // valores diferentes e precisam continuar diferentes.
    const patch: { title?: string; description?: string | null } = {};
    if (body.title !== undefined) patch.title = body.title;
    if (Object.hasOwn(body, "description")) patch.description = body.description ?? null;

    const project = await projects.update(id, patch);
    if (project === null) throw notFoundProblem("Project", id);

    return c.json(project, 200);
  });

  app.openapi(projectsArchiveRoute, async (c) => {
    const { id } = c.req.valid("param");
    const project = await projects.setArchived(id, true);

    if (project === null) throw notFoundProblem("Project", id);

    return c.json(project, 200);
  });

  app.openapi(projectsUnarchiveRoute, async (c) => {
    const { id } = c.req.valid("param");
    const project = await projects.setArchived(id, false);

    if (project === null) throw notFoundProblem("Project", id);

    return c.json(project, 200);
  });

  app.openapi(projectsActivityRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { page, pageSize } = resolvePage(c.req.valid("query"));

    const result = await projects.activity(id, { page, pageSize });
    if (result === null) throw notFoundProblem("Project", id);

    const body: ActivityPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });
}
