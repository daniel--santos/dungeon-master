import {
  DecisionListQuerySchema,
  DecisionPageSchema,
  DistillationRequestedSchema,
  DistillationRunListQuerySchema,
  DistillationRunPageSchema,
  KnowledgeItemListQuerySchema,
  KnowledgeItemPageSchema,
  KnowledgeItemSchema,
  ProblemDetailsSchema,
  ProjectSummarySchema,
  ReviewKnowledgeItemSchema,
  UpdateKnowledgeItemSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

/**
 * As rotas do Grimório (planejamento v0.4, Fase 6).
 *
 * O Grimório é lido por Project e revisado por item. Nada aqui chama um
 * modelo: quem escreve itens é o Distiller do Worker, e `POST
 * /projects/{id}/distill` só **pede** um lote — a resposta é `202`, e o
 * lote acontece no Worker, sob o advisory lock do Project, nunca dentro da
 * requisição (CLAUDE.md, seção 12: nada de LLM no caminho quente da UI).
 */

export const ProjectIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 do Project."),
});

export const KnowledgeItemIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 do KnowledgeItem."),
});

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const projectKnowledgeListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/projects/{id}/knowledge`,
  tags: ["knowledge"],
  summary: "O Grimório do Project",
  description:
    "Os itens de conhecimento do Project, do mais recente para o mais antigo. `q` faz busca " +
    "textual (FTS do PostgreSQL) sobre título e conteúdo, e nesse caso a ordem é por " +
    "relevância. `review=pending` é a fila de revisão humana.",
  request: { params: ProjectIdParamSchema, query: KnowledgeItemListQuerySchema },
  responses: {
    200: {
      description: "Uma página do Grimório.",
      content: { "application/json": { schema: KnowledgeItemPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
    404: problem("Não existe Project com este id."),
  },
});

export const knowledgeItemGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/knowledge-items/{id}`,
  tags: ["knowledge"],
  summary: "Um item do Grimório, com proveniência",
  request: { params: KnowledgeItemIdParamSchema },
  responses: {
    200: {
      description: "O item.",
      content: { "application/json": { schema: KnowledgeItemSchema } },
    },
    404: problem("Não existe KnowledgeItem com este id."),
  },
});

export const knowledgeItemUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/knowledge-items/{id}`,
  tags: ["knowledge"],
  summary: "Edita ou arquiva um item",
  description:
    "Título, conteúdo e tipo sobem a `version` quando mudam. `archived: true` arquiva um " +
    "item `ACTIVE`; `false` desarquiva. O `SUMMARY` não troca de tipo: é regenerado pelo " +
    "Distiller.",
  request: {
    params: KnowledgeItemIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateKnowledgeItemSchema } },
    },
  },
  responses: {
    200: {
      description: "O item depois da edição.",
      content: { "application/json": { schema: KnowledgeItemSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe KnowledgeItem com este id."),
    409: problem(
      "Arquivar exige `ACTIVE`, desarquivar exige `ARCHIVED`, e o resumo não troca de tipo.",
    ),
  },
});

export const knowledgeItemApproveRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/knowledge-items/{id}/approve`,
  tags: ["knowledge"],
  summary: "Aprova um item em revisão",
  description:
    "Leva o item a `ACTIVE`. Decisão por CAS: se outra decisão chegou antes, `409` com o " +
    "item atual em `item`. Na mesma transação saem `knowledge.item.reviewed` e " +
    "`knowledge_item.promoted`, o fato que o projetor de Conquistas consome.",
  request: {
    params: KnowledgeItemIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: ReviewKnowledgeItemSchema } },
    },
  },
  responses: {
    200: {
      description: "O item aprovado.",
      content: { "application/json": { schema: KnowledgeItemSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe KnowledgeItem com este id."),
    409: problem("O item já foi revisado; o atual vem em `item`."),
  },
});

export const knowledgeItemRejectRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/knowledge-items/{id}/reject`,
  tags: ["knowledge"],
  summary: "Recusa um item em revisão",
  description: "O mesmo CAS da aprovação. Se outra decisão chegou antes, `409` com o item atual.",
  request: {
    params: KnowledgeItemIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: ReviewKnowledgeItemSchema } },
    },
  },
  responses: {
    200: {
      description: "O item recusado.",
      content: { "application/json": { schema: KnowledgeItemSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe KnowledgeItem com este id."),
    409: problem("O item já foi revisado; o atual vem em `item`."),
  },
});

export const projectSummaryRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/projects/{id}/summary`,
  tags: ["knowledge"],
  summary: "O resumo corrente do Project",
  description:
    "O item `SUMMARY` regenerado pelo Distiller, ou nulo enquanto não houver um, com o " +
    "número de itens que ficaram ativos depois dele.",
  request: { params: ProjectIdParamSchema },
  responses: {
    200: {
      description: "O resumo e o seu atraso.",
      content: { "application/json": { schema: ProjectSummarySchema } },
    },
    404: problem("Não existe Project com este id."),
  },
});

export const projectDecisionsRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/projects/{id}/decisions`,
  tags: ["knowledge"],
  summary: "As decisões do Project",
  description:
    "Os itens `DECISION`, com proveniência, em ordem cronológica — da mais antiga para a " +
    "mais recente. Sem `status`, entram as ativas e as em revisão.",
  request: { params: ProjectIdParamSchema, query: DecisionListQuerySchema },
  responses: {
    200: {
      description: "Uma página de decisões.",
      content: { "application/json": { schema: DecisionPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
    404: problem("Não existe Project com este id."),
  },
});

export const projectDistillRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/projects/{id}/distill`,
  tags: ["knowledge"],
  summary: "Pede um lote do Distiller",
  description:
    "Acorda o Worker pelo canal do banco e responde `202`: o lote roda lá, sob o advisory " +
    "lock do Project, nunca dentro da requisição. Se o Worker estiver fora do ar, os " +
    "candidatos continuam `PENDING` e saem no timer da próxima partida.",
  request: { params: ProjectIdParamSchema },
  responses: {
    202: {
      description: "O pedido foi aceito.",
      content: { "application/json": { schema: DistillationRequestedSchema } },
    },
    404: problem("Não existe Project com este id."),
  },
});

export const distillationRunsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/distillation-runs`,
  tags: ["knowledge"],
  summary: "Os lotes do Distiller",
  description:
    "Do mais recente para o mais antigo. Um lote `FAILED` traz o erro; os candidatos dele " +
    "continuam `PENDING` para o lote seguinte.",
  request: { query: DistillationRunListQuerySchema },
  responses: {
    200: {
      description: "Uma página de lotes.",
      content: { "application/json": { schema: DistillationRunPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});
