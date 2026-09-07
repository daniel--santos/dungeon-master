import type { ActivityPage, ProjectPage } from "@dungeon-master/contracts";
import { normalizeAbsolutePath } from "@dungeon-master/platform";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { statSync } from "node:fs";

import { resolvePage } from "../pagination.js";
import type { ProjectsPort, UpdateProjectRequest } from "../ports.js";
import { HttpProblem, ProblemType } from "../problem.js";
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
/**
 * Normaliza o caminho do workspace e confere que ele existe **agora**.
 *
 * A normalização é de `@dungeon-master/platform`, que é a única casa de código
 * de caminho: ela recusa caminho relativo, byte nulo e `..` sobrevivente, e
 * devolve a forma canônica do sistema operacional atual.
 *
 * A checagem no disco é feita aqui, na borda, e não no repositório: gravar um
 * caminho que não existe transformaria um erro que dá para explicar agora — "o
 * diretório não está aí" — numa falha de preparação de Run daqui a uma semana,
 * longe de quem digitou. Ela **não** é garantia: o diretório pode sumir depois,
 * e o preflight do Run confere de novo antes de subir qualquer processo.
 */
function validarWorkspacePath(candidato: string): string {
  let normalizado: string;

  try {
    normalizado = normalizeAbsolutePath(candidato);
  } catch (error) {
    throw new HttpProblem({
      status: 400,
      type: ProblemType.validation,
      title: "Caminho de workspace inválido",
      detail: error instanceof Error ? error.message : String(error),
      errors: [
        {
          path: "workspacePath",
          message: "O caminho precisa ser absoluto e canônico.",
          code: "invalid_path",
        },
      ],
    });
  }

  let ehDiretorio: boolean;
  try {
    ehDiretorio = statSync(normalizado).isDirectory();
  } catch {
    ehDiretorio = false;
  }

  if (!ehDiretorio) {
    throw new HttpProblem({
      status: 400,
      type: ProblemType.validation,
      title: "Workspace não encontrado",
      detail:
        `Não existe um diretório em ${normalizado} na máquina que roda a API. ` +
        "O caminho é local: um agente sem diretório de trabalho não pode nem começar.",
      errors: [
        {
          path: "workspacePath",
          message: "O diretório precisa existir na máquina que roda a API.",
          code: "path_not_found",
        },
      ],
    });
  }

  return normalizado;
}

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
    const patch: UpdateProjectRequest = {};
    if (body.title !== undefined) patch.title = body.title;
    if (Object.hasOwn(body, "description")) patch.description = body.description ?? null;
    if (body.workspaceKind !== undefined) patch.workspaceKind = body.workspaceKind;
    if (Object.hasOwn(body, "workspacePath")) {
      // `null` desliga o workspace e não passa pela validação de caminho: o que
      // se está pedindo é justamente que não haja caminho nenhum.
      patch.workspacePath =
        body.workspacePath == null ? null : validarWorkspacePath(body.workspacePath);
    }

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
