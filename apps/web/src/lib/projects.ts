import type { components } from "@dungeon-master/api-client";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { api } from "@/lib/api";
import { fail } from "@/lib/problem";

type Project = components["schemas"]["Project"];
type ProjectPage = components["schemas"]["ProjectPage"];
type ProjectDetail = components["schemas"]["ProjectDetail"];
type ProjectStatus = components["schemas"]["ProjectStatus"];
type ActivityPage = components["schemas"]["ActivityPage"];
type CreateProject = components["schemas"]["CreateProject"];
type UpdateProject = components["schemas"]["UpdateProject"];

export const projectKeys = {
  all: ["projects"] as const,
  list: (status: ProjectStatus | undefined, page: number, pageSize: number) =>
    ["projects", "list", status ?? "ALL", page, pageSize] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
  activity: (id: string, page: number, pageSize: number) =>
    ["projects", "activity", id, page, pageSize] as const,
};

export interface ProjectListParams {
  readonly status?: ProjectStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

export function useProjects(params: ProjectListParams = {}): UseQueryResult<ProjectPage> {
  const { status, page = 1, pageSize = 100 } = params;

  return useQuery({
    queryKey: projectKeys.list(status, page, pageSize),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/projects", {
        params: {
          query: {
            page: String(page),
            pageSize: String(pageSize),
            ...(status === undefined ? {} : { status }),
          },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

async function fetchProject(id: string): Promise<ProjectDetail> {
  const { data, error, response } = await api.GET("/api/v1/projects/{id}", {
    params: { path: { id } },
  });
  if (data === undefined) fail(error, response.status, "Não foi possível ler o registro");
  return data;
}

/** `null` desliga a consulta: uma captura em `INBOX` não tem Project. */
export function useProject(id: string | null): UseQueryResult<ProjectDetail> {
  return useQuery({
    queryKey: projectKeys.detail(id ?? ""),
    enabled: id !== null,
    queryFn: () => fetchProject(id ?? ""),
  });
}

/**
 * As contagens por estado de vários Projects de uma vez.
 *
 * `GET /projects` devolve o Project sem as contagens, e só `GET /projects/{id}`
 * as traz. Enquanto a API não expuser as contagens na listagem, a tela pede uma
 * leitura por linha — a query é a mesma da tela de detalhe, então o cache é
 * reaproveitado e abrir um Project depois não custa outra ida ao servidor.
 * Pendência registrada no relatório da Fase 1.
 */
export function useProjectCounts(
  ids: readonly string[],
): ReadonlyMap<string, ProjectDetail["taskCounts"]> {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: projectKeys.detail(id),
      queryFn: () => fetchProject(id),
    })),
    combine: (results) => {
      const counts = new Map<string, ProjectDetail["taskCounts"]>();
      for (const result of results) {
        if (result.data !== undefined) counts.set(result.data.id, result.data.taskCounts);
      }
      return counts;
    },
  });
}

export function useProjectActivity(
  id: string,
  page = 1,
  pageSize = 20,
): UseQueryResult<ActivityPage> {
  return useQuery({
    queryKey: projectKeys.activity(id, page, pageSize),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/projects/{id}/activity", {
        params: { path: { id }, query: { page: String(page), pageSize: String(pageSize) } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o diário");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateProject): Promise<Project> => {
      const { data, error, response } = await api.POST("/api/v1/projects", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export interface UpdateProjectInput extends UpdateProject {
  readonly id: string;
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateProjectInput): Promise<Project> => {
      const { data, error, response } = await api.PATCH("/api/v1/projects/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

/**
 * Arquiva ou desarquiva. As duas rotas são idempotentes, então repetir o
 * pedido não grava um segundo fato no diário.
 */
export function useSetProjectArchived() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      archived,
    }: {
      id: string;
      archived: boolean;
    }): Promise<ProjectDetail> => {
      const path = archived ? "/api/v1/projects/{id}/archive" : "/api/v1/projects/{id}/unarchive";
      const { data, error, response } = await api.POST(path, { params: { path: { id } } });
      if (data === undefined) fail(error, response.status, "Não foi possível mudar o estado");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}
