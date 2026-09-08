import type {
  DistillationRunStatus,
  KnowledgeItemStatus,
  KnowledgeItemType,
  KnowledgeReviewFilter,
} from "@dungeon-master/contracts";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { z } from "zod";

import { api } from "@/lib/api";
import type {
  DecisionPageRecord,
  DistillationRequestedRecord,
  DistillationRunPageRecord,
  KnowledgeItemPageRecord,
  KnowledgeItemRecord,
  ProjectSummaryRecord,
  ReviewKnowledgeItemBody,
  UpdateKnowledgeItemBody,
} from "@/lib/api-types";
import { ApiError, fail, problemMessage } from "@/lib/problem";
import { knowledgeCandidateKeys } from "@/lib/proposals";

/**
 * O Grimório da Campanha (Fase 6B): itens, resumo, decisões e lotes.
 *
 * Quem escreve itens é o Distiller do Worker; a web lê, revisa, corrige e
 * arquiva. A revisão é um CAS no servidor, como o Selo e a proposta: quem
 * perde a corrida recebe `409` com o item como ele está, no membro `item` do
 * problem details, e nada é sobrescrito. Aqui esse caso vira um erro próprio,
 * com o item dentro, para a tela mostrar o que já foi decidido em vez de
 * tentar de novo.
 *
 * `POST /projects/{id}/distill` só **pede** um lote: a resposta é `202`, e o
 * lote acontece no Worker. A tela sabe que ele terminou pelo evento
 * `knowledge.distilled` do SSE, que invalida tudo daqui.
 */

export interface KnowledgeListParams {
  readonly type?: KnowledgeItemType;
  readonly status?: KnowledgeItemStatus;
  readonly review?: KnowledgeReviewFilter;
  readonly q?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface DistillationListParams {
  readonly projectId?: string;
  readonly status?: DistillationRunStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

export const knowledgeKeys = {
  all: ["knowledge"] as const,
  list: (projectId: string, params: KnowledgeListParams) =>
    ["knowledge", "list", projectId, params] as const,
  pending: (projectId: string) => ["knowledge", "pending", projectId] as const,
  item: (id: string) => ["knowledge", "item", id] as const,
  summary: (projectId: string) => ["knowledge", "summary", projectId] as const,
  decisions: (projectId: string, page: number, pageSize: number) =>
    ["knowledge", "decisions", projectId, page, pageSize] as const,
  batches: (params: DistillationListParams) => ["knowledge", "batches", params] as const,
};

/** Quantos itens uma página do Grimório lê de uma vez. */
export const KNOWLEDGE_PAGE_SIZE = 25;

/** A fila de revisão inteira, de uma vez: poucos itens esperam ao mesmo tempo. */
const PENDING_PAGE_SIZE = 50;

function toListQuery(params: KnowledgeListParams) {
  return {
    ...(params.page === undefined ? {} : { page: String(params.page) }),
    ...(params.pageSize === undefined ? {} : { pageSize: String(params.pageSize) }),
    ...(params.type === undefined ? {} : { type: params.type }),
    ...(params.status === undefined ? {} : { status: params.status }),
    ...(params.review === undefined ? {} : { review: params.review }),
    ...(params.q === undefined || params.q === "" ? {} : { q: params.q }),
  };
}

async function fetchKnowledge(
  projectId: string,
  params: KnowledgeListParams,
): Promise<KnowledgeItemPageRecord> {
  const { data, error, response } = await api.GET("/api/v1/projects/{id}/knowledge", {
    params: { path: { id: projectId }, query: toListQuery(params) },
  });
  if (data === undefined) fail(error, response.status, "Não foi possível ler o conhecimento");
  return data;
}

/** Uma página do Grimório de um Project, com os filtros da URL. */
export function useProjectKnowledge(
  projectId: string,
  params: KnowledgeListParams,
): UseQueryResult<KnowledgeItemPageRecord> {
  const merged = { pageSize: KNOWLEDGE_PAGE_SIZE, ...params };
  return useQuery({
    queryKey: knowledgeKeys.list(projectId, merged),
    queryFn: () => fetchKnowledge(projectId, merged),
    // Trocar de filtro não deve piscar a lista inteira enquanto a nova volta.
    placeholderData: (previous) => previous,
  });
}

/**
 * A fila de revisão de um Project: os itens `PENDING_REVIEW`, todos.
 *
 * Uma query separada da lista filtrada, com chave própria, porque a fila
 * aparece acima da lista independentemente do filtro aberto, e o contador da
 * navegação soma o `total` dela por Project.
 */
export function usePendingKnowledge(projectId: string): UseQueryResult<KnowledgeItemPageRecord> {
  return useQuery({
    queryKey: knowledgeKeys.pending(projectId),
    queryFn: () => fetchKnowledge(projectId, { review: "pending", pageSize: PENDING_PAGE_SIZE }),
  });
}

export interface PendingKnowledgeCounts {
  /** Itens aguardando revisão, somados sobre todos os Projects. */
  readonly total: number;
  /** Por Project, para a visão geral e o detalhe da Campanha. */
  readonly byProject: ReadonlyMap<string, number>;
  readonly isPending: boolean;
}

/**
 * Os itens aguardando revisão de vários Projects, para o contador da barra.
 *
 * `GET /projects/{id}/knowledge` é por Project e não existe uma rota que some
 * a fila de todos, então a web pede uma página de um item por Project e lê o
 * `total`. São poucas leituras num sistema de um usuário só, e a chave é a
 * mesma da fila de cada Project, então abrir o Grimório depois reaproveita o
 * cache. Pendência de API registrada no relatório da fase.
 */
export function usePendingKnowledgeCounts(projectIds: readonly string[]): PendingKnowledgeCounts {
  return useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: knowledgeKeys.pending(projectId),
      queryFn: () => fetchKnowledge(projectId, { review: "pending", pageSize: PENDING_PAGE_SIZE }),
    })),
    combine: (results) => {
      const byProject = new Map<string, number>();
      let total = 0;
      for (const [index, result] of results.entries()) {
        const projectId = projectIds[index];
        if (projectId === undefined || result.data === undefined) continue;
        byProject.set(projectId, result.data.total);
        total += result.data.total;
      }
      return { total, byProject, isPending: results.some((result) => result.isPending) };
    },
  });
}

