import type {
  ApprovalPolicyRecord,
  BreakerAdmissionRecord,
  BudgetBreachRecord,
  BudgetRecord,
  BudgetUsageRecord,
  CircuitBreakerRecord,
  PolicyDecisionRecord,
  ProjectAutonomyRecord,
  RoutingRuleRecord,
  TaskSuggestionsRecord,
} from "@/lib/api-types";
import { LOADOUT, TASK } from "@/test/execution-fixtures";

/**
 * Registros da autonomia controlada (Fase 9A) para os testes de componente
 * da Fase 9C: uma política, um orçamento com consumo, um disjuntor aberto,
 * uma regra de roteamento, o nível de uma Campanha, as sugestões de uma
 * Task e as três recusas de `POST /runs`.
 */

const NOW = "2026-09-14T10:00:00.000Z";

export const PROJECT_ID = TASK.projectId ?? "0199ffff-0000-7000-8000-000000000001";

export function projectAutonomy(level: ProjectAutonomyRecord["autonomyLevel"]): ProjectAutonomyRecord {
  return {
    projectId: PROJECT_ID,
    autonomyLevel: level,
    allows: {
      SUGGEST: level >= 1,
      AUTO_APPROVE_PROPOSAL: level >= 3,
      AUTO_APPROVE_GATE: level >= 3,
      AUTO_DISPATCH: level >= 3,
      DELEGATE: level >= 4,
    },
    updatedAt: NOW,
  };
}

export const AUTONOMY_LEVEL_2 = projectAutonomy(2);
export const AUTONOMY_LEVEL_3 = projectAutonomy(3);

