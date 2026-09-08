import {
  ProblemDetailsSchema,
  ReplaceTaskDependenciesSchema,
  TaskDetailSchema,
  TaskGraphSchema,
} from "@dungeon-master/contracts";
import { createRoute } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";
import { ProjectIdParamSchema } from "./projects.js";
import { TaskIdParamSchema } from "./tasks.js";

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const projectsTaskGraphRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/projects/{id}/task-graph`,
  tags: ["tasks"],
  summary: "O grafo de Tasks do Project",
  description:
    "Os nós são as Tasks do Project, da mais antiga para a mais nova; as arestas são as " +
    "dependências com as duas pontas no Project, no sentido da execução (`from` termina " +
    "antes de `to`). A hierarquia vai em `parentTaskId` de cada nó. `hasOpenProposals` " +
    "marca as Tasks cujos Runs propuseram trabalho ainda não decidido.",
  request: { params: ProjectIdParamSchema },
  responses: {
    200: {
      description: "O grafo.",
      content: { "application/json": { schema: TaskGraphSchema } },
    },
    404: problem("Não existe Project com este id."),
  },
});

export const tasksReplaceDependenciesRoute = createRoute({
  method: "put",
  path: `${API_BASE_PATH}/tasks/{id}/dependencies`,
  tags: ["tasks"],
  summary: "Troca o conjunto inteiro de dependências",
  description:
    "Um `PUT` de verdade: o que saiu da lista é removido, o que entrou é inserido, o que " +
    "ficou não gera fato. Idempotente. Toda dependência precisa estar no mesmo Project; " +
    "uma Task de outro Project é `404`, porque não existe neste grafo. Ciclo, direto ou " +
    "indireto, vira `409` com o caminho do impasse em `path`.",
  request: {
    params: TaskIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: ReplaceTaskDependenciesSchema } },
    },
  },
  responses: {
    200: {
      description: "A Task com o conjunto novo de dependências.",
      content: { "application/json": { schema: TaskDetailSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("A Task não existe, ou alguma dependência não existe neste Project."),
    409: problem("Auto-dependência, ciclo (o caminho vem em `path`), ou Task na Inbox."),
  },
});
