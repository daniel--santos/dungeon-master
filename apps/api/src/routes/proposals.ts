import {
  ApproveProposedTaskSchema,
  KnowledgeCandidateListQuerySchema,
  KnowledgeCandidatePageSchema,
  ProblemDetailsSchema,
  ProposedTaskListItemSchema,
  ProposedTaskListQuerySchema,
  ProposedTaskPageSchema,
  ProposedTaskSchema,
  RejectProposedTaskSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

export const ProposedTaskIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 da ProposedTask."),
});

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const proposedTasksListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/proposed-tasks`,
  tags: ["proposals"],
  summary: "Lista as propostas de trabalho",
  description:
    "Da proposta mais recente para a mais antiga. `status=PROPOSED` é a caixa de " +
    "entrada de propostas. Cada item traz o título da Task de origem e do Project por " +
    "junção. `taskId` filtra pela Task de origem.",
  request: { query: ProposedTaskListQuerySchema },
  responses: {
    200: {
      description: "Uma página de propostas.",
      content: { "application/json": { schema: ProposedTaskPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const proposedTasksGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/proposed-tasks/{id}`,
  tags: ["proposals"],
  summary: "Uma proposta, com os títulos da origem",
  request: { params: ProposedTaskIdParamSchema },
  responses: {
    200: {
      description: "A proposta.",
      content: { "application/json": { schema: ProposedTaskListItemSchema } },
    },
    404: problem("Não existe ProposedTask com este id."),
  },
});

export const proposedTasksApproveRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/proposed-tasks/{id}/approve`,
  tags: ["proposals"],
  summary: "Aprova a proposta e cria a Task",
  description:
    "Cria uma Task em `READY` no Project da proposta, filha da Task de origem por padrão " +
    "(`parentTaskId: null` cria sem mãe), com as dependências de `dependsOn` — todas do " +
    "mesmo Project, escolhidas por quem aprova; nada é inferido. Decisão por CAS " +
    "transacional: se outra decisão chegou antes, a resposta é `409` com a proposta atual " +
    "em `proposedTask`, e nada é sobrescrito. Na mesma transação saem `task.created`, as " +
    "arestas, e `task.proposal.resolved` no stream.",
  request: {
    params: ProposedTaskIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: ApproveProposedTaskSchema } },
    },
  },
  responses: {
    200: {
      description: "A proposta aprovada, com `createdTaskId` apontando para a Task criada.",
      content: { "application/json": { schema: ProposedTaskSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem(
      "A proposta, a Task mãe, alguma dependência ou o Workflow informados não existem " +
        "neste Project.",
    ),
    409: problem(
      "A proposta já foi decidida (a atual vem em `proposedTask`), o Project está arquivado, " +
        "a mãe ou uma dependência está na Inbox, ou as dependências fechariam um ciclo " +
        "(o caminho vem em `path`).",
    ),
  },
});

export const proposedTasksRejectRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/proposed-tasks/{id}/reject`,
  tags: ["proposals"],
  summary: "Recusa a proposta",
  description:
    "O mesmo CAS da aprovação, sem criar Task. Se outra decisão chegou antes, `409` com a " +
    "proposta atual em `proposedTask`.",
  request: {
    params: ProposedTaskIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: RejectProposedTaskSchema } },
    },
  },
  responses: {
    200: {
      description: "A proposta recusada.",
      content: { "application/json": { schema: ProposedTaskSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe ProposedTask com este id."),
    409: problem("A proposta já foi decidida; a atual vem em `proposedTask`."),
  },
});

export const knowledgeCandidatesListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/knowledge-candidates`,
  tags: ["knowledge"],
  summary: "Lista os candidatos a conhecimento",
  description:
    "Do candidato mais recente para o mais antigo. Gravados na transação do desfecho do " +
    "Run; a destilação em itens do Grimório é da Fase 6, e por enquanto a rota é só leitura.",
  request: { query: KnowledgeCandidateListQuerySchema },
  responses: {
    200: {
      description: "Uma página de candidatos.",
      content: { "application/json": { schema: KnowledgeCandidatePageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});
