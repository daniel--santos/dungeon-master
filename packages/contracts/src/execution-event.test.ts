import { describe, expect, it } from "vitest";

import {
  EXECUTION_EVENT_TYPE_VALUES,
  ExecutionEventSchema,
  ExecutionEventTypeSchema,
  isTerminalExecutionEvent,
  isTerminalExecutionEventType,
  TERMINAL_EXECUTION_EVENT_TYPES,
  type ExecutionEvent,
} from "./execution-event.js";

const TIMESTAMP = "2026-09-07T12:00:00.000Z";

function base<T extends string>(type: T) {
  return { type, timestamp: TIMESTAMP, harness: "CLAUDE_CODE" as const };
}

describe("ExecutionEventSchema", () => {
  it("aceita um RunStarted completo", () => {
    const parsed = ExecutionEventSchema.parse({
      ...base("RunStarted"),
      harnessVersion: "2.1.263",
      model: "claude-sonnet-5",
      workspacePath: "/tmp/dm/run-1",
      executionMode: "HOST",
      enforcement: "HARNESS_NATIVE",
    });

    expect(parsed.type).toBe("RunStarted");
  });

  it("discrimina pelo campo `type` e recusa campo obrigatório ausente", () => {
    // `TextDelta` sem `text` cai na variante certa e falha lá, em vez de
    // escorregar para outra variante da união.
    const result = ExecutionEventSchema.safeParse({ ...base("TextDelta") });

    expect(result.success).toBe(false);
  });

  it("recusa um tipo fora da união", () => {
    expect(ExecutionEventSchema.safeParse({ ...base("RunPaused") }).success).toBe(false);
  });

  it("recusa um harness desconhecido", () => {
    const result = ExecutionEventSchema.safeParse({
      type: "TextDelta",
      timestamp: TIMESTAMP,
      harness: "GEMINI",
      text: "oi",
    });

    expect(result.success).toBe(false);
  });

  it("recusa timestamp que não é ISO 8601", () => {
    const result = ExecutionEventSchema.safeParse({
      type: "TextDelta",
      timestamp: "07/09/2026",
      harness: "PI",
      text: "oi",
    });

    expect(result.success).toBe(false);
  });

  it("aceita RunCompleted com resultado estruturado desconhecido", () => {
    const parsed = ExecutionEventSchema.parse({
      ...base("RunCompleted"),
      summary: "feito",
      output: { status: "completed", files: ["OLA.md"] },
      durationMs: 1234,
    });

    expect(parsed.type).toBe("RunCompleted");
    if (parsed.type === "RunCompleted") {
      expect(parsed.output).toEqual({ status: "completed", files: ["OLA.md"] });
    }
  });

  it("exige `retryable` no RunFailed", () => {
    const withoutRetryable = ExecutionEventSchema.safeParse({
      ...base("RunFailed"),
      error: { message: "cli ausente" },
      durationMs: 10,
    });

    expect(withoutRetryable.success).toBe(false);
  });

  it("exige `kind` do enum fechado no RunTimedOut", () => {
    expect(
      ExecutionEventSchema.safeParse({
        ...base("RunTimedOut"),
        kind: "network",
        elapsedMs: 1,
        limitMs: 2,
        processTreeTerminated: true,
      }).success,
    ).toBe(false);

    expect(
      ExecutionEventSchema.safeParse({
        ...base("RunTimedOut"),
        kind: "IDLE",
        elapsedMs: 1,
        limitMs: 2,
        processTreeTerminated: true,
      }).success,
    ).toBe(true);
  });

  it("exige a confirmação de término no RunCancelled", () => {
    expect(ExecutionEventSchema.safeParse({ ...base("RunCancelled"), elapsedMs: 5 }).success).toBe(
      false,
    );
  });
});

describe("enums de execução", () => {
  it("todo tipo da união aparece no enum fechado", () => {
    // Uma variante nova sem entrada no enum passaria despercebida; o teste é a
    // trava. `options` do `z.enum` é a lista literal declarada.
    expect([...ExecutionEventTypeSchema.options].sort()).toEqual(
      [...EXECUTION_EVENT_TYPE_VALUES].sort(),
    );
  });

  it("os quatro terminais são exatamente os terminais", () => {
    const terminais = EXECUTION_EVENT_TYPE_VALUES.filter(isTerminalExecutionEventType);

    expect([...terminais].sort()).toEqual([...TERMINAL_EXECUTION_EVENT_TYPES].sort());
    expect(terminais).toHaveLength(4);
  });

  it("`isTerminalExecutionEvent` estreita o evento", () => {
    const event: ExecutionEvent = {
      ...base("RunCancelled"),
      processTreeTerminated: true,
      elapsedMs: 42,
    };

    expect(isTerminalExecutionEvent(event)).toBe(true);
    expect(isTerminalExecutionEvent({ ...base("TextDelta"), text: "" })).toBe(false);
  });
});
