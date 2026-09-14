import type {
  AutonomyLevel,
  BreakerScope,
  BreakerState,
  BudgetScope,
  PolicySubject,
  RoutingKind,
} from "@dungeon-master/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  ApprovalPolicyPageRecord,
  ApprovalPolicyRecord,
  BudgetPageRecord,
  BudgetRecord,
  BudgetUsageRecord,
  CircuitBreakerPageRecord,
  CircuitBreakerRecord,
  CreateApprovalPolicyBody,
  CreateBudgetBody,
  CreateCircuitBreakerBody,
  CreateRoutingRuleBody,
  ProjectAutonomyRecord,
  RoutingRulePageRecord,
  RoutingRuleRecord,
  TaskSuggestionsRecord,
  UpdateApprovalPolicyBody,
  UpdateBudgetBody,
  UpdateCircuitBreakerBody,
  UpdateRoutingRuleBody,
} from "@/lib/api-types";
import { ApiError, fail, problemCode, problemMessage } from "@/lib/problem";
import { projectKeys } from "@/lib/projects";

/**
 * A autonomia controlada (Fase 9A) na web: as quatro regras — políticas de
 * aprovação, orçamentos, disjuntores e regras de roteamento —, o nível do
 * Project e as sugestões para uma Task.
 *
 * As listas são lidas inteiras, numa página larga, como as do Arsenal: são
 * cadastros de um usuário só, e a tela de uma Campanha precisa de todas as
 * regras que decidem por ela. `projectId` no filtro devolve "as deste
 * Project mais as globais" para políticas, orçamentos e roteamento, que é
 * exatamente o conjunto que a API consulta na hora de decidir; disjuntores
 * não têm escopo global, e o filtro devolve só os do Project.
 *
 * A invalidação é ampla e única: qualquer escrita, e o `registry.changed`
 * dos quatro `kind`s novos, derruba `["autonomy"]` inteiro. Uma regra a
 * menos muda a decisão que a próxima partida vai tomar, e uma lista errada
 * é pior do que uma releitura a mais.
 */

/** Uma página cobre o cadastro inteiro de um usuário. */
export const AUTONOMY_PAGE_SIZE = 100;

export interface AutonomyListParams {
  /** As deste Project mais as globais; ausente lê tudo. */
  readonly projectId?: string;
}

export const autonomyKeys = {
  all: ["autonomy"] as const,
  policies: (params: AutonomyListParams, subject?: PolicySubject) =>
    ["autonomy", "policies", params.projectId ?? "*", subject ?? "*"] as const,
  policy: (id: string) => ["autonomy", "policies", "detail", id] as const,
  budgets: (params: AutonomyListParams, scope?: BudgetScope) =>
    ["autonomy", "budgets", params.projectId ?? "*", scope ?? "*"] as const,
  budgetUsage: (id: string) => ["autonomy", "budgets", "usage", id] as const,
  breakers: (params: AutonomyListParams, scope?: BreakerScope, state?: BreakerState) =>
    ["autonomy", "breakers", params.projectId ?? "*", scope ?? "*", state ?? "*"] as const,
  breaker: (id: string) => ["autonomy", "breakers", "detail", id] as const,
  routingRules: (params: AutonomyListParams, kind?: RoutingKind) =>
    ["autonomy", "routing-rules", params.projectId ?? "*", kind ?? "*"] as const,
  project: (projectId: string) => ["autonomy", "project", projectId] as const,
  suggestions: (taskId: string) => ["autonomy", "suggestions", taskId] as const,
};

/** Tudo o que a autonomia afeta: as regras, o nível e as sugestões. */
export function invalidateAutonomy(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: autonomyKeys.all });
}

const PAGE = { page: "1", pageSize: String(AUTONOMY_PAGE_SIZE) };

/* ------------------------------------------------------------- policies */

