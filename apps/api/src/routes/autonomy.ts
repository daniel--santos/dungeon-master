import {
  ApprovalPolicyListQuerySchema,
  ApprovalPolicyPageSchema,
  ApprovalPolicySchema,
  BudgetListQuerySchema,
  BudgetPageSchema,
  BudgetSchema,
  BudgetUsageSchema,
  CircuitBreakerListQuerySchema,
  CircuitBreakerPageSchema,
  CircuitBreakerSchema,
  CreateApprovalPolicySchema,
  CreateBudgetSchema,
  CreateCircuitBreakerSchema,
  CreateRoutingRuleSchema,
  ProblemDetailsSchema,
  ProjectAutonomySchema,
  RoutingRuleListQuerySchema,
  RoutingRulePageSchema,
  RoutingRuleSchema,
  TaskSuggestionsSchema,
  UpdateApprovalPolicySchema,
  UpdateBudgetSchema,
  UpdateCircuitBreakerSchema,
  UpdateProjectAutonomySchema,
  UpdateRoutingRuleSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

/**
 * As rotas da autonomia controlada (planejamento v0.4, Fase 9A): políticas
 * de aprovação, orçamentos, disjuntores, regras de roteamento, o nível de
 * autonomia do Project e as sugestões de uma Task.
 *
 * Nenhuma delas chama modelo nenhum. As quatro primeiras são cadastros
 * paginados pelo mesmo `PageQuerySchema` das outras listagens; as duas
 * últimas são computações sobre o que está gravado.
 */

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

const json = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

export const AutonomyIdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 do registro."),
});

const ProjectIdParamSchema = z.object({ id: z.uuid().describe("UUIDv7 do Project.") });
const TaskIdParamSchema = z.object({ id: z.uuid().describe("UUIDv7 da Task.") });

// ------------------------------------------------------------ approval-policies

