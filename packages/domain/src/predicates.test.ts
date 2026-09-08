import type { Predicate } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  evaluatePredicate,
  evaluatePredicates,
  type PredicateContext,
  type PredicateStepView,
  skipReasonFor,
} from "./predicates.js";

function contexto(
  steps: Record<string, PredicateStepView>,
  artifactExists?: (path: string) => boolean,
): PredicateContext {
  return { steps: new Map(Object.entries(steps)), artifactExists };
}

const SUCEDIDO: PredicateStepView = {
  status: "SUCCEEDED",
  result: { kind: "agent", status: "completed", summary: "feito" },
};

describe("evaluatePredicate", () => {
  it("stepSucceeded olha o status do step", () => {
    const ctx = contexto({ aa: SUCEDIDO, bb: { status: "FAILED", result: null } });
    expect(evaluatePredicate({ kind: "stepSucceeded", step: "aa" }, ctx)).toEqual({ ok: true });
    expect(evaluatePredicate({ kind: "stepSucceeded", step: "bb" }, ctx)).toMatchObject({
      ok: false,
      detail: expect.stringContaining("FAILED"),
    });
  });

  it("stepFailed vale para FAILED e TIMED_OUT, não para SKIPPED", () => {
    const ctx = contexto({
      ff: { status: "FAILED", result: null },
      tt: { status: "TIMED_OUT", result: null },
      ss: { status: "SKIPPED", result: null },
    });
    expect(evaluatePredicate({ kind: "stepFailed", step: "ff" }, ctx).ok).toBe(true);
    expect(evaluatePredicate({ kind: "stepFailed", step: "tt" }, ctx).ok).toBe(true);
    expect(evaluatePredicate({ kind: "stepFailed", step: "ss" }, ctx).ok).toBe(false);
  });

  it("outputStatusIs lê o veredito do agente e recusa resultado de outro tipo", () => {
    const ctx = contexto({
      aa: SUCEDIDO,
      cc: { status: "SUCCEEDED", result: { kind: "command", exitCode: 0, durationMs: 1 } },
      nn: { status: "SUCCEEDED", result: null },
    });
    expect(
      evaluatePredicate({ kind: "outputStatusIs", step: "aa", status: "completed" }, ctx).ok,
    ).toBe(true);
    expect(
      evaluatePredicate({ kind: "outputStatusIs", step: "aa", status: "blocked" }, ctx),
    ).toMatchObject({ ok: false, detail: expect.stringContaining("completed") });
    expect(
      evaluatePredicate({ kind: "outputStatusIs", step: "cc", status: "completed" }, ctx),
    ).toMatchObject({ ok: false, detail: expect.stringContaining("command") });
    expect(
      evaluatePredicate({ kind: "outputStatusIs", step: "nn", status: "completed" }, ctx),
    ).toMatchObject({ ok: false, detail: expect.stringContaining("não tem resultado") });
  });

  it("validationPassed lê o veredito, e um step SUCCEEDED com veredito failed é falso", () => {
    const ctx = contexto({
      ok: {
        status: "SUCCEEDED",
        result: { kind: "validation", verdict: "passed", exitCode: 0, durationMs: 1 },
      },
      nok: {
        status: "SUCCEEDED",
        result: { kind: "validation", verdict: "failed", exitCode: 1, durationMs: 1 },
      },
    });
    expect(evaluatePredicate({ kind: "validationPassed", step: "ok" }, ctx).ok).toBe(true);
    expect(evaluatePredicate({ kind: "validationPassed", step: "nok" }, ctx)).toMatchObject({
      ok: false,
      detail: expect.stringContaining("failed"),
    });
  });

  it("artifactExists usa a função injetada e é falso sem ela", () => {
    const sem = contexto({});
    expect(evaluatePredicate({ kind: "artifactExists", path: "docs/plan.md" }, sem)).toMatchObject({
      ok: false,
      detail: expect.stringContaining("Não há como conferir"),
    });

    const com = contexto({}, (path) => path === "docs/plan.md");
    expect(evaluatePredicate({ kind: "artifactExists", path: "docs/plan.md" }, com).ok).toBe(true);
    expect(evaluatePredicate({ kind: "artifactExists", path: "docs/nada.md" }, com).ok).toBe(false);
  });

  it("step ausente e predicado desconhecido são fail-closed, com o motivo", () => {
    const ctx = contexto({});
    expect(evaluatePredicate({ kind: "stepSucceeded", step: "ghost" }, ctx)).toMatchObject({
      ok: false,
      detail: expect.stringContaining("não existe"),
    });

    const estranho = { kind: "always" } as unknown as Predicate;
    expect(evaluatePredicate(estranho, ctx)).toMatchObject({
      ok: false,
      detail: 'Predicado desconhecido: "always".',
    });
  });
});

describe("evaluatePredicates", () => {
  it("é uma conjunção: o primeiro falso decide", () => {
    const ctx = contexto({ aa: SUCEDIDO, bb: { status: "FAILED", result: null } });
    const predicates: Predicate[] = [
      { kind: "stepSucceeded", step: "aa" },
      { kind: "stepSucceeded", step: "bb" },
      { kind: "stepSucceeded", step: "ghost" },
    ];

    const evaluation = evaluatePredicates(predicates, ctx);
    expect(evaluation).toMatchObject({ ok: false, predicate: { step: "bb" } });
    if (!evaluation.ok) {
      expect(skipReasonFor(evaluation)).toEqual({
        code: "PREDICATE_FALSE",
        predicate: { kind: "stepSucceeded", step: "bb" },
        detail: evaluation.detail,
      });
    }
  });

  it("lista vazia é verdadeira", () => {
    expect(evaluatePredicates([], contexto({}))).toEqual({ ok: true });
  });
});
