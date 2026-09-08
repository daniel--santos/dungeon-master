import {
  ApprovalGateListQuerySchema,
  ApprovalGateListSchema,
  ApprovalGatePageSchema,
  ApprovalGateSchema,
  CreateWorkflowSchema,
  ProblemDetailsSchema,
  ResolveApprovalGateSchema,
  RunStepListSchema,
  UpdateWorkflowSchema,
  WorkflowListQuerySchema,
  WorkflowPageSchema,
  WorkflowSchema,
  WorkflowVersionDetailSchema,
  WorkflowVersionListQuerySchema,
  WorkflowVersionPageSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";
import { RunIdParamSchema } from "./runs.js";

/**
 * Workflow, WorkflowVersion, RunStep e ApprovalGate (planejamento v0.4, Fase 4).
 *
 * A API recebe a definição em JSON e a valida inteira pelo
 * `WorkflowDefinitionSchema`. Um corpo malformado é `400`; uma definição bem
 * formada que quebra uma regra estrutural — ciclo, dependência inexistente,
 * chave repetida, predicado sobre step que não é dependência — é `422`, com
 * `errors[]` apontando o step e o campo. YAML e editor visual não entram
 * aqui: a web converte, quando existir.
 */

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const WorkflowIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 do Workflow."),
});

export const WorkflowVersionIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 da WorkflowVersion."),
});

export const ApprovalGateIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 do ApprovalGate."),
});

const INVALID_DEFINITION =
  "A definição quebra uma regra estrutural: ciclo, dependência inexistente, chave " +
  "repetida, gateKey repetido ou predicado sobre um step que não é dependência. " +
  "`errors[]` aponta o step e o campo.";

// ------------------------------------------------------------------ workflows

export const workflowsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/workflows`,
  tags: ["workflows"],
  summary: "Lista os Workflows",
  description: "Em ordem alfabética de nome. Cada item traz a definição vigente inteira.",
  request: { query: WorkflowListQuerySchema },
  responses: {
    200: {
      description: "Uma página de Workflows.",
      content: { "application/json": { schema: WorkflowPageSchema } },
    },
    400: problem("Paginação inválida."),
  },
});

export const workflowsCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/workflows`,
  tags: ["workflows"],
  summary: "Cria um Workflow",
  description:
    "Recebe a definição inteira: nome, descrição e steps. Workflows são dados, " +
    "validados por schema, sem linguagem de expressão. Nenhuma versão nasce " +
    "aqui: a primeira captura acontece no primeiro Run.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateWorkflowSchema } } },
  },
  responses: {
    201: {
      description: "Workflow criado.",
      content: { "application/json": { schema: WorkflowSchema } },
    },
    400: problem("Corpo malformado."),
    409: problem("Já existe um Workflow com este nome."),
    422: problem(INVALID_DEFINITION),
  },
});

export const workflowsGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/workflows/{id}`,
  tags: ["workflows"],
  summary: "Um Workflow",
  request: { params: WorkflowIdParamSchema },
  responses: {
    200: {
      description: "O Workflow com a definição vigente.",
      content: { "application/json": { schema: WorkflowSchema } },
    },
    404: problem("Não existe Workflow com este id."),
  },
});

export const workflowsUpdateRoute = createRoute({
  method: "put",
  path: `${API_BASE_PATH}/workflows/{id}`,
  tags: ["workflows"],
  summary: "Substitui a definição do Workflow",
  description:
    "Valida e grava a definição inteira. Não toca nas versões já capturadas: " +
    "Runs em andamento e retomadas continuam na versão que congelaram, e a " +
    "próxima captura só cria versão nova se a definição mudou.",
  request: {
    params: WorkflowIdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateWorkflowSchema } } },
  },
  responses: {
    200: {
      description: "O Workflow depois da edição.",
      content: { "application/json": { schema: WorkflowSchema } },
    },
    400: problem("Corpo malformado."),
    404: problem("Não existe Workflow com este id."),
    409: problem("Já existe outro Workflow com este nome."),
    422: problem(INVALID_DEFINITION),
  },
});

export const workflowsDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/workflows/{id}`,
  tags: ["workflows"],
  summary: "Apaga o Workflow",
  description:
    "Recusa com `409` quando alguma versão já foi usada por um Run: o histórico " +
    "do Run ficaria sem a definição que explica os steps dele. Tasks que " +
    "apontavam para o Workflow voltam ao Run simples.",
  request: { params: WorkflowIdParamSchema },
  responses: {
    204: { description: "Workflow apagado." },
    404: problem("Não existe Workflow com este id."),
    409: problem("Alguma versão do Workflow é referenciada por Runs."),
  },
});