export const POLICY: ApprovalPolicyRecord = {
  id: "0199a900-0000-7000-8000-000000000001",
  name: "Aprova tarefas pequenas",
  subject: "PROPOSAL",
  projectId: PROJECT_ID,
  priority: 100,
  conditions: { taskKind: ["CHORE"], hasCommandTools: false },
  action: "AUTO_APPROVE",
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

export const GLOBAL_DENY_POLICY: ApprovalPolicyRecord = {
  id: "0199a900-0000-7000-8000-000000000002",
  name: "Nada parte fora do container",
  subject: "RUN_START",
  projectId: null,
  priority: 500,
  conditions: { executionMode: "HOST" },
  action: "DENY",
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

export const BUDGET: BudgetRecord = {
  id: "0199a900-0000-7000-8000-000000000011",
  name: "Cofre do dia",
  scope: "PROJECT",
  projectId: PROJECT_ID,
  loadoutId: null,
  window: "DAY",
  limits: { maxTokens: 100_000, maxRuns: 10, maxWallClockMs: null, maxConcurrentRuns: 2 },
  action: "BLOCK",
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

export const BUDGET_USAGE: BudgetUsageRecord = {
  budgetId: BUDGET.id,
  window: "DAY",
  windowStart: "2026-09-14T00:00:00.000Z",
  windowEnd: "2026-09-15T00:00:00.000Z",
  runId: null,
  tokens: 85_000,
  tokensKnown: true,
  runsWithoutUsage: 0,
  runs: 4,
  wallClockMs: 1_800_000,
  concurrentRuns: 1,
  limits: BUDGET.limits,
  pressure: 0.85,
  exceeded: [],
  computedAt: NOW,
};

export const BUDGET_USAGE_UNKNOWN: BudgetUsageRecord = {
  ...BUDGET_USAGE,
  tokens: 20_000,
  tokensKnown: false,
  runsWithoutUsage: 2,
  runs: 10,
  pressure: 1,
  exceeded: ["maxRuns"],
};

export const BUDGET_BREACH: BudgetBreachRecord = {
  budgetId: BUDGET.id,
  name: BUDGET.name,
  action: "BLOCK",
  limit: "maxRuns",
  limitValue: 10,
  current: 11,
  decidedBy: `BUDGET:${BUDGET.id}`,
  reason: 'O orçamento "Cofre do dia" está no teto de 10 Runs por dia; o pedido seria o 11º.',
  usage: { ...BUDGET_USAGE, runs: 10, pressure: 1, exceeded: ["maxRuns"] },
};

export const BREAKER: CircuitBreakerRecord = {
  id: "0199a900-0000-7000-8000-000000000021",
  name: "Guarda do portão",
  scope: "PROJECT",
  projectId: PROJECT_ID,
  loadoutId: null,
  harnessKey: null,
  triggers: {
    consecutiveFailures: 3,
    failuresInWindow: null,
    permissionDeniedInWindow: null,
    authNotAuthenticated: false,
  },
  cooldownMs: 3_600_000,
  state: "OPEN",
  openedAt: "2026-09-14T09:30:00.000Z",
  reason: "Três Runs seguidos falharam.",
  probeRunId: null,
  consecutiveFailures: 3,
  stateChangedAt: "2026-09-14T09:30:00.000Z",
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

export const BREAKER_CLOSED: CircuitBreakerRecord = {
  ...BREAKER,
  state: "CLOSED",
  openedAt: null,
  reason: null,
  consecutiveFailures: 0,
};

export const BREAKER_ADMISSION_REFUSED: BreakerAdmissionRecord = {
  breakerId: BREAKER.id,
  name: BREAKER.name,
  state: "OPEN",
  probe: false,
  decidedBy: `BREAKER:${BREAKER.id}`,
  reason: "Aberto; faltam 1800000 ms de cooldown.",
};

export const ROUTING_RULE: RoutingRuleRecord = {
  id: "0199a900-0000-7000-8000-000000000031",
  name: "Forja da plataforma",
  kind: "LOADOUT",
  projectId: PROJECT_ID,
  priority: 100,
  conditions: { taskKind: "BUG" },
  targetId: LOADOUT.id,
  fallbackIds: [],
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

export const SUGGESTIONS: TaskSuggestionsRecord = {
  taskId: TASK.id,
  projectId: PROJECT_ID,
  autonomyLevel: 3,
  loadout: {
    kind: "LOADOUT",
    selectedId: LOADOUT.id,
    selectedName: LOADOUT.name,
    ruleId: ROUTING_RULE.id,
    decidedBy: `ROUTING:${ROUTING_RULE.id}`,
    reason: `A regra "${ROUTING_RULE.name}" (${ROUTING_RULE.id}) casou e o alvo preferido serviu.`,
    attempts: [{ targetId: LOADOUT.id, accepted: true, reason: "Alvo válido neste contexto." }],
  },
  workflow: {
    kind: "WORKFLOW",
    selectedId: null,
    selectedName: null,
    ruleId: null,
    decidedBy: "DEFAULT",
    reason: "Nenhuma regra de fluxo casou. A Task não tem fluxo: vale o Run simples.",
    attempts: [],
  },
  model: {
    kind: "MODEL",
    selectedId: null,
    selectedName: null,
    ruleId: null,
    decidedBy: "DEFAULT",
    reason: "Nenhuma regra de modelo casou. Vale o padrão da CLI.",
    attempts: [],
  },
  budgetPressure: 0.85,
  computedAt: NOW,
};

export const POLICY_DENIED_DECISION: PolicyDecisionRecord = {
  subject: "RUN_START",
  action: "DENY",
  policyId: GLOBAL_DENY_POLICY.id,
  policyAction: "DENY",
  decidedBy: `POLICY:${GLOBAL_DENY_POLICY.id}`,
  autonomyLevel: 3,
  reason: `A política "${GLOBAL_DENY_POLICY.name}" (${GLOBAL_DENY_POLICY.id}) casou e recusa.`,
  decidedAt: NOW,
};

/** Um `409` da autonomia, no formato que `openapi-fetch` devolve. */
export function refused(code: string, extension: Record<string, unknown>, detail: string) {
  return {
    data: undefined,
    error: {
      type: "about:blank",
      title: "Conflito",
      status: 409,
      detail,
      code,
      ...extension,
    },
    response: new Response(null, { status: 409 }),
  };
}
