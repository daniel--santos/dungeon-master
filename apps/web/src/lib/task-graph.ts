import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";

import { api } from "@/lib/api";
import type { TaskDetailRecord, TaskGraphRecord } from "@/lib/api-types";
import { ApiError, fail, problemMessage } from "@/lib/problem";
import { taskKeys } from "@/lib/tasks";

/**
 * O grafo de Tasks de um Project e a troca do conjunto de dependências
 * (Fase 5B; documento técnico, seção 5.3).
 *
 * O grafo é lido inteiro, sem paginação: é o desenho do Project, e uma página
 * dele não teria sentido. A escrita é um `PUT` do conjunto completo de
 * dependências de uma Task: ligar dois nós é "as que ela já tinha, mais
 * esta"; desfazer uma aresta é "as que ela tinha, menos esta". Quem sabe se a
 * aresta fecha um ciclo é o servidor, e ele responde `409` com o caminho do
 * impasse em `path`, que aqui vira um erro próprio para a tela nomear as
 * Tasks do ciclo em vez de mostrar ids.
 */

export const taskGraphKeys = {
  all: ["task-graph"] as const,
  project: (projectId: string) => ["task-graph", projectId] as const,
};

export function useTaskGraph(projectId: string): UseQueryResult<TaskGraphRecord> {
  return useQuery({
    queryKey: taskGraphKeys.project(projectId),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/projects/{id}/task-graph", {
        params: { path: { id: projectId } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o grafo");
      return data;
    },
  });
}

/**
 * O `path` que vem no `409` de ciclo, validado na borda.
 *
 * O problem details é aberto (RFC 9457 permite membros de extensão), então o
 * cliente gerado não conhece o campo. Um `409` sem caminho legível vira o
 * erro comum, com o `detail`.
 */
const CyclePathSchema = z.array(z.string()).min(2);

export function readCyclePath(problem: unknown): readonly string[] | null {
  if (typeof problem !== "object" || problem === null) return null;
  const parsed = CyclePathSchema.safeParse((problem as { path?: unknown }).path);
  return parsed.success ? parsed.data : null;
}

/** A aresta fecharia um ciclo. `path` são os ids das Tasks do impasse, com o primeiro repetido no fim. */
export class DependencyCycleError extends ApiError {
  readonly path: readonly string[];

  constructor(message: string, path: readonly string[]) {
    super(message, 409);
    this.name = "DependencyCycleError";
    this.path = path;
  }
}

/**
 * O caminho do ciclo com títulos no lugar dos ids, para a mensagem da tela.
 *
 * Um id que a tela não conhece fica como está: é melhor um id no meio da
 * frase do que uma frase que esconde uma Task do ciclo.
 */
export function describeCyclePath(
  path: readonly string[],
  titles: ReadonlyMap<string, string>,
): string {
  return path.map((id) => titles.get(id) ?? id).join(" → ");
}

export interface ReplaceDependenciesInput {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

/**
 * Troca o conjunto inteiro de dependências de uma Task.
 *
 * Em sucesso o grafo do Project e a Task releem; o detalhe da Task recebe a
 * resposta na hora, porque ela já é o registro novo.
 */
export function useReplaceDependencies() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, dependsOn }: ReplaceDependenciesInput): Promise<TaskDetailRecord> => {
      const { data, error, response } = await api.PUT("/api/v1/tasks/{id}/dependencies", {
        params: { path: { id } },
        body: { dependsOn: [...dependsOn] },
      });
      if (data !== undefined) return data;

      if (response.status === 409) {
        const path = readCyclePath(error);
        if (path !== null) {
          throw new DependencyCycleError(
            problemMessage(error, response.status, "A ligação fecharia um ciclo"),
            path,
          );
        }
      }
      fail(error, response.status, "Não foi possível mudar as dependências");
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(taskKeys.detail(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: taskGraphKeys.all });
    },
  });
}