export const workflowsVersionsRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/workflows/{id}/versions`,
  tags: ["workflows"],
  summary: "As versões congeladas do Workflow",
  description:
    "Da mais recente para a mais antiga. Cada uma traz a definição no instante da captura.",
  request: { params: WorkflowIdParamSchema, query: WorkflowVersionListQuerySchema },
  responses: {
    200: {
      description: "Uma página de versões.",
      content: { "application/json": { schema: WorkflowVersionPageSchema } },
    },
    400: problem("Paginação inválida."),
    404: problem("Não existe Workflow com este id."),
  },
});

export const workflowVersionsGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/workflow-versions/{id}`,
  tags: ["workflows"],
  summary: "Uma versão congelada, com os steps",
  description:
    "É o que `workflowVersionId` do Run aponta. Imutável: a resposta é a mesma " +
    "hoje e depois de qualquer edição do Workflow.",
  request: { params: WorkflowVersionIdParamSchema },
  responses: {
    200: {
      description: "A versão e os steps, na ordem topológica.",
      content: { "application/json": { schema: WorkflowVersionDetailSchema } },
    },
    404: problem("Não existe WorkflowVersion com este id."),
  },
});

// ----------------------------------------------------------------- run steps

export const runsStepsRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/runs/{id}/steps`,
  tags: ["runs"],
  summary: "Os steps do Run",
  description:
    "Na ordem topológica da versão capturada, com estado, tentativa, resultado e " +
    "erro de cada um. Vazio num Run simples, sem Workflow.",
  request: { params: RunIdParamSchema },
  responses: {
    200: {
      description: "Os RunSteps.",
      content: { "application/json": { schema: RunStepListSchema } },
    },
    404: problem("Não existe Run com este id."),
  },
});

export const runsGatesRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/runs/{id}/gates`,
  tags: ["runs"],
  summary: "Os gates de aprovação do Run",
  description: "Do pedido mais antigo ao mais novo, pendentes e decididos.",
  request: { params: RunIdParamSchema },
  responses: {
    200: {
      description: "Os ApprovalGates.",
      content: { "application/json": { schema: ApprovalGateListSchema } },
    },
    404: problem("Não existe Run com este id."),
  },
});

// ------------------------------------------------------------ approval gates

export const approvalGatesListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/approval-gates`,
  tags: ["approvals"],
  summary: "Lista os gates de aprovação",
  description:
    "Do pedido mais recente para o mais antigo. `status=PENDING` é a caixa de " +
    "entrada de aprovações. Cada item traz `taskId` e `taskTitle` por junção.",
  request: { query: ApprovalGateListQuerySchema },
  responses: {
    200: {
      description: "Uma página de gates.",
      content: { "application/json": { schema: ApprovalGatePageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const approvalGatesResolveRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/approval-gates/{id}/resolve`,
  tags: ["approvals"],
  summary: "Aprova ou recusa o gate",
  description:
    "Resolução por CAS transacional: um único `UPDATE` condicionado a " +
    "`status = PENDING`. Se outra decisão chegou antes, a resposta é `409` com o " +
    "estado atual do gate em `gate`, e nada é sobrescrito. Na mesma transação o " +
    "RunStep de aprovação assenta, o Run volta a `QUEUED` para o Worker retomá-lo, " +
    "e `ApprovalGranted` ou `ApprovalRejected` entram no log do Run.",
  request: {
    params: ApprovalGateIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: ResolveApprovalGateSchema } },
    },
  },
  responses: {
    200: {
      description: "O gate decidido.",
      content: { "application/json": { schema: ApprovalGateSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe ApprovalGate com este id."),
    409: problem(
      "O gate já foi decidido (o estado atual vem em `gate`), ou o Run não está mais esperando.",
    ),
  },
});
