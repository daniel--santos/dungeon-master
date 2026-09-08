import type { OpenAPIHono } from "@hono/zod-openapi";

import type { ProjectsPort, TasksPort } from "../ports.js";
import { projectsTaskGraphRoute, tasksReplaceDependenciesRoute } from "../routes/task-graph.js";
import { dependencyFailureProblem, notFoundProblem } from "./failures.js";

/**
 * O grafo de Tasks de um Project e a edição do conjunto de dependências
 * (Fase 5). Ficam juntos porque são as duas faces da mesma tela: ler o grafo
 * e mudar as arestas dele.
 */
export function registerTaskGraphRoutes(
  app: OpenAPIHono,
  ports: { projects: ProjectsPort; tasks: TasksPort },
): void {
  app.openapi(projectsTaskGraphRoute, async (c) => {
    const { id } = c.req.valid("param");
    const graph = await ports.projects.taskGraph(id);
    if (graph === null) throw notFoundProblem("Project", id);
    return c.json(graph, 200);
  });

  app.openapi(tasksReplaceDependenciesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { dependsOn } = c.req.valid("json");

    const result = await ports.tasks.replaceDependencies(id, dependsOn);
    if (result === null) throw notFoundProblem("Task", id);
    if (!result.ok) throw dependencyFailureProblem(result.failure);

    return c.json(result.value, 200);
  });
}
