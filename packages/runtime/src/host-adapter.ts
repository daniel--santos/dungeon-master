/**
 * A base comum de todo adapter que roda uma CLI no host.
 *
 * Cada harness fala um NDJSON diferente, mas o resto é idêntico: subir o
 * processo sem shell, ler stdout linha a linha, guardar uma cauda limitada do
 * texto, traduzir sinais para `ExecutionEvent`, e matar a árvore quando
 * mandarem. Escrever isso três vezes garantiria três comportamentos
 * ligeiramente diferentes de cancelamento — que é justamente a garantia que o
 * projeto não pode deixar variar (documento técnico, seção 13).
 *
 * O que sobra para cada adapter é o que de fato difere: `buildCommand` (o argv)
 * e `parseLine` (o dialeto).
 */

import type { DiagnosticLevel, HarnessKey, UsageSummary } from "@dungeon-master/contracts";

import { BoundedTail } from "./bounded-tail.js";
import type { HarnessCapabilities } from "./capabilities.js";
import type {
  HarnessAdapter,
  HarnessCancelOptions,
  HarnessCancelResult,
  HarnessContext,
  HarnessEvent,
  HarnessExecutionRequest,
  HarnessFinishedEvent,
  HarnessStreamEvent,
  PreflightResult,
} from "./harness.js";
import { startProcess, type RunningProcess } from "./process.js";
import type { ExecutionMode } from "./types.js";

/** `Omit` que distribui sobre a união, em vez de reduzi-la aos campos comuns. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Um evento de stream sem os campos que a base carimba. */
type HarnessStreamEventDraft = DistributiveOmit<HarnessStreamEvent, "timestamp" | "harness">;

/** Quanto de argumento e de saída de ferramenta sobrevive num evento. */
export const TOOL_TEXT_LIMIT = 2_000;

/**
 * Um sinal do dialeto de um harness, já normalizado.
 *
 * É o vocabulário intermediário entre "esta linha de JSON" e `ExecutionEvent`.
 * Ele existe para que `parseLine` seja uma função pura e testável linha a
 * linha, sem precisar de relógio, de estado nem de `harness`.
 */
export type HarnessSignal =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "tool_call";
      readonly id?: string;
      readonly name: string;
      readonly args: string;
    }
  | {
      readonly kind: "tool_result";
      readonly id?: string;
      readonly name?: string;
      readonly ok: boolean;
      readonly output: string;
    }
  | { readonly kind: "usage"; readonly usage: UsageSummary }
  | { readonly kind: "session"; readonly id: string }
  /** O texto final do agente. Não é evento terminal: o processo ainda vai sair. */
  | { readonly kind: "result"; readonly text: string }
  | {
      readonly kind: "diagnostic";
      readonly level: DiagnosticLevel;
      readonly message: string;
      readonly detail?: string;
      /** Código estável, quando o diagnóstico é um fato acionável. */
      readonly code?: string;
    }
  | {
      readonly kind: "artifact";
      readonly path: string;
      readonly artifactKind?: string;
      readonly bytes?: number;
    }
  | {
      readonly kind: "approval";
      readonly approvalKey: string;
      readonly summary: string;
      readonly toolName?: string;
    }
  | { readonly kind: "error"; readonly message: string; readonly retryable?: boolean };

export interface HostCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** Escrito no stdin do processo. É por onde o prompt viaja. */
  readonly stdin?: string;
  /** Variáveis do adapter, somadas ao ambiente já montado por allow-list. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface HostAdapterDefinition {
  readonly id: string;
  readonly key: HarnessKey;
  /**
   * Modo declarado ao registry. Padrão: `HOST`.
   *
   * O backend de container reaproveita esta mesma base — o que muda entre os
   * dois modos é o spawn — e por isso precisa poder dizer `DOCKER` aqui.
   */
  readonly executionMode?: ExecutionMode;
  readonly capabilities: HarnessCapabilities;
  readonly environmentKeys?: readonly string[];
  buildCommand(request: HarnessExecutionRequest): HostCommand | Promise<HostCommand>;
  /** Traduz uma linha de stdout. Linha que não interessa devolve lista vazia. */
  parseLine(line: string): readonly HarnessSignal[];
  preflight(context: HarnessContext): Promise<PreflightResult>;
  /**
   * Interpreta uma saída diferente de zero. Devolver `undefined` deixa o
   * runtime usar a regra genérica.
   */
  describeExit?(
    exitCode: number | null,
    stderrTail: string,
  ): { readonly message: string; readonly retryable: boolean } | undefined;
  /** Teto da cauda de texto guardada. Padrão: o da `BoundedTail`. */
  readonly maxTailChars?: number;
  /**
   * Como encerrar a execução. Padrão: kill da árvore de processos pelo PID.
   *
   * O backend `DOCKER` troca isto por `docker rm -f` com confirmação: matar o
   * cliente `docker run` no host não encosta no container, porque o processo do
   * agente é filho do daemon e não do worker. É a mesma promessa da seção 13 do
   * documento técnico — o desaparecimento é confirmado, nunca presumido — só
   * que o "processo" a confirmar é outro.
   */
  terminate?(input: {
    readonly executionId: string;
    readonly process: RunningProcess;
    readonly graceMs?: number;
    readonly confirmMs?: number;
  }): Promise<HarnessCancelResult>;
}

