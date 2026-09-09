import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  CreateMcpServerBody,
  CreateProviderBody,
  CreateSkillBody,
  CreateToolBody,
  LoadoutPreflightRecord,
  LoadoutRecord,
  LoadoutVersionPageRecord,
  McpServerPageRecord,
  McpServerRegistryRecord,
  ProviderPageRecord,
  ProviderRecord,
  PublishSkillVersionBody,
  SkillDetailRecord,
  SkillPageRecord,
  SkillRecord,
  SkillVersionPageRecord,
  SkillVersionRecord,
  ToolPageRecord,
  ToolRecord,
  UpdateMcpServerBody,
  UpdateProviderBody,
  UpdateSkillBody,
  UpdateToolBody,
} from "@/lib/api-types";
import { invalidateExecution, LOADOUT_VERSIONS_KEY } from "@/lib/execution";
import { ApiError, fail, problemMessage } from "@/lib/problem";
import { useProviderAuthStore } from "@/lib/provider-auth";

/**
 * Os quatro registros da Fase 8A — Skills, Tools, servidores MCP e Providers —
 * e o que a Fase 8A acrescentou ao Loadout: versões, restauração e preflight.
 *
 * A invalidação é ampla de propósito, como em `lib/execution.ts`: uma Skill
 * renomeada muda o nome que todo Loadout mostra em `skillRefs`, e publicar
 * uma versão muda o `latestVersion` que o pin oferece. Por isso toda mutação
 * daqui invalida também as chaves de execução, e o SSE `registry.changed`
 * faz o mesmo (`lib/live.ts`).
 *
 * As listas são lidas inteiras, numa página larga: são cadastros de um
 * usuário só, e a tela de Loadout precisa de todos para o seletor. A
 * paginação da API fica para quando a biblioteca crescer além disso.
 */

/** Uma página cobre o cadastro inteiro de um usuário. */
export const REGISTRY_PAGE_SIZE = 100;

/** Quantas versões de uma Skill o histórico lê por vez. */
export const SKILL_VERSIONS_PAGE_SIZE = 50;

/** Quantas versões de um Loadout o histórico lê por vez. */
export const LOADOUT_VERSIONS_PAGE_SIZE = 20;

export const registryKeys = {
  all: ["registry"] as const,
  skills: ["registry", "skills"] as const,
  skill: (id: string) => ["registry", "skills", "detail", id] as const,
  skillVersions: (id: string, page: number) =>
    ["registry", "skills", "versions", id, page] as const,
  tools: ["registry", "tools"] as const,
  mcpServers: ["registry", "mcp-servers"] as const,
  providers: ["registry", "providers"] as const,
  loadoutVersions: (id: string, page: number) => [...LOADOUT_VERSIONS_KEY, id, page] as const,
  loadoutPreflight: (
    id: string,
    version: number,
    executionProfileId: string | undefined,
    resume: boolean,
  ) => ["registry", "loadout-preflight", id, version, executionProfileId ?? null, resume] as const,
};

/** Tudo o que os registros afetam: as listas daqui e os cadastros de execução. */
export function invalidateRegistry(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: registryKeys.all });
  invalidateExecution(queryClient);
}

const PAGE_QUERY = { page: "1", pageSize: String(REGISTRY_PAGE_SIZE) };

/* --------------------------------------------------------------- Skills */

