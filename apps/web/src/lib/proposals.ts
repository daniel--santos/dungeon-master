import type { KnowledgeCandidateStatus, ProposedTaskStatus } from "@dungeon-master/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";

import { api } from "@/lib/api";
import type {
  ApproveProposedTaskBody,
  KnowledgeCandidatePageRecord,
  ProposedTaskPageRecord,
  ProposedTaskRecord,
} from "@/lib/api-types";
import { ApiError, fail, problemMessage } from "@/lib/problem";
import { projectKeys } from "@/lib/projects";
import { DependencyCycleError, readCyclePath, taskGraphKeys } from "@/lib/task-graph";
import { taskKeys } from "@/lib/tasks";

/**
 * As propostas de trabalho e os candidatos a conhecimento (Fase 5B).
 *
 * Uma proposta nasce do resultado de uma Expedição e espera uma decisão
 * humana. A decisão é um CAS no servidor, como o do Selo: quem perde a corrida
 * recebe `409` com a proposta como ela está, no membro `proposedTask` do
 * problem details, e nada é sobrescrito. Aqui esse caso vira um erro próprio,
 * com a proposta dentro, para a tela mostrar o que já foi decidido em vez de
 * tentar de novo. Um `409` de ciclo, na aprovação com dependências, vira o
 * mesmo `DependencyCycleError` do grafo.
 */

export interface ProposalListParams {
  readonly status?: ProposedTaskStatus;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export const proposalKeys = {
  all: ["proposed-tasks"] as const,
  list: (params: ProposalListParams) => ["proposed-tasks", "list", params] as const,
  openCount: () => ["proposed-tasks", "open-count"] as const,
};

/** Quantas uma caixa lê de uma vez. Poucas propostas ficam abertas ao mesmo tempo. */
const LIST_PAGE_SIZE = 50;

function toQuery(params: ProposalListParams) {
  return {
    ...(params.page === undefined ? {} : { page: String(params.page) }),
    ...(params.pageSize === undefined ? {} : { pageSize: String(params.pageSize) }),
    ...(params.status === undefined ? {} : { status: params.status }),
    ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
    ...(params.taskId === undefined ? {} : { taskId: params.taskId }),
  };
}

async function fetchProposals(params: ProposalListParams): Promise<ProposedTaskPageRecord> {
  const { data, error, response } = await api.GET("/api/v1/proposed-tasks", {
    params: { query: toQuery(params) },
  });
  if (data === undefined) fail(error, response.status, "Não foi possível ler as propostas");
  return data;
}

/** As propostas que casam com o filtro, da mais recente para a mais antiga. */
export function useProposedTasks(
  params: ProposalListParams,
): UseQueryResult<ProposedTaskPageRecord> {
  const merged = { pageSize: LIST_PAGE_SIZE, ...params };
  return useQuery({
    queryKey: proposalKeys.list(merged),
    queryFn: () => fetchProposals(merged),
  });
}

/**
 * Só o total de abertas, para o contador da navegação.
 *
 * Uma página de um item basta: o `total` é do servidor, e o SSE invalida o
 * prefixo inteiro a cada proposta gravada ou decidida.
 */
export function useOpenProposalCount(): UseQueryResult<number> {
  return useQuery({
    queryKey: proposalKeys.openCount(),
    queryFn: async () => (await fetchProposals({ status: "PROPOSED", pageSize: 1 })).total,
  });
}

/** O `proposedTask` que vem no `409`, validado na borda. */
const ConflictProposalSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  originTaskId: z.string(),
  originRunId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  rationale: z.string().nullable(),
  status: z.enum(["PROPOSED", "APPROVED", "REJECTED"]),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdTaskId: z.string().nullable(),
  createdAt: z.string(),
});

export function readConflictProposal(problem: unknown): ProposedTaskRecord | null {
  if (typeof problem !== "object" || problem === null) return null;
  const parsed = ConflictProposalSchema.safeParse(
    (problem as { proposedTask?: unknown }).proposedTask,
  );
  return parsed.success ? parsed.data : null;
}

/** O CAS perdeu: outra decisão chegou antes. `proposedTask` é o estado atual. */
export class ProposalConflictError extends ApiError {
  readonly proposedTask: ProposedTaskRecord;

