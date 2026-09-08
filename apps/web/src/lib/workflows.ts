import type { ValidationIssue } from "@dungeon-master/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  WorkflowDefinitionBody,
  WorkflowPageRecord,
  WorkflowRecord,
  WorkflowVersionDetailRecord,
  WorkflowVersionPageRecord,
} from "@/lib/api-types";
import { ApiError, fail, problemIssues, problemMessage } from "@/lib/problem";

/**
 * Os Rituais: a definição vigente e as versões congeladas (Fase 4C).
 *
 * A API recebe e devolve a definição inteira, em JSON; YAML é conversa da
 * tela, e a conversão acontece antes de o corpo sair daqui. A invalidação é
 * ampla de propósito: editar um Workflow muda a lista, o detalhe e as escolhas
 * que a tela de Task oferece, e uma lista errada é pior que uma releitura.
 */

export const workflowKeys = {
  all: ["workflows"] as const,
  list: () => ["workflows", "list"] as const,
  detail: (id: string) => ["workflows", "detail", id] as const,
  versions: (id: string, page: number) => ["workflows", "versions", id, page] as const,
  version: (id: string) => ["workflows", "version", id] as const,
};

/** Cadastro pequeno: uma página cobre tudo o que um seletor precisa listar. */
const LIST_PAGE_SIZE = 100;

export function useWorkflows(): UseQueryResult<WorkflowPageRecord> {
  return useQuery({
    queryKey: workflowKeys.list(),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/workflows", {
        params: { query: { page: "1", pageSize: String(LIST_PAGE_SIZE) } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
  });
}

export function useWorkflow(id: string): UseQueryResult<WorkflowRecord> {
  return useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/workflows/{id}", {
        params: { path: { id } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o registro");
      return data;
    },
  });
}

export function useWorkflowVersions(
  id: string,
  page = 1,
  pageSize = 20,
): UseQueryResult<WorkflowVersionPageRecord> {
  return useQuery({
    queryKey: workflowKeys.versions(id, page),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/workflows/{id}/versions", {
        params: { path: { id }, query: { page: String(page), pageSize: String(pageSize) } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler as versões");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

/**
 * Uma versão congelada, com os steps materializados.
 *
 * Aceita `null` porque quem chama nem sempre tem uma versão: um Run simples
 * não aponta para nenhuma, e a query fica desligada em vez de pedir `/null`.
 */
export function useWorkflowVersion(id: string | null): UseQueryResult<WorkflowVersionDetailRecord> {
  return useQuery({
    queryKey: workflowKeys.version(id ?? ""),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/workflow-versions/{id}", {
        params: { path: { id: id ?? "" } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a versão");
      return data;
    },
    enabled: id !== null,
    // Imutável por contrato: relê-la nunca traz nada novo.
    staleTime: Infinity,
  });
}

/**
 * Uma definição recusada pela API, com os issues que apontam step e campo.
 *
 * `422` é a regra estrutural quebrada (ciclo, dependência inexistente, chave
 * repetida); `400` é a forma errada (campo faltando, tipo fora da lista). Os
 * dois trazem `errors[]`, e o editor mostra a lista em vez do `detail` só.
 */
export class DefinitionError extends ApiError {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, status: number, issues: readonly ValidationIssue[]) {
    super(message, status);
    this.name = "DefinitionError";
    this.issues = issues;
  }
}

function failDefinition(problem: unknown, status: number, fallback: string): never {
  const issues = problemIssues(problem);
  if (issues.length > 0) {
    throw new DefinitionError(problemMessage(problem, status, fallback), status, issues);
  }
  fail(problem, status, fallback);
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: WorkflowDefinitionBody): Promise<WorkflowRecord> => {
      const { data, error, response } = await api.POST("/api/v1/workflows", { body });
      if (data === undefined) failDefinition(error, response.status, "Não foi possível criar");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

export interface UpdateWorkflowInput {
  readonly id: string;
  readonly definition: WorkflowDefinitionBody;
}

/** Substitui a definição inteira. Versões já congeladas não mudam. */
export function useUpdateWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, definition }: UpdateWorkflowInput): Promise<WorkflowRecord> => {
      const { data, error, response } = await api.PUT("/api/v1/workflows/{id}", {
        params: { path: { id } },
        body: definition,
      });
      if (data === undefined) failDefinition(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: (workflow) => {
      queryClient.setQueryData(workflowKeys.detail(workflow.id), workflow);
      void queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

/**
 * Apaga um Workflow.
 *
 * A recusa por versão usada em Run chega como `409` com o motivo em `detail`,
 * e o diálogo distingue esse caso pelo `status` do erro.
 */
export function useDeleteWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error, response } = await api.DELETE("/api/v1/workflows/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) fail(error, response.status, "Não foi possível excluir");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workflowKeys.all });
      // Tasks que apontavam para ele voltam ao Run simples, do lado do servidor.
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
