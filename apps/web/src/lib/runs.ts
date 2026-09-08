import type { components } from "@dungeon-master/api-client";
import { API_BASE_PATH } from "@dungeon-master/api-client";
import type { HarnessKey, RunStatus } from "@dungeon-master/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { isLiveRunStatus } from "@/lib/execution-domain";
import { fail } from "@/lib/problem";

type Run = components["schemas"]["Run"];
type RunPage = components["schemas"]["RunPage"];
type CreateRun = components["schemas"]["CreateRun"];

/** O filtro da lista de Expedições, como a barra de filtros o produz. */
export interface RunListParams {
  readonly taskId?: string;
  readonly projectId?: string;
  readonly harnessKey?: HarnessKey;
  readonly status?: readonly RunStatus[];
  readonly page?: number;
  readonly pageSize?: number;
}

export const runKeys = {
  all: ["runs"] as const,
  list: (params: RunListParams) => ["runs", "list", params] as const,
  detail: (id: string) => ["runs", "detail", id] as const,
  events: (id: string) => ["runs", "events", id] as const,
};

function toQuery(params: RunListParams) {
  const { status, ...rest } = params;
  return {
    ...(rest.page === undefined ? {} : { page: String(rest.page) }),
    ...(rest.pageSize === undefined ? {} : { pageSize: String(rest.pageSize) }),
    ...(rest.taskId === undefined ? {} : { taskId: rest.taskId }),
    ...(rest.projectId === undefined ? {} : { projectId: rest.projectId }),
    ...(rest.harnessKey === undefined ? {} : { harnessKey: rest.harnessKey }),
    ...(status === undefined || status.length === 0 ? {} : { status: [...status] }),
  };
}

export function useRuns(params: RunListParams): UseQueryResult<RunPage> {
  return useQuery({
    queryKey: runKeys.list(params),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/runs", {
        params: { query: toQuery(params) },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

/**
 * Um Run, relido enquanto ele não for terminal.
 *
 * O stream de eventos conta o que aconteceu; o estado atual do Run — status,
 * versão da CLI, sessão capturada, caminho do workspace — é linha mutável e vem
 * por query, que é a divisão da seção 11 do documento técnico. Enquanto o Run
 * está de pé a query se repete sozinha, porque a transição para o estado
 * terminal é escrita pelo worker e não passa por esta aba.
 */
export function useRun(id: string): UseQueryResult<Run> {
  return useQuery({
    queryKey: runKeys.detail(id),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/runs/{id}", {
        params: { path: { id } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a execução");
      return data;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && isLiveRunStatus(status) ? 3_000 : false;
    },
  });
}

export interface CreateRunInput extends CreateRun {
  /** A Task que recebe a tentativa. Vai no caminho, não no corpo. */
  readonly taskId: string;
}

/**
 * Enfileira uma Expedição para a Task.
 *
 * A recusa vem como `409` com o motivo em `detail` — Task fora de `READY` ou
 * `FAILED`, Project sem workspace, dependência pendente, Harness ou perfil
 * desligado — e quem chama mostra esse texto.
 */
export function useCreateRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, ...body }: CreateRunInput): Promise<Run> => {
      const { data, error, response } = await api.POST("/api/v1/tasks/{id}/runs", {
        params: { path: { id: taskId } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível partir");
      return data;
    },
    onSuccess: (run) => {
      queryClient.setQueryData(runKeys.detail(run.id), run);
      void queryClient.invalidateQueries({ queryKey: runKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/**
 * Pede o cancelamento. Pedir não é cancelar.
 *
 * A resposta traz o Run com `cancelRequestedAt` marcado e o status ainda
 * `RUNNING`: quem transiciona para `CANCELLED` é quem confirmou que a árvore de
 * processos terminou. A exceção é o Run que ainda não subiu nada — em `CREATED`
 * e `QUEUED` a API transiciona na hora, porque não há árvore a confirmar.
 */
export function useCancelRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<Run> => {
      const { data, error, response } = await api.POST("/api/v1/runs/{id}/cancel", {
        params: { path: { id } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível pedir o cancelamento");
      return data;
    },
    onSuccess: (run) => {
      queryClient.setQueryData(runKeys.detail(run.id), run);
      void queryClient.invalidateQueries({ queryKey: runKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/** O caminho do stream SSE de um Run. A web abre com `EventSource`. */
export function runEventsStreamPath(runId: string, since: number): string {
  return `${API_BASE_PATH}/runs/${encodeURIComponent(runId)}/events/stream?since=${String(since)}`;
}

/** O caminho do replay paginado. Mesma consulta que o stream usa para o replay. */
export function runEventsPath(runId: string, after: number, limit: number): string {
  return `${API_BASE_PATH}/runs/${encodeURIComponent(runId)}/events?after=${String(after)}&limit=${String(limit)}`;
}

/**
 * O cancelamento foi pedido e ainda não virou estado terminal.
 *
 * É o intervalo em que a interface diz "retirada em andamento": o pedido está
 * gravado, o worker está matando a árvore, e ninguém pode afirmar que acabou.
 */
export function isCancelPending(run: Run): boolean {
  return run.cancelRequestedAt !== null && isLiveRunStatus(run.status);
}

/** Os estados terminais de onde faz sentido retomar. Um Run vitorioso não retoma. */
const RESUMABLE_STATUSES = new Set<RunStatus>(["FAILED", "TIMED_OUT", "CANCELLED"]);

/**
 * Dá para retomar a sessão do harness deste Run?
 *
 * As três condições são as mesmas que a API confere antes de aceitar
 * `resumeFromRunId`, e por isso a tela não oferece o que ela recusaria: o Run
 * terminou sem vitória, a sessão foi capturada, e o Harness declara `resume`.
 * As capabilities vêm do snapshot do Loadout, como em toda leitura do cockpit —
 * é o que valia quando esta execução aconteceu.
 */
export function canResumeRun(run: Run): boolean {
  return (
    RESUMABLE_STATUSES.has(run.status) &&
    run.harnessSessionId !== null &&
    run.loadoutSnapshot.harness.capabilities.resume
  );
}

/**
 * O prompt de continuação que o diálogo de retomada abre preenchido.
 *
 * Texto neutro de propósito: ele vai para o harness, e não para a tela. O
 * diagnóstico da tentativa anterior entra junto porque a sessão retomada não
 * garante que o agente lembre por que parou — o resume devolve o histórico da
 * CLI, não a conclusão de quem leu o erro.
 */
export function resumePrompt(run: Run): string {
  const diagnosis =
    run.error?.message ??
    run.result?.summary ??
    "a tentativa anterior foi encerrada antes de concluir o trabalho.";

  return `Continue de onde parou. Diagnóstico anterior: ${diagnosis}`;
}

/** Duração de um Run, em milissegundos, ou `null` quando ele nem começou. */
export function runDurationMs(run: Run, now: number = Date.now()): number | null {
  if (run.startedAt === null) return null;
  const started = new Date(run.startedAt).getTime();
  if (Number.isNaN(started)) return null;

  const finished = run.finishedAt === null ? now : new Date(run.finishedAt).getTime();
  return Math.max(0, (Number.isNaN(finished) ? now : finished) - started);
}

/** `mm:ss`, ou `h:mm:ss` quando passa de uma hora. É o relógio do cockpit. */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}