export const approvalPoliciesListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/approval-policies`,
  tags: ["autonomy"],
  summary: "Lista as políticas de aprovação",
  description:
    "Da maior prioridade para a menor. `projectId` devolve as do Project **mais as globais**, " +
    "que é exatamente o conjunto avaliado numa decisão.",
  request: { query: ApprovalPolicyListQuerySchema },
  responses: {
    200: {
      description: "Uma página de políticas.",
      content: { "application/json": { schema: ApprovalPolicyPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const approvalPoliciesCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/approval-policies`,
  tags: ["autonomy"],
  summary: "Cria uma política de aprovação",
  description:
    "Condições no vocabulário fechado de `RuleConditions`, conjunção; a de maior prioridade " +
    "que casa decide, e empate é revisão humana. `AUTO_APPROVE` só produz efeito quando o nível " +
    "de autonomia do Project libera a automação do assunto (nível 3). `projectId` ausente cria " +
    "uma política global.",
  request: { body: json(CreateApprovalPolicySchema) },
  responses: {
    201: {
      description: "Política criada.",
      content: { "application/json": { schema: ApprovalPolicySchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("O Project informado não existe."),
  },
});

export const approvalPoliciesGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/approval-policies/{id}`,
  tags: ["autonomy"],
  summary: "Uma política de aprovação",
  request: { params: AutonomyIdParamSchema },
  responses: {
    200: {
      description: "A política.",
      content: { "application/json": { schema: ApprovalPolicySchema } },
    },
    404: problem("Não existe ApprovalPolicy com este id."),
  },
});

export const approvalPoliciesUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/approval-policies/{id}`,
  tags: ["autonomy"],
  summary: "Edita a política de aprovação",
  description: "`projectId: null` torna a política global. Emite `registry.changed`.",
  request: { params: AutonomyIdParamSchema, body: json(UpdateApprovalPolicySchema) },
  responses: {
    200: {
      description: "A política depois da edição.",
      content: { "application/json": { schema: ApprovalPolicySchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe ApprovalPolicy com este id, ou o Project informado não existe."),
  },
});

export const approvalPoliciesDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/approval-policies/{id}`,
  tags: ["autonomy"],
  summary: "Apaga a política de aprovação",
  request: { params: AutonomyIdParamSchema },
  responses: {
    204: { description: "Política apagada." },
    404: problem("Não existe ApprovalPolicy com este id."),
  },
});

// ---------------------------------------------------------------------- budgets

export const budgetsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/budgets`,
  tags: ["autonomy"],
  summary: "Lista os orçamentos",
  description:
    "Em ordem alfabética. `projectId` e `loadoutId` devolvem os do escopo **mais os globais**.",
  request: { query: BudgetListQuerySchema },
  responses: {
    200: {
      description: "Uma página de orçamentos.",
      content: { "application/json": { schema: BudgetPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const budgetsCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/budgets`,
  tags: ["autonomy"],
  summary: "Cria um orçamento",
  description:
    "Escopo `GLOBAL`, `PROJECT` (com `projectId`) ou `LOADOUT` (com `loadoutId`); janela de " +
    "calendário em UTC (`DAY`, `WEEK`, `MONTH`) ou `PER_RUN`, que só aceita `maxTokens` e " +
    "`maxWallClockMs` e é aplicada pelo Worker durante a execução. Pelo menos um teto. " +
    "`BLOCK` recusa `POST /runs` com `409 BUDGET_EXCEEDED`; `WARN` deixa passar e avisa em " +
    "`budgetWarnings[]`. Consumo desconhecido (Run que rodou sem reportar tokens) não libera " +
    "um teto de tokens.",
  request: { body: json(CreateBudgetSchema) },
  responses: {
    201: {
      description: "Orçamento criado.",
      content: { "application/json": { schema: BudgetSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("O Project ou o Loadout informado não existe."),
    409: problem(
      "Id de escopo que não bate com o escopo, nenhum teto, ou teto que a janela não aceita.",
    ),
  },
});

export const budgetsGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/budgets/{id}`,
  tags: ["autonomy"],
  summary: "Um orçamento",
  request: { params: AutonomyIdParamSchema },
  responses: {
    200: { description: "O orçamento.", content: { "application/json": { schema: BudgetSchema } } },
    404: problem("Não existe Budget com este id."),
  },
});

export const budgetsUsageRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/budgets/{id}/usage`,
  tags: ["autonomy"],
  summary: "O consumo do orçamento na janela atual",
  description:
    "Medido na chamada, pela mesma função que `POST /runs` usa: tokens de `run.result.usage`, " +
    "Runs criados na janela, duração somada (os vivos contados até agora) e Runs vivos. " +
    "`tokensKnown` é falso quando algum Run que rodou terminou sem reportar consumo. " +
    "Em `PER_RUN`, mede o último Run terminal do escopo.",
  request: { params: AutonomyIdParamSchema },
  responses: {
    200: {
      description: "O consumo medido.",
      content: { "application/json": { schema: BudgetUsageSchema } },
    },
    404: problem("Não existe Budget com este id."),
  },
});

export const budgetsUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/budgets/{id}`,
  tags: ["autonomy"],
  summary: "Edita o orçamento",
  description: "Escopo e janela não mudam: apague e crie de novo. Um teto `null` desliga o teto.",
  request: { params: AutonomyIdParamSchema, body: json(UpdateBudgetSchema) },
  responses: {
    200: {
      description: "O orçamento depois da edição.",
      content: { "application/json": { schema: BudgetSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Budget com este id."),
    409: problem("Nenhum teto sobraria, ou teto que a janela não aceita."),
  },
});

export const budgetsDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/budgets/{id}`,
  tags: ["autonomy"],
  summary: "Apaga o orçamento",
  request: { params: AutonomyIdParamSchema },
  responses: {
    204: { description: "Orçamento apagado." },
    404: problem("Não existe Budget com este id."),
  },
});

// -------------------------------------------------------------- circuit-breakers

export const circuitBreakersListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/circuit-breakers`,
  tags: ["autonomy"],
  summary: "Lista os disjuntores",
  request: { query: CircuitBreakerListQuerySchema },
  responses: {
    200: {
      description: "Uma página de disjuntores, em ordem alfabética.",
      content: { "application/json": { schema: CircuitBreakerPageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const circuitBreakersCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/circuit-breakers`,
  tags: ["autonomy"],
  summary: "Cria um disjuntor",
  description:
    "Escopo `PROJECT`, `LOADOUT` ou `HARNESS`, com o id (ou a chave) do escopo; pelo menos um " +
    "gatilho. Nasce `CLOSED`. `OPEN` recusa `POST /runs` com `409 BREAKER_OPEN`; passado o " +
    "`cooldownMs`, o próximo pedido vira a sondagem do `HALF_OPEN`, uma por vez. Quem alimenta " +
    "os gatilhos com os desfechos é o Worker.",
  request: { body: json(CreateCircuitBreakerSchema) },
  responses: {
    201: {
      description: "Disjuntor criado.",
      content: { "application/json": { schema: CircuitBreakerSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("O Project ou o Loadout informado não existe."),
    409: problem("Id de escopo que não bate com o escopo, ou nenhum gatilho."),
  },
});

export const circuitBreakersGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/circuit-breakers/{id}`,
  tags: ["autonomy"],
  summary: "Um disjuntor",
  request: { params: AutonomyIdParamSchema },
  responses: {
    200: {
      description: "O disjuntor, com o estado.",
      content: { "application/json": { schema: CircuitBreakerSchema } },
    },
    404: problem("Não existe CircuitBreaker com este id."),
  },
});

export const circuitBreakersUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/circuit-breakers/{id}`,
  tags: ["autonomy"],
  summary: "Edita o disjuntor",
  description:
    "Nome, gatilhos, cooldown e interruptor. O estado não muda por aqui: só pelos desfechos " +
    "e por `POST /circuit-breakers/{id}/reset`.",
  request: { params: AutonomyIdParamSchema, body: json(UpdateCircuitBreakerSchema) },
  responses: {
    200: {
      description: "O disjuntor depois da edição.",
      content: { "application/json": { schema: CircuitBreakerSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe CircuitBreaker com este id."),
    409: problem("Nenhum gatilho sobraria."),
  },
});

export const circuitBreakersDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/circuit-breakers/{id}`,
  tags: ["autonomy"],
  summary: "Apaga o disjuntor",
  request: { params: AutonomyIdParamSchema },
  responses: {
    204: { description: "Disjuntor apagado." },
    404: problem("Não existe CircuitBreaker com este id."),
  },
});

export const circuitBreakersResetRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/circuit-breakers/{id}/reset`,
  tags: ["autonomy"],
  summary: "Fecha o disjuntor à mão",
  description:
    "De qualquer estado para `CLOSED`, zerando instante, motivo, sondagem e contador. " +
    "Idempotente: um disjuntor já fechado devolve o mesmo e não grava um segundo fato. " +
    "`breaker.closed` sai na mesma transação.",
  request: { params: AutonomyIdParamSchema },
  responses: {
    200: {
      description: "O disjuntor fechado.",
      content: { "application/json": { schema: CircuitBreakerSchema } },
    },
    404: problem("Não existe CircuitBreaker com este id."),
  },
});

// ----------------------------------------------------------------- routing-rules

export const routingRulesListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/routing-rules`,
  tags: ["autonomy"],
  summary: "Lista as regras de roteamento",
  description:
    "Da maior prioridade para a menor. `projectId` devolve as do Project **mais as globais**.",
  request: { query: RoutingRuleListQuerySchema },
  responses: {
    200: {
      description: "Uma página de regras.",
      content: { "application/json": { schema: RoutingRulePageSchema } },
    },
    400: problem("Filtro ou paginação inválidos."),
  },
});

export const routingRulesCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/routing-rules`,
  tags: ["autonomy"],
  summary: "Cria uma regra de roteamento",
  description:
    "`kind` `MODEL`, `LOADOUT` ou `WORKFLOW`; `targetId` e `fallbackIds` precisam existir na " +
    "tabela da espécie. Em `POST /runs`, só `MODEL` é avaliada, e só quando o Loadout deixa o " +
    "Model nulo; um Model de outro Harness é pulado para o fallback seguinte. " +
    "`minBudgetPressure` nas condições permite preferir um Model mais barato quando a janela " +
    "de orçamento aperta.",
  request: { body: json(CreateRoutingRuleSchema) },
  responses: {
    201: {
      description: "Regra criada.",
      content: { "application/json": { schema: RoutingRuleSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("O Project, ou um dos alvos, não existe."),
  },
});

export const routingRulesGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/routing-rules/{id}`,
  tags: ["autonomy"],
  summary: "Uma regra de roteamento",
  request: { params: AutonomyIdParamSchema },
  responses: {
    200: {
      description: "A regra.",
      content: { "application/json": { schema: RoutingRuleSchema } },
    },
    404: problem("Não existe RoutingRule com este id."),
  },
});

export const routingRulesUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/routing-rules/{id}`,
  tags: ["autonomy"],
  summary: "Edita a regra de roteamento",
  description: "`kind` não muda: apague e crie de novo.",
  request: { params: AutonomyIdParamSchema, body: json(UpdateRoutingRuleSchema) },
  responses: {
    200: {
      description: "A regra depois da edição.",
      content: { "application/json": { schema: RoutingRuleSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe RoutingRule com este id, ou o Project ou um alvo não existe."),
  },
});

export const routingRulesDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/routing-rules/{id}`,
  tags: ["autonomy"],
  summary: "Apaga a regra de roteamento",
  request: { params: AutonomyIdParamSchema },
  responses: {
    204: { description: "Regra apagada." },
    404: problem("Não existe RoutingRule com este id."),
  },
});

