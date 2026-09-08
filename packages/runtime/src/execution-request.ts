/**
 * O pedido e o resultado de uma execução (documento técnico, seção 13).
 *
 * `ExecutionRequest` é a fronteira entre o worker e o runtime. Tudo que ele
 * carrega é dado congelado: snapshots, não entidades; caminhos, não handles de
 * banco. É o que permite reexecutar um Run antigo com exatamente o mesmo
 * pedido, e é o que mantém `packages/runtime` sem dependência de
 * `packages/database`.
 */

import type { UsageSummary } from "@dungeon-master/contracts";

import type { McpServerSpec } from "./mcp.js";
import type { StandardSchemaLike } from "./standard-schema.js";
import type {
  ExecutionProfileSnapshot,
  ExecutionStatus,
  ExecutionTimeouts,
  HarnessRef,
  LoadoutSnapshot,
  ModelRef,
  WorkspaceRef,
} from "./types.js";

/** Tag padrão do bloco de resultado estruturado. O formato é o do Sandcastle. */
export const DEFAULT_OUTPUT_TAG = "result";

/**
 * Pedido de resultado estruturado.
 *
 * `maxRetries` é 1 por padrão: uma correção pedindo só o bloco, e depois
 * `RunFailed`. Zero retries seria frágil demais para um bloco que o modelo
 * escreve à mão; dois já é gastar tokens em cima de um agente que não entendeu
 * o schema.
 */
export interface StructuredOutputSpec<T = unknown> {
  readonly schema: StandardSchemaLike<T>;
  /** Nome da tag XML. Padrão: `result`. */
  readonly tag?: string;
  /**
   * O mesmo schema em JSON Schema, para os harnesses com structured output
   * nativo (o `--json-schema` do Antigravity, documento técnico, seção 30).
   *
   * É opcional e **não** substitui `schema`: quem valida continua sendo o
   * Standard Schema, aqui, depois que o texto volta. Um schema nativo só muda
   * de quem é o trabalho de fazer o modelo acertar o formato na primeira vez.
   *
   * Fica a cargo de quem chama porque não há como derivar JSON Schema de um
   * Standard Schema qualquer: só o Zod 4 tem `z.toJSONSchema`, e o runtime não
   * conhece a implementação por trás da interface.
   */
  readonly jsonSchema?: unknown;
  /** Tentativas extras depois da primeira. Padrão: 1. */
  readonly maxRetries?: number;
  /**
   * Instrução acrescentada ao prompt. Quando ausente, o runtime monta a dele
   * com o nome da tag. Passar a sua serve para prompts em outro idioma ou com
   * um exemplo do schema.
   */
  readonly instruction?: string;
}

export interface ExecutionRequest<TOutput = unknown> {
  readonly runId: string;
  readonly taskId: string;
  readonly workspace: WorkspaceRef;
  readonly harness: HarnessRef;
  readonly model?: ModelRef;
  readonly loadout: LoadoutSnapshot;
  readonly executionProfile: ExecutionProfileSnapshot;
  readonly prompt: string;
  /** Quando presente, o runtime injeta a instrução e valida o bloco. */
  readonly outputSchema?: StructuredOutputSpec<TOutput>;
  /** Sobrescreve os padrões de {@link ExecutionTimeouts}. */
  readonly timeouts?: Partial<ExecutionTimeouts>;
  /**
   * Servidores MCP oferecidos ao agente neste Run: o do Grimório e os do
   * Loadout, já resolvidos pelo Worker. Um adapter sem `mcpServers` na matriz
   * os ignora com um `Diagnostic`; o Run segue sem as ferramentas.
   */
  readonly mcpServers?: readonly McpServerSpec[];
  /**
   * Retoma a sessão do harness. O adapter precisa ter `resume` na matriz de
   * capabilities; sem isso o pedido falha no início, e não no meio.
   */
  readonly resume?: { readonly harnessSessionId: string; readonly fork?: boolean };
  /**
   * Cancelamento por sinal, além de `AgentRuntime.cancel(runId)`. Os dois
   * caminhos terminam no mesmo kill de árvore com confirmação.
   */
  readonly signal?: AbortSignal;
}

/**
 * O resumo de uma execução terminada.
 *
 * O runtime é um `AsyncIterable<ExecutionEvent>`, então este objeto é uma
 * conveniência: `collectExecutionResult` o monta a partir do fluxo, para quem
 * só quer o desfecho.
 */
export interface ExecutionResult<TOutput = unknown> {
  readonly status: ExecutionStatus;
  readonly harness: HarnessRef;
  readonly harnessVersion: string;
  readonly harnessSessionId?: string;
  readonly usage?: UsageSummary;
  readonly output?: TOutput;
  readonly summary?: string;
  readonly error?: {
    readonly message: string;
    readonly code?: string;
    readonly retryable: boolean;
  };
  readonly durationMs: number;
  /** Caminho onde o agente rodou de fato. */
  readonly workspacePath?: string;
}