async function fetchKnowledgeItem(id: string): Promise<KnowledgeItemRecord> {
  const { data, error, response } = await api.GET("/api/v1/knowledge-items/{id}", {
    params: { path: { id } },
  });
  if (data === undefined) fail(error, response.status, "Não foi possível ler o item");
  return data;
}

/** Um item com a proveniência. `null` desliga a consulta (gaveta fechada). */
export function useKnowledgeItem(id: string | null): UseQueryResult<KnowledgeItemRecord> {
  return useQuery({
    queryKey: knowledgeKeys.item(id ?? ""),
    enabled: id !== null,
    queryFn: () => fetchKnowledgeItem(id ?? ""),
  });
}

/**
 * Vários itens de uma vez, pelo id: os que um resumo cobriu.
 *
 * A chave é a mesma do detalhe, então abrir uma Página coberta depois não
 * custa outra ida ao servidor.
 */
export function useKnowledgeItems(
  ids: readonly string[],
): ReadonlyMap<string, KnowledgeItemRecord> {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: knowledgeKeys.item(id),
      queryFn: () => fetchKnowledgeItem(id),
    })),
    combine: (results) => {
      const items = new Map<string, KnowledgeItemRecord>();
      for (const result of results) {
        if (result.data !== undefined) items.set(result.data.id, result.data);
      }
      return items;
    },
  });
}

export function useProjectSummary(projectId: string): UseQueryResult<ProjectSummaryRecord> {
  return useQuery({
    queryKey: knowledgeKeys.summary(projectId),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/projects/{id}/summary", {
        params: { path: { id: projectId } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o resumo");
      return data;
    },
  });
}

/** Os resumos de vários Projects, para a visão geral do Grimório. */
export function useProjectSummaries(
  projectIds: readonly string[],
): ReadonlyMap<string, ProjectSummaryRecord> {
  return useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: knowledgeKeys.summary(projectId),
      queryFn: async () => {
        const { data, error, response } = await api.GET("/api/v1/projects/{id}/summary", {
          params: { path: { id: projectId } },
        });
        if (data === undefined) fail(error, response.status, "Não foi possível ler o resumo");
        return data;
      },
    })),
    combine: (results) => {
      const summaries = new Map<string, ProjectSummaryRecord>();
      for (const result of results) {
        if (result.data !== undefined) summaries.set(result.data.projectId, result.data);
      }
      return summaries;
    },
  });
}