  constructor(message: string, proposedTask: ProposedTaskRecord) {
    super(message, 409);
    this.name = "ProposalConflictError";
    this.proposedTask = proposedTask;
  }
}

/** Traduz um `409` de decisão: proposta já decidida, ou ciclo de dependências. */
function decisionFailure(error: unknown, status: number, fallback: string): never {
  if (status === 409) {
    const proposedTask = readConflictProposal(error);
    if (proposedTask !== null) {
      throw new ProposalConflictError(
        problemMessage(error, status, "Outra decisão chegou antes"),
        proposedTask,
      );
    }
    const path = readCyclePath(error);
    if (path !== null) {
      throw new DependencyCycleError(
        problemMessage(error, status, "As dependências fechariam um ciclo"),
        path,
      );
    }
  }
  fail(error, status, fallback);
}

export interface ApproveProposalInput {
  readonly id: string;
  readonly body: ApproveProposedTaskBody;
}

export interface RejectProposalInput {
  readonly id: string;
  readonly note?: string;
}

/**
 * Aprova: cria a Task no Project, com mãe e dependências escolhidas aqui.
 *
 * A invalidação é ampla porque a aprovação muda várias telas de uma vez: a
 * lista de propostas e o contador, a Task de origem e a lista de Tasks, o
 * Project (contagens) e o grafo. No `409` a mesma invalidação acontece: o
 * que a tela mostrava está velho de qualquer jeito.
 */
export function useApproveProposedTask() {
  const queryClient = useQueryClient();
  const refresh = () => {
    invalidateAfterDecision(queryClient);
  };

  return useMutation({
    mutationFn: async ({ id, body }: ApproveProposalInput): Promise<ProposedTaskRecord> => {
      const { data, error, response } = await api.POST("/api/v1/proposed-tasks/{id}/approve", {
        params: { path: { id } },
        body,
      });
      if (data !== undefined) return data;
      decisionFailure(error, response.status, "Não foi possível aprovar");
    },
    onSuccess: refresh,
    onError: (error: Error) => {
      if (error instanceof ProposalConflictError) refresh();
    },
  });
}

export function useRejectProposedTask() {
  const queryClient = useQueryClient();
  const refresh = () => {
    invalidateAfterDecision(queryClient);
  };

  return useMutation({
    mutationFn: async ({ id, note }: RejectProposalInput): Promise<ProposedTaskRecord> => {
      const { data, error, response } = await api.POST("/api/v1/proposed-tasks/{id}/reject", {
        params: { path: { id } },
        body: note === undefined || note === "" ? {} : { note },
      });
      if (data !== undefined) return data;
      decisionFailure(error, response.status, "Não foi possível recusar");
    },
    onSuccess: refresh,
    onError: (error: Error) => {
      if (error instanceof ProposalConflictError) refresh();
    },
  });
}

function invalidateAfterDecision(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: proposalKeys.all });
  void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  void queryClient.invalidateQueries({ queryKey: projectKeys.all });
  void queryClient.invalidateQueries({ queryKey: taskGraphKeys.all });
}

export interface KnowledgeCandidateListParams {
  readonly projectId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly status?: KnowledgeCandidateStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

export const knowledgeCandidateKeys = {
  all: ["knowledge-candidates"] as const,
  list: (params: KnowledgeCandidateListParams) => ["knowledge-candidates", "list", params] as const,
};

/**
 * Os candidatos a conhecimento, só leitura (a tela é da Fase 6).
 *
 * O cockpit usa o filtro por Run para dizer quantos a Expedição trouxe.
 */
export function useKnowledgeCandidates(
  params: KnowledgeCandidateListParams,
): UseQueryResult<KnowledgeCandidatePageRecord> {
  return useQuery({
    queryKey: knowledgeCandidateKeys.list(params),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/knowledge-candidates", {
        params: {
          query: {
            ...(params.page === undefined ? {} : { page: String(params.page) }),
            ...(params.pageSize === undefined ? {} : { pageSize: String(params.pageSize) }),
            ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
            ...(params.taskId === undefined ? {} : { taskId: params.taskId }),
            ...(params.runId === undefined ? {} : { runId: params.runId }),
            ...(params.status === undefined ? {} : { status: params.status }),
          },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler os candidatos");
      return data;
    },
  });
}
