import {
  CreateSkillSchema,
  ProblemDetailsSchema,
  PublishSkillVersionSchema,
  SkillDetailSchema,
  SkillListQuerySchema,
  SkillPageSchema,
  SkillSchema,
  SkillVersionListQuerySchema,
  SkillVersionPageSchema,
  SkillVersionSchema,
  UpdateSkillSchema,
} from "@dungeon-master/contracts";
import { createRoute } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";
import { IdParamSchema } from "./registry.js";

/**
 * Skills: registro com nome e descrição, conteúdo em versões imutáveis
 * (planejamento v0.4, Fase 8A).
 *
 * Paginadas, ao contrário dos cadastros da Fase 2: uma biblioteca de Skills
 * cresce com o uso, e a listagem é o que a tela de Loadout abre para escolher.
 */

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const skillsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/skills`,
  tags: ["registry"],
  summary: "Lista as Skills",
  request: { query: SkillListQuerySchema },
  responses: {
    200: {
      description: "Uma página de Skills, em ordem alfabética.",
      content: { "application/json": { schema: SkillPageSchema } },
    },
    400: problem("Paginação inválida."),
  },
});

export const skillsCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/skills`,
  tags: ["registry"],
  summary: "Cria uma Skill na versão 1",
  description:
    "O nome é único por usuário. O conteúdo vai para a versão 1; publicar de novo é " +
    "`POST /skills/{id}/versions`, nunca um PATCH no conteúdo.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateSkillSchema } } },
  },
  responses: {
    201: {
      description: "Skill criada, com a versão 1.",
      content: { "application/json": { schema: SkillDetailSchema } },
    },
    400: problem("Corpo inválido."),
    409: problem("Já existe uma Skill com este nome."),
  },
});

export const skillsGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/skills/{id}`,
  tags: ["registry"],
  summary: "Uma Skill, com a versão mais recente",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "A Skill e o conteúdo da versão mais recente.",
      content: { "application/json": { schema: SkillDetailSchema } },
    },
    404: problem("Não existe Skill com este id."),
  },
});

export const skillsUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/skills/{id}`,
  tags: ["registry"],
  summary: "Edita nome e descrição da Skill",
  description: "O conteúdo não se edita: publique uma versão nova.",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateSkillSchema } } },
  },
  responses: {
    200: {
      description: "A Skill depois da edição.",
      content: { "application/json": { schema: SkillSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Skill com este id."),
    409: problem("Já existe uma Skill com este nome."),
  },
});

export const skillsDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/skills/{id}`,
  tags: ["registry"],
  summary: "Apaga a Skill e as versões dela",
  description:
    "Recusa enquanto algum Loadout a referencia. Runs antigos não impedem: o snapshot " +
    "deles carrega o conteúdo da versão efetiva.",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Skill apagada." },
    404: problem("Não existe Skill com este id."),
    409: problem("Algum Loadout ainda referencia esta Skill."),
  },
});

export const skillVersionsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/skills/{id}/versions`,
  tags: ["registry"],
  summary: "As versões da Skill",
  description: "Da mais recente para a mais antiga, cada uma com o conteúdo e o changelog.",
  request: { params: IdParamSchema, query: SkillVersionListQuerySchema },
  responses: {
    200: {
      description: "Uma página de versões.",
      content: { "application/json": { schema: SkillVersionPageSchema } },
    },
    400: problem("Paginação inválida."),
    404: problem("Não existe Skill com este id."),
  },
});

export const skillVersionsPublishRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/skills/{id}/versions`,
  tags: ["registry"],
  summary: "Publica a versão seguinte da Skill",
  description:
    "Append-only: cria `latestVersion + 1` e nunca reescreve uma versão. Com " +
    "`expectedLatestVersion`, recusa com `409` se outra publicação chegou antes (CAS).",
  request: {
    params: IdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: PublishSkillVersionSchema } },
    },
  },
  responses: {
    201: {
      description: "A versão publicada.",
      content: { "application/json": { schema: SkillVersionSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Skill com este id."),
    409: problem("A versão mais recente já não é a esperada."),
  },
});