/**
 * Monta um `HarnessAdapter` a partir da definição.
 *
 * Um adapter pode ter mais de uma execução viva ao mesmo tempo (dois Runs
 * concorrentes no mesmo harness), então os processos ficam num mapa por
 * `executionId`, e não numa variável só.
 */
export function createHostAdapter(definition: HostAdapterDefinition): HarnessAdapter {
  const running = new Map<string, RunningProcess>();

  async function* execute(request: HarnessExecutionRequest): AsyncIterable<HarnessEvent> {
    const assistantText = new BoundedTail(definition.maxTailChars, "");
    const stderrTail = new BoundedTail(definition.maxTailChars, "");
    let sessionId: string | undefined;
    let usage: UsageSummary | undefined;
    let finalText: string | undefined;
    let adapterError: { message: string; retryable: boolean } | undefined;
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;

    const stamp = (event: HarnessStreamEventDraft): HarnessStreamEvent =>
      // O cast é necessário porque o TypeScript não consegue provar que a
      // reconstrução do objeto recai na mesma variante da união de onde o
      // rascunho veio; `HarnessStreamEventDraft` já garante isso na entrada.
      ({
        ...event,
        timestamp: new Date().toISOString(),
        harness: definition.key,
      }) as HarnessStreamEvent;

    let command: HostCommand;
    try {
      command = await definition.buildCommand(request);
    } catch (error) {
      yield finished({
        harness: definition.key,
        exitCode: null,
        signal: null,
        assistantText: "",
        stderrTail: "",
        error: { message: describe(error), retryable: false },
      });
      return;
    }

    let child: RunningProcess;
    try {
      child = startProcess(command.command, command.args, {
        cwd: request.cwd,
        env: { ...request.env, ...(command.env ?? {}) },
        ...(command.stdin === undefined ? {} : { stdin: command.stdin }),
      });
    } catch (error) {
      yield finished({
        harness: definition.key,
        exitCode: null,
        signal: null,
        assistantText: "",
        stderrTail: "",
        // Um executável que não sobe não sobe de novo: é ausência de CLI ou
        // caminho errado, e as duas coisas pedem ação humana.
        error: { message: describe(error), retryable: false },
      });
      return;
    }

    running.set(request.executionId, child);

    try {
      for await (const event of child.events) {
        if (event.kind === "stderr") {
          stderrTail.push(event.text);
          continue;
        }
        if (event.kind === "error") {
          adapterError = { message: event.error.message, retryable: false };
          continue;
        }
        if (event.kind === "exit") {
          exitCode = event.code;
          signal = event.signal;
          continue;
        }

        let signals: readonly HarnessSignal[];
        try {
          signals = definition.parseLine(event.line);
        } catch (error) {
          // Uma linha que o parser não entende nunca derruba o Run: ela vira
          // diagnóstico e o stream continua. Uma CLI que muda o formato no meio
          // de uma versão menor é um risco conhecido do projeto.
          yield stamp({
            type: "Diagnostic",
            level: "WARN",
            source: "RUNTIME",
            message: `Não consegui interpretar uma linha de ${definition.id}: ${describe(error)}`,
            detail: truncate(event.line, TOOL_TEXT_LIMIT),
          });
          continue;
        }

        for (const parsed of signals) {
          switch (parsed.kind) {
            case "text":
              assistantText.push(parsed.text);
              yield stamp({ type: "TextDelta", text: parsed.text });
              break;
            case "result":
              // O texto final costuma repetir o que já veio em deltas; ele
              // entra na cauda mesmo assim porque em alguns harnesses (Codex) é
              // a **única** aparição do bloco `<result>`.
              assistantText.push(parsed.text);
              finalText = parsed.text;
              break;
            case "tool_call":
              yield stamp({
                type: "ToolCall",
                ...(parsed.id === undefined ? {} : { toolCallId: parsed.id }),
                name: parsed.name,
                arguments: truncate(parsed.args, TOOL_TEXT_LIMIT),
              });
              break;
            case "tool_result":
              yield stamp({
                type: "ToolResult",
                ...(parsed.id === undefined ? {} : { toolCallId: parsed.id }),
                ...(parsed.name === undefined ? {} : { name: parsed.name }),
                ok: parsed.ok,
                output: truncate(parsed.output, TOOL_TEXT_LIMIT),
              });
              break;
            case "usage":
              usage = parsed.usage;
              yield stamp({ type: "Usage", usage: parsed.usage });
              break;
            case "session":
              if (sessionId !== parsed.id) {
                sessionId = parsed.id;
                yield stamp({ type: "SessionCaptured", harnessSessionId: parsed.id });
              }
              break;
            case "diagnostic":
              yield stamp({
                type: "Diagnostic",
                level: parsed.level,
                source: "HARNESS",
                ...(parsed.code === undefined ? {} : { code: parsed.code }),
                message: parsed.message,
                ...(parsed.detail === undefined ? {} : { detail: parsed.detail }),
              });
              break;
            case "artifact":
              yield stamp({
                type: "Artifact",
                path: parsed.path,
                ...(parsed.artifactKind === undefined ? {} : { kind: parsed.artifactKind }),
                ...(parsed.bytes === undefined ? {} : { bytes: parsed.bytes }),
              });
              break;
            case "approval":
              yield stamp({
                type: "ApprovalRequested",
                approvalKey: parsed.approvalKey,
                summary: parsed.summary,
                ...(parsed.toolName === undefined ? {} : { toolName: parsed.toolName }),
              });
              break;
            case "error":
              adapterError = {
                message: parsed.message,
                retryable: parsed.retryable ?? true,
              };
              break;
          }
        }
      }
    } finally {
      running.delete(request.executionId);
    }

    const described =
      adapterError ??
      (exitCode !== 0 && exitCode !== null
        ? definition.describeExit?.(exitCode, stderrTail.toString())
        : undefined);

    yield finished({
      harness: definition.key,
      exitCode,
      signal,
      assistantText: assistantText.toString(),
      stderrTail: stderrTail.toString(),
      ...(finalText === undefined ? {} : { finalText }),
      ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
      ...(usage === undefined ? {} : { usage }),
      ...(described === undefined ? {} : { error: described }),
    });
  }

  return {
    id: definition.id,
    key: definition.key,
    executionMode: definition.executionMode ?? "HOST",
    capabilities: definition.capabilities,
    ...(definition.environmentKeys === undefined
      ? {}
      : { environmentKeys: definition.environmentKeys }),
    preflight: (context) => definition.preflight(context),
    execute,
    // post-mortem #11 (08/09/2026): `cancel` não tinha parâmetro de tempo e
    // `child.terminate()` era chamado sem argumento, então `killGraceMs` e
    // `killConfirmMs` do `ExecutionTimeouts` eram validados, viajavam até o
    // kill e morriam ali: valia sempre o padrão do `packages/platform`, e o
    // `Diagnostic` do timeout anunciava ao usuário um número que nenhuma
    // chamada tinha usado. Não simplifique isto de volta para `terminate()`.
    cancel: async (
      executionId: string,
      options?: HarnessCancelOptions,
    ): Promise<HarnessCancelResult> => {
      const child = running.get(executionId);
      if (child === undefined) {
        return { terminated: true, elapsedMs: 0, notRunning: true };
      }
      if (definition.terminate !== undefined) {
        return definition.terminate({ executionId, process: child, ...options });
      }
      const result = await child.terminate(options);
      return { terminated: result.terminated, method: result.method, elapsedMs: result.elapsedMs };
    },
  };
}

function finished(event: Omit<HarnessFinishedEvent, "type" | "timestamp">): HarnessEvent {
  return { type: "HarnessFinished", timestamp: new Date().toISOString(), ...event };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
