import { describe, expect, it } from "vitest";

import {
  checkDelegationDepth,
  MAX_DELEGATION_DEPTH,
  settleDelegateStep,
  type ChildRunOutcomeView,
} from "./delegation.js";

const FILHO: ChildRunOutcomeView = {
  id: "01996d00-0000-7000-8000-0000000000c1",
  taskId: "01996d00-0000-7000-8000-0000000000a1",
  status: "SUCCEEDED",
  resultStatus: "completed",
  summary: "Revisado.",
  usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  error: null,
};

describe("checkDelegationDepth", () => {
  it("um Run da API (0) e o filho dele (1) ainda podem delegar; o neto (2) não", () => {
    expect(checkDelegationDepth(0)).toEqual({ ok: true, childDepth: 1 });
    expect(checkDelegationDepth(1)).toEqual({ ok: true, childDepth: 2 });
    const recusa = checkDelegationDepth(MAX_DELEGATION_DEPTH);
    expect(recusa).toMatchObject({
      ok: false,
      code: "DELEGATION_DEPTH_EXCEEDED",
      parentDepth: 2,
      maxDepth: 2,
    });
  });
});

describe("settleDelegateStep", () => {
  it("um filho vivo é espera", () => {
    expect(settleDelegateStep({ ...FILHO, status: "RUNNING" })).toEqual({ kind: "waiting" });
    expect(settleDelegateStep({ ...FILHO, status: "WAITING_CHILD" })).toEqual({ kind: "waiting" });
  });

  it("SUCCEEDED assenta o passo com o veredito, o resumo e o consumo do filho", () => {
    const settled = settleDelegateStep(FILHO);
    expect(settled.kind).toBe("succeeded");
    if (settled.kind !== "succeeded") return;
    expect(settled.result).toEqual({
      kind: "delegate",
      childRunId: FILHO.id,
      childTaskId: FILHO.taskId,
      status: "SUCCEEDED",
      resultStatus: "completed",
      summary: "Revisado.",
      usage: FILHO.usage,
    });
    expect(settled.summary).toBe("Revisado.");
  });

  it("FAILED e TIMED_OUT viram DELEGATION_FAILED com o erro do filho dentro", () => {
    const settled = settleDelegateStep({
      ...FILHO,
      status: "TIMED_OUT",
      resultStatus: null,
      summary: null,
      usage: null,
      error: { code: "TIMEOUT_IDLE", message: "ficou mudo" },
    });
    expect(settled.kind).toBe("failed");
    if (settled.kind !== "failed") return;
    expect(settled.error).toMatchObject({
      code: "DELEGATION_FAILED",
      childRunId: FILHO.id,
      childErrorCode: "TIMEOUT_IDLE",
      retryable: false,
    });
    expect(settled.error.message).toContain("ficou mudo");
    expect(settled.result).toEqual({
      kind: "delegate",
      childRunId: FILHO.id,
      childTaskId: FILHO.taskId,
      status: "TIMED_OUT",
    });
  });

  it("CANCELLED vira DELEGATION_CANCELLED: o passo não fica aberto por um Run que ninguém retoma", () => {
    const settled = settleDelegateStep({ ...FILHO, status: "CANCELLED", error: null });
    expect(settled.kind).toBe("failed");
    if (settled.kind !== "failed") return;
    expect(settled.error.code).toBe("DELEGATION_CANCELLED");
  });
});