// ------------------------------------------------------------ project autonomy

export const projectAutonomyGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/projects/{id}/autonomy`,
  tags: ["autonomy"],
  summary: "O nível de autonomia do Project e o que ele libera",
  request: { params: ProjectIdParamSchema },
  responses: {
    200: {
      description: "O nível e o mapa de automações liberadas.",
      content: { "application/json": { schema: ProjectAutonomySchema } },
    },
    404: problem("Não existe Project com este id."),
  },
});

export const projectAutonomyUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/projects/{id}/autonomy`,
  tags: ["autonomy"],
  summary: "Muda o nível de autonomia do Project",
  description:
    "0 manual, 1 sugere, 2 propõe e o humano aprova (o padrão), 3 políticas autoaprovam e " +
    "auto-despacho, 4 delegação Agent-to-Agent. Idempotente; grava `project.updated` no diário " +
    "e `autonomy.changed` no stream, na mesma transação.",
  request: { params: ProjectIdParamSchema, body: json(UpdateProjectAutonomySchema) },
  responses: {
    200: {
      description: "O nível depois da mudança.",
      content: { "application/json": { schema: ProjectAutonomySchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Project com este id."),
  },
});

// ------------------------------------------------------------------ suggestions

export const taskSuggestionsRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/tasks/{id}/suggestions`,
  tags: ["autonomy"],
  summary: "Sugere Loadout, Workflow e Model para a Task",
  description:
    "Avalia as regras de roteamento das três espécies com os fatos da Task e a pressão de " +
    "orçamento, e devolve cada escolha com o motivo (a regra, ou o padrão do sistema). Nada é " +
    "gravado. Exige Project e nível de autonomia que libere `SUGGEST` (≥ 1).",
  request: { params: TaskIdParamSchema },
  responses: {
    200: {
      description: "As sugestões, com o motivo de cada uma.",
      content: { "application/json": { schema: TaskSuggestionsSchema } },
    },
    404: problem("Não existe Task com este id."),
    409: problem("A Task não tem Project, ou o nível de autonomia não libera sugestões."),
  },
});
