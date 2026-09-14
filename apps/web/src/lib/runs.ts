import type { components } from "@dungeon-master/api-client";
import { API_BASE_PATH } from "@dungeon-master/api-client";
import type {
  CapabilityIssue,
  HarnessKey,
  RunCreatedBy,
  RunStatus,
} from "@dungeon-master/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  BreakerAdmissionRecord,
  BudgetBreachRecord,
  PolicyDecisionRecord,
} from "@/lib/api-types";
import { isLiveRunStatus } from "@/lib/execution-domain";
import {
  ApiError,
  fail,
  problemBlockers,
  problemCode,
  problemExtension,
  problemMessage,
} from "@/lib/problem";

type Run = components["schemas"]["Run"];
type RunCreated = components["schemas"]["RunCreated"];
type RunPage = components["schemas"]["RunPage"];
type CreateRun = components["schemas"]["CreateRun"];

/** O filtro da lista de Expedições, como a barra de filtros o produz. */
export interface RunListParams {
  readonly taskId?: string;
  readonly projectId?: string;
  readonly harnessKey?: HarnessKey;
  readonly status?: readonly RunStatus[];
  /** Só os Runs com esta origem (Fase 9A): usuário, política ou delegação. */
  readonly createdBy?: RunCreatedBy;
  readonly page?: number;
  readonly pageSize?: number;
}

export const runKeys = {
  all: ["runs"] as const,
  list: (params: RunListParams) => ["runs", "list", params] as const,
  detail: (id: string) => ["runs", "detail", id] as const,
  events: (id: string) => ["runs", "events", id] as const,
  steps: (id: string) => ["runs", "steps", id] as const,
  gates: (id: string) => ["runs", "gates", id] as const,
  context: (id: string) => ["runs", "context", id] as const,
  children: (id: string) => ["runs", "children", id] as const,
};

function toQuery(params: RunListParams) {
  const { status, ...rest } = params;
  return {
    ...(rest.page === undefined ? {} : { page: String(rest.page) }),
    ...(rest.pageSize === undefined ? {} : { pageSize: String(rest.pageSize) }),
    ...(rest.taskId === undefined ? {} : { taskId: rest.taskId }),
    ...(rest.projectId === undefined ? {} : { projectId: rest.projectId }),
    ...(rest.harnessKey === undefined ? {} : { harnessKey: rest.harnessKey }),
    ...(rest.createdBy === undefined ? {} : { createdBy: rest.createdBy }),
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

/** Lê um Run. Exportado para quem precisa do registro sem o ciclo de releitura. */
export async function fetchRun(id: string): Promise<Run> {
  const { data, error, response } = await api.GET("/api/v1/runs/{id}", {
    params: { path: { id } },
  });
  if (data === undefined) fail(error, response.status, "Não foi possível ler a execução");
  return data;
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
    queryFn: () => fetchRun(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && isLiveRunStatus(status) ? 3_000 : false;
    },
  });
}

/**
 * Os filhos diretos de um Run (Fase 9B): as Expedições que um step
 * `delegate` abriu, do mais antigo ao mais novo. Relida a cada três segundos
 * enquanto a mãe está viva, porque um filho nasce e termina pelo Worker,
 * fora desta aba; o `delegation.*` do SSE também invalida (`lib/live.ts`).
 */
export function useRunChildren(id: string, live: boolean): UseQueryResult<readonly Run[]> {
  return useQuery({
    queryKey: runKeys.children(id),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/runs/{id}/children", {
        params: { path: { id } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler os filhos");
      return data.items;
    },
    refetchInterval: live ? 3_000 : false,
  });
}

export interface CreateRunInput extends CreateRun {
  /** A Task que recebe a tentativa. Vai no caminho, não no corpo. */
  readonly taskId: string;
}

/**
 * A partida recusada pelo capability matching (Fase 8A): o `409` que traz
 * `blockers[]` no problem details. Um erro próprio, com a lista, para o
 * diálogo mostrar cada bloqueio pelo código e pela mensagem canônica em vez
 * de um toast com o `detail` inteiro.
 */
export class RunBlockedError extends ApiError {
  readonly blockers: readonly CapabilityIssue[];

  constructor(message: string, blockers: readonly CapabilityIssue[]) {
    super(message, 409);
    this.name = "RunBlockedError";
    this.blockers = blockers;
  }
}

/**
 * As três recusas da autonomia controlada em `POST /runs` (Fase 9A), cada
 * uma com o objeto inteiro da decisão que o problem details traz como
 * extensão: o diálogo mostra o orçamento com consumo e teto, o disjuntor com
 * o motivo e quando reabre, ou a política que recusou — sem reler o `detail`.
 */
export class BudgetExceededError extends ApiError {
  readonly budget: BudgetBreachRecord;

  constructor(message: string, budget: BudgetBreachRecord) {
    super(message, 409);
    this.name = "BudgetExceededError";
    this.budget = budget;
  }
}

export class BreakerOpenError extends ApiError {
  readonly breaker: BreakerAdmissionRecord;

  constructor(message: string, breaker: BreakerAdmissionRecord) {
    super(message, 409);
    this.name = "BreakerOpenError";
    this.breaker = breaker;
  }
}

export class PolicyDeniedError extends ApiError {
  readonly policyDecision: PolicyDecisionRecord;

  constructor(message: string, policyDecision: PolicyDecisionRecord) {
    super(message, 409);
    this.name = "PolicyDeniedError";
    this.policyDecision = policyDecision;
  }
}

/**
 * Traduz o `409` de `POST /runs` num erro tipado, quando ele tem um `code`
 * conhecido; devolve `null` para deixar o caminho genérico seguir.
 */
function refusedRun(problem: unknown, message: string): ApiError | null {
  const blockers = problemBlockers(problem);
  if (blockers.length > 0) return new RunBlockedError(message, blockers);

  switch (problemCode(problem)) {
    case "BUDGET_EXCEEDED": {
      const budget = problemExtension<BudgetBreachRecord>(problem, "budget");
      return budget === null ? null : new BudgetExceededError(message, budget);
    }
    case "BREAKER_OPEN": {
      const breaker = problemExtension<BreakerAdmissionRecord>(problem, "breaker");
      return breaker === null ? null : new BreakerOpenError(message, breaker);
    }
    case "POLICY_DENIED": {
      const decision = problemExtension<PolicyDecisionRecord>(problem, "policyDecision");
      return decision === null ? null : new PolicyDeniedError(message, decision);
    }
    default:
      return null;
  }
}

/**
 * Enfileira uma Expedição para a Task.
 *
 * A recusa vem como `409` com o motivo em `detail` — Task fora de `READY` ou
 * `FAILED`, Project sem workspace, dependência pendente, Harness ou perfil
 * desligado — e quem chama mostra esse texto. Um `409` do capability
 * matching vira `RunBlockedError`, com os bloqueios; os da autonomia (Fase
 * 9A) viram `BudgetExceededError`, `BreakerOpenError` e `PolicyDeniedError`,
 * com a decisão inteira. A resposta boa é `RunCreated`: o Run, os avisos que
 * o Worker vai gravar no diário e as decisões automáticas da partida.
 */
export function useCreateRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, ...body }: CreateRunInput): Promise<RunCreated> => {
      const { data, error, response } = await api.POST("/api/v1/tasks/{id}/runs", {
        params: { path: { id: taskId } },
        body,
      });
      if (data === undefined) {
        const message = problemMessage(error, response.status, "Não foi possível partir");
        if (response.status === 409) {
          const refused = refusedRun(error, message);
          if (refused !== null) throw refused;
        }
        fail(error, response.status, "Não foi possível partir");
      }
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