export function useProjectDecisions(
  projectId: string,
  page = 1,
  pageSize = KNOWLEDGE_PAGE_SIZE,
): UseQueryResult<DecisionPageRecord> {
  return useQuery({
    queryKey: knowledgeKeys.decisions(projectId, page, pageSize),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/projects/{id}/decisions", {
        params: {
          path: { id: projectId },
          query: { page: String(page), pageSize: String(pageSize) },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler as decisões");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

export function useDistillationRuns(
  params: DistillationListParams,
): UseQueryResult<DistillationRunPageRecord> {
  return useQuery({
    queryKey: knowledgeKeys.batches(params),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/distillation-runs", {
        params: {
          query: {
            ...(params.page === undefined ? {} : { page: String(params.page) }),
            ...(params.pageSize === undefined ? {} : { pageSize: String(params.pageSize) }),
            ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
            ...(params.status === undefined ? {} : { status: params.status }),
          },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler os lotes");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

/* ---------------------------------------------------------------- escrita */

/** O `item` que vem no `409`, validado na borda. */
const ConflictItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: z.enum(["FACT", "DECISION", "DISCOVERY", "CONSTRAINT", "PROCEDURE", "SUMMARY"]),
  status: z.enum(["PENDING_REVIEW", "ACTIVE", "REJECTED", "ARCHIVED"]),
  title: z.string(),
  content: z.string(),
  provenance: z.object({
    candidateId: z.string().nullable(),
    runId: z.string().nullable(),
    taskId: z.string().nullable(),
    distillationRunId: z.string().nullable(),
    harnessSessionId: z.string().nullable(),
    usage: z
      .object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheReadInputTokens: z.number(),
        cacheCreationInputTokens: z.number(),
        costUsd: z.number().optional(),
      })
      .nullable(),
    mergedCandidateIds: z.array(z.string()),
    coveredItemIds: z.array(z.string()),
  }),
  version: z.number(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function readConflictItem(problem: unknown): KnowledgeItemRecord | null {
  if (typeof problem !== "object" || problem === null) return null;
  const parsed = ConflictItemSchema.safeParse((problem as { item?: unknown }).item);
  return parsed.success ? parsed.data : null;
}

/** O CAS perdeu: outra decisão chegou antes. `item` é o estado atual. */
export class KnowledgeConflictError extends ApiError {
  readonly item: KnowledgeItemRecord;

  constructor(message: string, item: KnowledgeItemRecord) {
    super(message, 409);
    this.name = "KnowledgeConflictError";
    this.item = item;
  }
}

function reviewFailure(error: unknown, status: number, fallback: string): never {
  if (status === 409) {
    const item = readConflictItem(error);
    if (item !== null) {
      throw new KnowledgeConflictError(
        problemMessage(error, status, "Outra decisão chegou antes"),
        item,
      );
    }
  }
  fail(error, status, fallback);
}

/**
 * Tudo que uma escrita no Grimório pode ter mudado: a lista e a fila, o item,
 * o resumo (o `promotedSinceSummary` muda ao aprovar), as decisões e os
 * candidatos do cockpit (que apontam para o item). No `409` a mesma
 * invalidação acontece: o que a tela mostrava está velho de qualquer jeito.
 */
function invalidateKnowledge(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
  void queryClient.invalidateQueries({ queryKey: knowledgeCandidateKeys.all });
}

export interface ReviewKnowledgeInput {
  readonly id: string;
  readonly note?: string;
}

function reviewBody(note: string | undefined): ReviewKnowledgeItemBody {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? {} : { note: trimmed };
}

export function useApproveKnowledgeItem() {
  const queryClient = useQueryClient();
  const refresh = () => {
    invalidateKnowledge(queryClient);
  };

  return useMutation({
    mutationFn: async ({ id, note }: ReviewKnowledgeInput): Promise<KnowledgeItemRecord> => {
      const { data, error, response } = await api.POST("/api/v1/knowledge-items/{id}/approve", {
        params: { path: { id } },
        body: reviewBody(note),
      });
      if (data !== undefined) return data;
      reviewFailure(error, response.status, "Não foi possível aprovar");
    },
    onSuccess: refresh,
    onError: (error: Error) => {
      if (error instanceof KnowledgeConflictError) refresh();
    },
  });
}

export function useRejectKnowledgeItem() {
  const queryClient = useQueryClient();
  const refresh = () => {
    invalidateKnowledge(queryClient);
  };

  return useMutation({
    mutationFn: async ({ id, note }: ReviewKnowledgeInput): Promise<KnowledgeItemRecord> => {
      const { data, error, response } = await api.POST("/api/v1/knowledge-items/{id}/reject", {
        params: { path: { id } },
        body: reviewBody(note),
      });
      if (data !== undefined) return data;
      reviewFailure(error, response.status, "Não foi possível recusar");
    },
    onSuccess: refresh,
    onError: (error: Error) => {
      if (error instanceof KnowledgeConflictError) refresh();
    },
  });
}

export interface UpdateKnowledgeInput extends UpdateKnowledgeItemBody {
  readonly id: string;
}

/**
 * Edita título, conteúdo e tipo, ou arquiva e desarquiva.
 *
 * A resposta é o item já com a versão nova, e vai direto para o cache do
 * detalhe: a gaveta aberta mostra o texto corrigido sem esperar a releitura.
 */
export function useUpdateKnowledgeItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateKnowledgeInput): Promise<KnowledgeItemRecord> => {
      const { data, error, response } = await api.PATCH("/api/v1/knowledge-items/{id}", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível salvar");
      return data;
    },
    onSuccess: (item) => {
      queryClient.setQueryData(knowledgeKeys.item(item.id), item);
      invalidateKnowledge(queryClient);
    },
  });
}

/**
 * Pede um lote ao Distiller. `202`: o pedido foi anotado, e o lote roda no
 * Worker. A resposta traz quantos candidatos esperavam no instante do pedido,
 * para o toast dizer se vai sair alguma coisa.
 */
export function useRequestDistillation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string): Promise<DistillationRequestedRecord> => {
      const { data, error, response } = await api.POST("/api/v1/projects/{id}/distill", {
        params: { path: { id: projectId } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível pedir o lote");
      return data;
    },
    onSuccess: () => {
      // O lote nasce `RUNNING` no Worker; a lista de lotes relê para mostrá-lo.
      void queryClient.invalidateQueries({ queryKey: [...knowledgeKeys.all, "batches"] });
    },
  });
}