export function useApprovalPolicies(
  params: AutonomyListParams = {},
  subject?: PolicySubject,
): UseQueryResult<ApprovalPolicyPageRecord> {
  return useQuery({
    queryKey: autonomyKeys.policies(params, subject),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/approval-policies", {
        params: {
          query: {
            ...PAGE,
            ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
            ...(subject === undefined ? {} : { subject }),
          },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

/** Uma política pelo id; `null` desliga. Serve ao diálogo que nomeia quem recusou. */
export function useApprovalPolicy(id: string | null): UseQueryResult<ApprovalPolicyRecord> {
  return useQuery({
    queryKey: autonomyKeys.policy(id ?? ""),
    enabled: id !== null,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/approval-policies/{id}", {
        params: { path: { id: id ?? "" } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o registro");
      return data;
    },
  });
}

export function useCreateApprovalPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateApprovalPolicyBody): Promise<ApprovalPolicyRecord> => {
      const { data, error, response } = await api.POST("/api/v1/approval-policies", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

export interface UpdateApprovalPolicyInput extends UpdateApprovalPolicyBody {
  readonly id: string;
}

export function useUpdateApprovalPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: UpdateApprovalPolicyInput): Promise<ApprovalPolicyRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/approval-policies/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

export function useDeleteApprovalPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/approval-policies/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

/* -------------------------------------------------------------- budgets */

export function useBudgets(
  params: AutonomyListParams = {},
  scope?: BudgetScope,
): UseQueryResult<BudgetPageRecord> {
  return useQuery({
    queryKey: autonomyKeys.budgets(params, scope),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/budgets", {
        params: {
          query: {
            ...PAGE,
            ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
            ...(scope === undefined ? {} : { scope }),
          },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

/**
 * O consumo de um orçamento, medido na chamada pela mesma função que
 * `POST /runs` usa. Relido a cada minuto enquanto a tela estiver aberta: a
 * janela anda e os Runs vivos somam tempo sem que nenhum evento avise.
 */
export function useBudgetUsage(id: string, enabled = true): UseQueryResult<BudgetUsageRecord> {
  return useQuery({
    queryKey: autonomyKeys.budgetUsage(id),
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/budgets/{id}/usage", {
        params: { path: { id } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível medir o consumo");
      return data;
    },
    refetchInterval: 60_000,
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateBudgetBody): Promise<BudgetRecord> => {
      const { data, error, response } = await api.POST("/api/v1/budgets", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

export interface UpdateBudgetInput extends UpdateBudgetBody {
  readonly id: string;
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateBudgetInput): Promise<BudgetRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/budgets/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/budgets/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

/* ------------------------------------------------------------- breakers */

export function useCircuitBreakers(
  params: AutonomyListParams = {},
  scope?: BreakerScope,
  state?: BreakerState,
): UseQueryResult<CircuitBreakerPageRecord> {
  return useQuery({
    queryKey: autonomyKeys.breakers(params, scope, state),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/circuit-breakers", {
        params: {
          query: {
            ...PAGE,
            ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
            ...(scope === undefined ? {} : { scope }),
            ...(state === undefined ? {} : { state }),
          },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

/** Um disjuntor pelo id; `null` desliga. Serve ao diálogo que diz quando ele reabre. */
export function useCircuitBreaker(id: string | null): UseQueryResult<CircuitBreakerRecord> {
  return useQuery({
    queryKey: autonomyKeys.breaker(id ?? ""),
    enabled: id !== null,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/circuit-breakers/{id}", {
        params: { path: { id: id ?? "" } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o registro");
      return data;
    },
  });
}

export function useCreateCircuitBreaker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateCircuitBreakerBody): Promise<CircuitBreakerRecord> => {
      const { data, error, response } = await api.POST("/api/v1/circuit-breakers", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

export interface UpdateCircuitBreakerInput extends UpdateCircuitBreakerBody {
  readonly id: string;
}

export function useUpdateCircuitBreaker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: UpdateCircuitBreakerInput): Promise<CircuitBreakerRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/circuit-breakers/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

export function useDeleteCircuitBreaker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/circuit-breakers/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

/** Fecha o disjuntor de qualquer estado. Idempotente na API; irreversível na tela. */
export function useResetCircuitBreaker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<CircuitBreakerRecord> => {
      const { data, error, response } = await api.POST("/api/v1/circuit-breakers/{id}/reset", {
        params: { path: { id } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível fechar o disjuntor");
      return data;
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

/* -------------------------------------------------------- routing rules */

export function useRoutingRules(
  params: AutonomyListParams = {},
  kind?: RoutingKind,
): UseQueryResult<RoutingRulePageRecord> {
  return useQuery({
    queryKey: autonomyKeys.routingRules(params, kind),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/routing-rules", {
        params: {
          query: {
            ...PAGE,
            ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
            ...(kind === undefined ? {} : { kind }),
          },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export function useCreateRoutingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateRoutingRuleBody): Promise<RoutingRuleRecord> => {
      const { data, error, response } = await api.POST("/api/v1/routing-rules", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

export interface UpdateRoutingRuleInput extends UpdateRoutingRuleBody {
  readonly id: string;
}

export function useUpdateRoutingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateRoutingRuleInput): Promise<RoutingRuleRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/routing-rules/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

export function useDeleteRoutingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/routing-rules/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateAutonomy(queryClient);
    },
  });
}

/* ----------------------------------------------------- project autonomy */

/** O nível do Project e o que ele libera. `null` desliga. */
export function useProjectAutonomy(
  projectId: string | null,
): UseQueryResult<ProjectAutonomyRecord> {
  return useQuery({
    queryKey: autonomyKeys.project(projectId ?? ""),
    enabled: projectId !== null,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/projects/{id}/autonomy", {
        params: { path: { id: projectId ?? "" } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o nível");
      return data;
    },
  });
}

export interface UpdateProjectAutonomyInput {
  readonly projectId: string;
  readonly autonomyLevel: AutonomyLevel;
}

export function useUpdateProjectAutonomy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      autonomyLevel,
    }: UpdateProjectAutonomyInput): Promise<ProjectAutonomyRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/projects/{id}/autonomy", {
        params: { path: { id: projectId } },
        body: { autonomyLevel },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível mudar o nível");
      return data;
    },
    onSuccess: (autonomy) => {
      queryClient.setQueryData(autonomyKeys.project(autonomy.projectId), autonomy);
      invalidateAutonomy(queryClient);
      // O Project carrega `autonomyLevel` também.
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

/* ---------------------------------------------------------- suggestions */

/**
 * O nível do Project não libera sugestões (`409 AUTOMATION_NOT_ALLOWED`).
 *
 * Um erro próprio, para o diálogo de partida dizer que a rédea está curta em
 * vez de mostrar um `detail` genérico — e para não tentar de novo.
 */
export class SuggestionsNotAllowedError extends ApiError {
  readonly autonomyLevel: number | null;

  constructor(message: string, autonomyLevel: number | null) {
    super(message, 409);
    this.name = "SuggestionsNotAllowedError";
    this.autonomyLevel = autonomyLevel;
  }
}

/**
 * As sugestões para uma Task: Loadout, Workflow e Model com o motivo.
 *
 * É um `POST` sem escrita — a API avalia as regras e não grava nada —, e
 * por isso vive numa query: o diálogo de partida pede ao abrir e reaproveita
 * enquanto estiver aberto. `staleTime` curto: as regras mudam de outra aba e
 * o `registry.changed` já invalida `["autonomy"]` inteiro.
 */
export function useTaskSuggestions(
  taskId: string,
  enabled = true,
): UseQueryResult<TaskSuggestionsRecord> {
  return useQuery({
    queryKey: autonomyKeys.suggestions(taskId),
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api.POST("/api/v1/tasks/{id}/suggestions", {
        params: { path: { id: taskId } },
      });
      if (data === undefined) {
        const message = problemMessage(error, response.status, "Não foi possível sugerir");
        if (response.status === 409 && problemCode(error) === "AUTOMATION_NOT_ALLOWED") {
          const level = (error as { autonomyLevel?: unknown } | undefined)?.autonomyLevel;
          throw new SuggestionsNotAllowedError(message, typeof level === "number" ? level : null);
        }
        throw new ApiError(message, response.status);
      }
      return data;
    },
    retry: false,
    staleTime: 30_000,
  });
}
