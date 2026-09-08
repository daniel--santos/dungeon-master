import type { components } from "@dungeon-master/api-client";
import type { TaskKind, TaskPriority, TaskStatus } from "@dungeon-master/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { SortOrder, TaskSortField } from "@/lib/domain";
import { fail } from "@/lib/problem";

type Task = components["schemas"]["Task"];
type TaskPage = components["schemas"]["TaskPage"];
type TaskDetail = components["schemas"]["TaskDetail"];
type CreateTask = components["schemas"]["CreateTask"];
type UpdateTask = components["schemas"]["UpdateTask"];

/** O filtro da lista, exatamente como a barra de filtros o produz. */
export interface TaskListParams {
  readonly projectId?: string;
  readonly parentTaskId?: string;
  readonly kind?: TaskKind;
  readonly priority?: TaskPriority;
  readonly status?: readonly TaskStatus[];
  readonly q?: string;
  readonly sort?: TaskSortField;
  readonly order?: SortOrder;
  readonly page?: number;
  readonly pageSize?: number;
}

export const taskKeys = {
  all: ["tasks"] as const,
  list: (params: TaskListParams) => ["tasks", "list", params] as const,
  detail: (id: string) => ["tasks", "detail", id] as const,
};

/**
 * Monta a query da listagem.
 *
 * Campos ausentes não entram na URL: a API tem os próprios padrões, e mandar
 * `q=` vazio faria a busca filtrar por string vazia em vez de não filtrar.
 * `status` vai como array e o cliente o serializa repetindo o parâmetro, que é
 * a forma que a rota aceita.
 */
function toQuery(params: TaskListParams) {
  const { status, ...rest } = params;
  return {
    ...(rest.page === undefined ? {} : { page: String(rest.page) }),
    ...(rest.pageSize === undefined ? {} : { pageSize: String(rest.pageSize) }),
    ...(rest.projectId === undefined ? {} : { projectId: rest.projectId }),
    ...(rest.parentTaskId === undefined ? {} : { parentTaskId: rest.parentTaskId }),
    ...(rest.kind === undefined ? {} : { kind: rest.kind }),
    ...(rest.priority === undefined ? {} : { priority: rest.priority }),
    ...(rest.q === undefined || rest.q === "" ? {} : { q: rest.q }),
    ...(rest.sort === undefined ? {} : { sort: rest.sort }),
    ...(rest.order === undefined ? {} : { order: rest.order }),
    ...(status === undefined || status.length === 0 ? {} : { status: [...status] }),
  };
}

export function useTasks(params: TaskListParams): UseQueryResult<TaskPage> {
  return useQuery({
    queryKey: taskKeys.list(params),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/tasks", {
        params: { query: toQuery(params) },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
    // Trocar de página ou de ordenação não deve piscar a tabela inteira.
    placeholderData: (previous) => previous,
  });
}

/** `null` desliga a consulta: um item do Grimório sem Task de origem não tem o que ler. */
export function useTask(id: string | null): UseQueryResult<TaskDetail> {
  return useQuery({
    queryKey: taskKeys.detail(id ?? ""),
    enabled: id !== null,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/tasks/{id}", {
        params: { path: { id: id ?? "" } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o registro");
      return data;
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateTask): Promise<Task> => {
      const { data, error, response } = await api.POST("/api/v1/tasks", { body });
      if (data === undefined) fail(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export interface UpdateTaskInput extends UpdateTask {
  readonly id: string;
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateTaskInput): Promise<Task> => {
      const { data, error, response } = await api.PATCH("/api/v1/tasks/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/**
 * Move a Task na máquina de estados.
 *
 * A recusa vem como `409` com o motivo em `detail` — subtarefa pendente,
 * dependência não concluída, aresta que não existe — e quem chama mostra esse
 * texto num toast em vez de inventar uma explicação.
 */
export function useChangeTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, to }: { id: string; to: TaskStatus }): Promise<TaskDetail> => {
      const { data, error, response } = await api.POST("/api/v1/tasks/{id}/status", {
        params: { path: { id } },
        body: { to },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível mudar o estado");
      return data;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(taskKeys.detail(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

export interface DependencyInput {
  readonly id: string;
  readonly dependsOnId: string;
}

/** Declara que uma Task espera outra. Ciclo, direto ou indireto, vira `409`. */
export function useAddDependency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, dependsOnId }: DependencyInput): Promise<TaskDetail> => {
      const { data, error, response } = await api.PUT(
        "/api/v1/tasks/{id}/dependencies/{dependsOnId}",
        { params: { path: { id, dependsOnId } } },
      );
      if (data === undefined) fail(error, response.status, "Não foi possível ligar as duas");
      return data;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(taskKeys.detail(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useRemoveDependency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, dependsOnId }: DependencyInput): Promise<TaskDetail> => {
      const { data, error, response } = await api.DELETE(
        "/api/v1/tasks/{id}/dependencies/{dependsOnId}",
        { params: { path: { id, dependsOnId } } },
      );
      if (data === undefined) fail(error, response.status, "Não foi possível desfazer a ligação");
      return data;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(taskKeys.detail(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