export function useSkills(): UseQueryResult<SkillPageRecord> {
  return useQuery({
    queryKey: registryKeys.skills,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/skills", {
        params: { query: PAGE_QUERY },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export function useSkill(id: string): UseQueryResult<SkillDetailRecord> {
  return useQuery({
    queryKey: registryKeys.skill(id),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/skills/{id}", {
        params: { path: { id } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o registro");
      return data;
    },
  });
}

export function useSkillVersions(id: string, page = 1): UseQueryResult<SkillVersionPageRecord> {
  return useQuery({
    queryKey: registryKeys.skillVersions(id, page),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/skills/{id}/versions", {
        params: {
          path: { id },
          query: { page: String(page), pageSize: String(SKILL_VERSIONS_PAGE_SIZE) },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler as versões");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

export function useCreateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateSkillBody): Promise<SkillDetailRecord> => {
      const { data, error, response } = await api.POST("/api/v1/skills", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

export interface UpdateSkillInput extends UpdateSkillBody {
  readonly id: string;
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateSkillInput): Promise<SkillRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/skills/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/skills/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

export interface PublishSkillVersionInput extends PublishSkillVersionBody {
  readonly id: string;
}

/**
 * A publicação perdeu a corrida: outra aba publicou antes (CAS por
 * `expectedLatestVersion`). Um erro próprio, para o diálogo dizer isso em vez
 * de tentar de novo por cima.
 */
export class SkillVersionConflictError extends ApiError {
  constructor(message: string) {
    super(message, 409);
    this.name = "SkillVersionConflictError";
  }
}

/** Publica a versão seguinte. Append-only: nunca reescreve a anterior. */
export function usePublishSkillVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: PublishSkillVersionInput): Promise<SkillVersionRecord> => {
      const { data, error, response } = await api.POST("/api/v1/skills/{id}/versions", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) {
        const message = problemMessage(error, response.status, "Não foi possível publicar");
        if (response.status === 409 && body.expectedLatestVersion !== undefined) {
          throw new SkillVersionConflictError(message);
        }
        throw new ApiError(message, response.status);
      }
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

/* ---------------------------------------------------------------- Tools */

export function useTools(): UseQueryResult<ToolPageRecord> {
  return useQuery({
    queryKey: registryKeys.tools,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/tools", {
        params: { query: PAGE_QUERY },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export function useCreateTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateToolBody): Promise<ToolRecord> => {
      const { data, error, response } = await api.POST("/api/v1/tools", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

export interface UpdateToolInput extends UpdateToolBody {
  readonly id: string;
}

export function useUpdateTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateToolInput): Promise<ToolRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/tools/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

export function useDeleteTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/tools/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

/* ---------------------------------------------------------- McpServers */

export function useMcpServers(): UseQueryResult<McpServerPageRecord> {
  return useQuery({
    queryKey: registryKeys.mcpServers,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/mcp-servers", {
        params: { query: PAGE_QUERY },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateMcpServerBody): Promise<McpServerRegistryRecord> => {
      const { data, error, response } = await api.POST("/api/v1/mcp-servers", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

export interface UpdateMcpServerInput extends UpdateMcpServerBody {
  readonly id: string;
}

export function useUpdateMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateMcpServerInput): Promise<McpServerRegistryRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/mcp-servers/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/mcp-servers/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

/* ------------------------------------------------------------ Providers */

export function useProviders(): UseQueryResult<ProviderPageRecord> {
  return useQuery({
    queryKey: registryKeys.providers,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/providers", {
        params: { query: PAGE_QUERY },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export function useCreateProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateProviderBody): Promise<ProviderRecord> => {
      const { data, error, response } = await api.POST("/api/v1/providers", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

export interface UpdateProviderInput extends UpdateProviderBody {
  readonly id: string;
}

export function useUpdateProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateProviderInput): Promise<ProviderRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/providers/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/providers/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

/* ----------------------------------------------------- Loadout: versões */

export function useLoadoutVersions(
  loadoutId: string,
  page = 1,
): UseQueryResult<LoadoutVersionPageRecord> {
  return useQuery({
    queryKey: registryKeys.loadoutVersions(loadoutId, page),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/loadouts/{id}/versions", {
        params: {
          path: { id: loadoutId },
          query: { page: String(page), pageSize: String(LOADOUT_VERSIONS_PAGE_SIZE) },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler as versões");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

export interface RestoreLoadoutVersionInput {
  readonly loadoutId: string;
  readonly version: number;
}

/**
 * Restaura uma versão: o Loadout ganha uma versão **nova**, igual à antiga.
 *
 * Quando a antiga é idêntica à atual a API devolve o Loadout como está, sem
 * subir a versão; quem chama compara o número que voltou com o que tinha.
 */
export function useRestoreLoadoutVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      loadoutId,
      version,
    }: RestoreLoadoutVersionInput): Promise<LoadoutRecord> => {
      const { data, error, response } = await api.POST(
        "/api/v1/loadouts/{id}/versions/{version}/restore",
        { params: { path: { id: loadoutId, version: String(version) } } },
      );
      if (data === undefined) fail(error, response.status, "Não foi possível restaurar");
      return data;
    },
    onSuccess: () => {
      invalidateRegistry(queryClient);
    },
  });
}

/* --------------------------------------------------- Loadout: preflight */

export interface LoadoutPreflightParams {
  /** Sobrepõe o perfil do Loadout, como `POST /runs` permite. */
  readonly executionProfileId?: string;
  /** Avalia a intenção de retomar uma sessão. */
  readonly resume?: boolean;
}

/** Lê o preflight de um Loadout. Exportado para quem precisa dele fora de uma query. */
export async function fetchLoadoutPreflight(
  loadoutId: string,
  params: LoadoutPreflightParams = {},
): Promise<LoadoutPreflightRecord> {
  const { data, error, response } = await api.GET("/api/v1/loadouts/{id}/preflight", {
    params: {
      path: { id: loadoutId },
      query: {
        ...(params.executionProfileId === undefined
          ? {}
          : { executionProfileId: params.executionProfileId }),
        ...(params.resume === true ? { resume: "true" as const } : {}),
      },
    },
  });
  if (data === undefined) fail(error, response.status, "Não foi possível verificar");
  // O estado da credencial do Provider fica guardado para a tela de
  // Providers e para o toast de credencial perdida.
  if (data.provider !== null) {
    useProviderAuthStore.getState().record(data.provider, data.checkedAt);
  }
  return data;
}

/**
 * O preflight de um Loadout, medido na chamada.
 *
 * A chave leva a `version` do Loadout: salvar cria uma chave nova e mede de
 * novo; o resto do tempo o resultado não envelhece sozinho, porque medir sobe
 * a CLI e, num perfil `DOCKER`, o daemon. "Verificar de novo" é `refetch`.
 */
export function useLoadoutPreflight(
  loadout: Pick<LoadoutRecord, "id" | "version"> | undefined,
  params: LoadoutPreflightParams = {},
  enabled = true,
): UseQueryResult<LoadoutPreflightRecord> {
  return useQuery({
    queryKey: registryKeys.loadoutPreflight(
      loadout?.id ?? "",
      loadout?.version ?? 0,
      params.executionProfileId,
      params.resume === true,
    ),
    queryFn: () => fetchLoadoutPreflight(loadout?.id ?? "", params),
    enabled: enabled && loadout !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
