import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  AgentListRecord,
  AgentRecord,
  CreateAgentBody,
  CreateLoadoutBody,
  CreateModelBody,
  DockerPreflightRecord,
  ExecutionProfileRecord,
  HarnessRecord,
  LoadoutRecord,
  ModelRecord,
  UpdateAgentBody,
  UpdateExecutionProfileBody,
  UpdateLoadoutBody,
  UpdateModelBody,
} from "@/lib/api-types";
import { fail } from "@/lib/problem";

/**
 * Os cinco cadastros de execução da Fase 2A.
 *
 * Harness é cadastro **fechado**: as quatro linhas nascem no `db:seed` e a API
 * só aceita ligar e desligar. Os outros quatro têm CRUD. A invalidação é ampla
 * de propósito: mexer num Agent muda o resumo de todo Loadout que o usa, e uma
 * lista errada é pior do que uma releitura a mais.
 */

export const executionKeys = {
  agents: ["agents"] as const,
  harnesses: ["harnesses"] as const,
  models: ["models"] as const,
  profiles: ["execution-profiles"] as const,
  loadouts: ["loadouts"] as const,
  dockerPreflight: ["docker-preflight"] as const,
};

/**
 * O preflight do backend Docker, sob demanda.
 *
 * Desligado até alguém chamar `refetch`: a API mede na hora, subindo um
 * container por harness, e isso não é coisa de acontecer só porque Settings
 * abriu. O resultado não envelhece sozinho — é a foto do instante em que o
 * usuário pediu, e a data vai junto.
 */
export function useDockerPreflight(): UseQueryResult<DockerPreflightRecord> {
  return useQuery({
    queryKey: executionKeys.dockerPreflight,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/preflights/docker");
      if (data === undefined) fail(error, response.status, "Não foi possível medir o preflight");
      return data;
    },
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

/** Tudo que um Loadout referencia muda o que a tela de Equipamentos mostra. */
function invalidateExecution(queryClient: ReturnType<typeof useQueryClient>): void {
  for (const key of Object.values(executionKeys)) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

/* -------------------------------------------------------------- Agents */

export function useAgents(): UseQueryResult<AgentListRecord> {
  return useQuery({
    queryKey: executionKeys.agents,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/agents");
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateAgentBody): Promise<AgentRecord> => {
      const { data, error, response } = await api.POST("/api/v1/agents", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

export interface UpdateAgentInput extends UpdateAgentBody {
  readonly id: string;
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateAgentInput): Promise<AgentRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/agents/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

/**
 * Apaga um Agent.
 *
 * A recusa por Loadout que ainda o usa chega como `409` com o motivo em
 * `detail`; quem chama mostra esse texto num toast em vez de inventar um.
 */
export function useDeleteAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/agents/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

/* ------------------------------------------------------------ Harnesses */

export function useHarnesses(): UseQueryResult<{ items: readonly HarnessRecord[] }> {
  return useQuery({
    queryKey: executionKeys.harnesses,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/harnesses");
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

/** Liga ou desliga um Harness. Desligado some das escolhas, não do histórico. */
export function useSetHarnessEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      enabled,
    }: {
      id: string;
      enabled: boolean;
    }): Promise<HarnessRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/harnesses/{id}", {
        params: { path: { id } },
        body: { enabled },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

/* --------------------------------------------------------------- Models */

export function useModels(): UseQueryResult<{ items: readonly ModelRecord[] }> {
  return useQuery({
    queryKey: executionKeys.models,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/models");
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export function useCreateModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateModelBody): Promise<ModelRecord> => {
      const { data, error, response } = await api.POST("/api/v1/models", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

export interface UpdateModelInput extends UpdateModelBody {
  readonly id: string;
}

export function useUpdateModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateModelInput): Promise<ModelRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/models/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/models/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

/* ---------------------------------------------------- ExecutionProfiles */

export function useExecutionProfiles(): UseQueryResult<{
  items: readonly ExecutionProfileRecord[];
}> {
  return useQuery({
    queryKey: executionKeys.profiles,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/execution-profiles");
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export interface UpdateExecutionProfileInput extends UpdateExecutionProfileBody {
  readonly id: string;
}

export function useUpdateExecutionProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: UpdateExecutionProfileInput): Promise<ExecutionProfileRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/execution-profiles/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

/* ------------------------------------------------------------- Loadouts */

export function useLoadouts(): UseQueryResult<{ items: readonly LoadoutRecord[] }> {
  return useQuery({
    queryKey: executionKeys.loadouts,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/loadouts");
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export function useCreateLoadout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateLoadoutBody): Promise<LoadoutRecord> => {
      const { data, error, response } = await api.POST("/api/v1/loadouts", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

export interface UpdateLoadoutInput extends UpdateLoadoutBody {
  readonly id: string;
}

/**
 * Salva um Loadout.
 *
 * A `version` sobe só quando a edição muda alguma coisa (planejamento v0.4,
 * Fase 2A): mandar os mesmos valores não é uma edição, e a decisão é do
 * servidor. A tela mostra o número que voltar, sem prever qual será.
 */
export function useUpdateLoadout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateLoadoutInput): Promise<LoadoutRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/loadouts/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}

export function useDeleteLoadout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/loadouts/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateExecution(queryClient);
    },
  });
}
