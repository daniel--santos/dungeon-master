import type { ApprovalDecision } from "@dungeon-master/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";

import { api } from "@/lib/api";
import type {
  ApprovalGateListRecord,
  ApprovalGatePageRecord,
  ApprovalGateRecord,
  RunStepListRecord,
} from "@/lib/api-types";
import { ApiError, fail, problemMessage } from "@/lib/problem";
import { runKeys } from "@/lib/runs";

/**
 * O Selo da Guilda: os gates de aprovação e os steps do Run (Fase 4C).
 *
 * A decisão é um CAS no servidor (documento técnico, seção 26): quem perde a
 * corrida recebe `409` com o gate como ele está, no membro `gate` do problem
 * details, e nada é sobrescrito. Aqui esse caso vira um erro próprio, com o
 * gate dentro, para a carta mostrar o que já foi decidido em vez de tentar de
 * novo.
 */

export const approvalKeys = {
  all: ["approval-gates"] as const,
  pending: () => ["approval-gates", "pending"] as const,
};

/** Quantos pendentes a caixa lê de uma vez. Poucos gates ficam abertos ao mesmo tempo. */
const PENDING_PAGE_SIZE = 50;

/**
 * Os gates `PENDING`, do pedido mais recente para o mais antigo.
 *
 * Uma query só serve a lista de Expedições e o contador da navegação: os dois
 * leem `total` do mesmo resultado, e o SSE invalida o prefixo inteiro.
 */
export function usePendingGates(): UseQueryResult<ApprovalGatePageRecord> {
  return useQuery({
    queryKey: approvalKeys.pending(),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/approval-gates", {
        params: { query: { status: "PENDING", page: "1", pageSize: String(PENDING_PAGE_SIZE) } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler as pendências");
      return data;
    },
  });
}

/**
 * Os steps de um Run, na ordem topológica da captura.
 *
 * Enquanto o Run está de pé a query se repete, como a do próprio Run: o motor
 * escreve o estado dos steps no banco, e esta aba só o lê. O diário ao vivo
 * também dispara uma releitura a cada evento de step, para a lista não ficar
 * até três segundos atrás do Diário.
 */
export function useRunSteps(runId: string, live: boolean): UseQueryResult<RunStepListRecord> {
  return useQuery({
    queryKey: runKeys.steps(runId),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/runs/{id}/steps", {
        params: { path: { id: runId } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler os steps");
      return data;
    },
    refetchInterval: live ? 3_000 : false,
  });
}

/** Os gates de um Run, do mais antigo ao mais novo, pendentes e decididos. */
export function useRunGates(runId: string, live: boolean): UseQueryResult<ApprovalGateListRecord> {
  return useQuery({
    queryKey: runKeys.gates(runId),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/runs/{id}/gates", {
        params: { path: { id: runId } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler os gates");
      return data;
    },
    refetchInterval: live ? 3_000 : false,
  });
}

/**
 * O `gate` que vem no `409`, validado na borda.
 *
 * O problem details é aberto (RFC 9457 permite membros de extensão), então o
 * cliente gerado não conhece o campo. A forma é conferida aqui: um `409` sem
 * gate legível vira o erro comum, com o `detail`, e não um estado inventado.
 */
const ConflictGateSchema = z.object({
  id: z.string(),
  runId: z.string(),
  runStepId: z.string(),
  gateKey: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(["PENDING", "GRANTED", "REJECTED"]),
  requestedAt: z.string(),
  resolvedAt: z.string().nullable(),
  note: z.string().nullable(),
});

export function readConflictGate(problem: unknown): ApprovalGateRecord | null {
  if (typeof problem !== "object" || problem === null) return null;
  const parsed = ConflictGateSchema.safeParse((problem as { gate?: unknown }).gate);
  return parsed.success ? parsed.data : null;
}

/** O CAS perdeu: outra decisão chegou antes. `gate` é o estado atual. */
export class GateConflictError extends ApiError {
  readonly gate: ApprovalGateRecord;

  constructor(message: string, gate: ApprovalGateRecord) {
    super(message, 409);
    this.name = "GateConflictError";
    this.gate = gate;
  }
}

export interface ResolveGateInput {
  readonly gateId: string;
  readonly decision: ApprovalDecision;
  readonly note?: string;
}

/**
 * Decide o gate.
 *
 * Em sucesso o Run volta a `QUEUED` e o step de aprovação assenta, tudo na
 * mesma transação do servidor; a invalidação aqui é o que faz o cockpit ler
 * o estado novo sem esperar o próximo ciclo de releitura. No `409` a mesma
 * invalidação acontece: o que a tela mostrava está velho de qualquer jeito.
 */
export function useResolveGate() {
  const queryClient = useQueryClient();

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: approvalKeys.all });
    void queryClient.invalidateQueries({ queryKey: runKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  return useMutation({
    mutationFn: async ({
      gateId,
      decision,
      note,
    }: ResolveGateInput): Promise<ApprovalGateRecord> => {
      const { data, error, response } = await api.POST("/api/v1/approval-gates/{id}/resolve", {
        params: { path: { id: gateId } },
        body: { decision, ...(note === undefined || note === "" ? {} : { note }) },
      });
      if (data !== undefined) return data;

      if (response.status === 409) {
        const gate = readConflictGate(error);
        if (gate !== null) {
          throw new GateConflictError(
            problemMessage(error, response.status, "Outra decisão chegou antes"),
            gate,
          );
        }
      }
      fail(error, response.status, "Não foi possível decidir");
    },
    onSuccess: refresh,
    onError: (error: Error) => {
      if (error instanceof GateConflictError) refresh();
    },
  });
}
