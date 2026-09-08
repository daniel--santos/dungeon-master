import type {
  ExecutionEvent,
  HarnessKey,
  TaskExecutionResult,
  UsageSummary,
} from "@dungeon-master/contracts";

import type { AgentStepRequest, StepAgentRuntime } from "../ports.js";

/**
 * O runtime de agente roteirizado, por chave de step.
 *
 * No espírito do fixture-runner do Archon (planejamento v0.4, Fase 4): cada
 * step tem uma fila de respostas, consumida uma por tentativa. O que o
 * runner observa é a mesma união de `ExecutionEvent` que o runtime real
 * produz — `RunStarted`, `SessionCaptured`, `Usage`, `Diagnostic` e um evento
 * terminal —, e é por isso que o mesmo teste prova a tradução do executor de
 * agente sem processo nenhum.
 *
 * `hang` espera o cancelamento e responde `RunCancelled`; `timeout` responde
 * `RunTimedOut` como o runtime faria ao estourar um relógio.
 */

export type ScriptedResponse =
  | {
      readonly kind: "completed";
      readonly output?: TaskExecutionResult | undefined;
      readonly summary?: string | undefined;
      readonly sessionId?: string | undefined;
      readonly usage?: UsageSummary | undefined;
      /** Diagnósticos emitidos antes do fim, por exemplo uma permissão negada. */
      readonly diagnostics?: ReadonlyArray<{ code?: string; message: string }> | undefined;
    }
  | { readonly kind: "failed"; readonly message: string; readonly code?: string | undefined }
  | { readonly kind: "timeout"; readonly elapsedMs?: number | undefined }
  | { readonly kind: "hang" }
  /** O runtime terminou sem evento terminal: o caminho defensivo. */
  | { readonly kind: "no-terminal" };

export interface ScriptedAgentRuntime extends StepAgentRuntime {
  /** Os pedidos recebidos, na ordem. */
  readonly requests: AgentStepRequest[];
  /** Quantas vezes cada step foi executado. */
  executionsOf(stepKey: string): number;
}

export function createScriptedAgentRuntime(input: {
  readonly scripts: Readonly<Record<string, readonly ScriptedResponse[]>>;
  readonly harnessKey?: HarnessKey | undefined;
  readonly now?: (() => number) | undefined;
}): ScriptedAgentRuntime {
  const harness = input.harnessKey ?? "CLAUDE_CODE";
  const now = input.now ?? (() => Date.now());
  const filas = new Map<string, ScriptedResponse[]>(
    Object.entries(input.scripts).map(([key, list]) => [key, [...list]]),
  );
  const requests: AgentStepRequest[] = [];
  const execucoes = new Map<string, number>();

  const stamp = <E extends { type: string }>(
    event: E,
  ): E & { timestamp: string; harness: HarnessKey } => ({
    ...event,
    timestamp: new Date(now()).toISOString(),
    harness,
  });

  return {
    requests,
    executionsOf: (stepKey) => execucoes.get(stepKey) ?? 0,

    async *execute(request): AsyncIterable<ExecutionEvent> {
      requests.push(request);
      execucoes.set(request.stepKey, (execucoes.get(request.stepKey) ?? 0) + 1);
      const startedAt = now();

      const fila = filas.get(request.stepKey);
      const response = fila?.shift();
      if (response === undefined) {
        yield stamp({
          type: "RunFailed" as const,
          error: { message: `Sem roteiro para o step ${request.stepKey}.`, code: "NO_SCRIPT" },
          retryable: false,
          durationMs: 0,
        });
        return;
      }

      yield stamp({
        type: "RunStarted" as const,
        harnessVersion: "0.0.0-scripted",
        workspacePath: "/scripted",
        executionMode: "HOST",
        enforcement: "ADVISORY",
      });

      switch (response.kind) {
        case "completed": {
          if (response.sessionId !== undefined) {
            yield stamp({ type: "SessionCaptured" as const, harnessSessionId: response.sessionId });
          }
          for (const diagnostic of response.diagnostics ?? []) {
            yield stamp({
              type: "Diagnostic" as const,
              level: "WARN" as const,
              source: "HARNESS" as const,
              ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
              message: diagnostic.message,
            });
          }
          if (response.usage !== undefined) {
            yield stamp({ type: "Usage" as const, usage: response.usage });
          }
          yield stamp({
            type: "RunCompleted" as const,
            summary: response.summary ?? response.output?.summary ?? "",
            ...(response.output === undefined ? {} : { output: response.output }),
            ...(response.usage === undefined ? {} : { usage: response.usage }),
            ...(response.sessionId === undefined ? {} : { harnessSessionId: response.sessionId }),
            durationMs: now() - startedAt,
          });
          return;
        }
        case "failed":
          yield stamp({
            type: "RunFailed" as const,
            error: {
              message: response.message,
              ...(response.code === undefined ? {} : { code: response.code }),
            },
            retryable: true,
            durationMs: now() - startedAt,
          });
          return;
        case "timeout":
          yield stamp({
            type: "RunTimedOut" as const,
            kind: "COMPLETION" as const,
            elapsedMs: response.elapsedMs ?? request.timeoutMs ?? 0,
            limitMs: request.timeoutMs ?? 0,
            processTreeTerminated: true,
          });
          return;
        case "hang": {
          await new Promise<void>((resolve) => {
            if (request.signal.aborted) {
              resolve();
              return;
            }
            request.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          yield stamp({
            type: "RunCancelled" as const,
            reason: "AbortSignal",
            processTreeTerminated: true,
            terminationMethod: "scripted",
            elapsedMs: now() - startedAt,
          });
          return;
        }
        case "no-terminal":
          return;
      }
    },
  };
}
