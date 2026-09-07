import type { DiagnosticLevel, ExecutionEvent, HarnessKey } from "@dungeon-master/contracts";
import type { RunEventInput } from "@dungeon-master/database";

/**
 * A ponte entre o `ExecutionEvent` do runtime e a linha de `run_event`.
 *
 * O payload guardado é o **evento inteiro**, e não os campos dele menos o
 * `type`. A coluna `type` existe para filtrar e indexar; o payload existe para
 * que quem ler a linha consiga `ExecutionEventSchema.parse(payload)` e receber
 * a união discriminada de volta, sem precisar remontar o discriminante a
 * partir de outra coluna. A redundância de um campo curto paga isso.
 *
 * O `timestamp` vem do evento, e não do relógio da inserção: o instante em que
 * o fato aconteceu é diferente do instante em que ele foi gravado, e num Run
 * longo a diferença é visível na timeline.
 */
export function toRunEventInput(event: ExecutionEvent): RunEventInput {
  const timestamp = new Date(event.timestamp);
  return {
    type: event.type,
    // Um `timestamp` que a CLI escreveu errado não pode virar `Invalid Date`
    // numa coluna `not null`: nesse caso vale a hora da gravação.
    ...(Number.isNaN(timestamp.getTime()) ? {} : { timestamp }),
    payload: event,
  };
}

/**
 * Um `Diagnostic` produzido pelo Worker.
 *
 * `source: "RUNTIME"` porque, do ponto de vista de quem lê a timeline, o Worker
 * e o `AgentRuntime` são a mesma camada: a nossa. `HARNESS` é reservado ao que
 * a CLI disse, e misturar os dois faria o leitor culpar o agente por uma
 * decisão nossa.
 */
export function workerDiagnostic(input: {
  harness: HarnessKey;
  level: DiagnosticLevel;
  message: string;
  detail?: string;
  timestamp?: Date;
}): ExecutionEvent {
  return {
    type: "Diagnostic",
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    harness: input.harness,
    level: input.level,
    source: "RUNTIME",
    message: input.message,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  };
}

/** Um `RunFailed` sintético, para um Run que morreu sem o runtime ver. */
export function workerRunFailed(input: {
  harness: HarnessKey;
  message: string;
  code: string;
  retryable: boolean;
  durationMs?: number;
}): ExecutionEvent {
  return {
    type: "RunFailed",
    timestamp: new Date().toISOString(),
    harness: input.harness,
    error: { message: input.message, code: input.code },
    retryable: input.retryable,
    durationMs: Math.max(0, Math.trunc(input.durationMs ?? 0)),
  };
}
