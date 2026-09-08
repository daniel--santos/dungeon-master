import { RUN_STEP_STATUS_VALUES, type RunStepStatus } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  allowedRunStepTransitions,
  canTransitionRunStep,
  checkRunStepTransition,
  FAILED_RUN_STEP_STATUSES,
  isFailedRunStepStatus,
  isTerminalRunStepStatus,
  RUN_STEP_TRANSITIONS,
  TERMINAL_RUN_STEP_STATUSES,
} from "./run-step-status.js";

/**
 * A tabela completa da máquina de RunStep, escrita à mão: a segunda cópia,
 * como nas de Task e de Run, para o teste não concordar com o código por
 * derivação.
 */
const TRANSICOES_VALIDAS: ReadonlyArray<readonly [RunStepStatus, RunStepStatus]> = [
  ["PENDING", "RUNNING"],
  ["PENDING", "SKIPPED"],
  ["PENDING", "CANCELLED"],
  ["RUNNING", "SUCCEEDED"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "TIMED_OUT"],
  ["RUNNING", "CANCELLED"],
  ["RUNNING", "WAITING_APPROVAL"],
  ["RUNNING", "PENDING"],
  ["WAITING_APPROVAL", "SUCCEEDED"],
  ["WAITING_APPROVAL", "FAILED"],
  ["WAITING_APPROVAL", "CANCELLED"],
];

function ehValida(from: RunStepStatus, to: RunStepStatus): boolean {
  return TRANSICOES_VALIDAS.some(([origem, destino]) => origem === from && destino === to);
}

describe("canTransitionRunStep", () => {
  it("aceita exatamente as arestas da máquina de estados", () => {
    for (const [from, to] of TRANSICOES_VALIDAS) {
      expect(canTransitionRunStep(from, to), `${from} → ${to} deveria valer`).toBe(true);
    }
  });

  it("recusa toda combinação que não está na tabela", () => {
    const aceitas: string[] = [];
    for (const from of RUN_STEP_STATUS_VALUES) {
      for (const to of RUN_STEP_STATUS_VALUES) {
        if (ehValida(from, to)) continue;
        if (canTransitionRunStep(from, to)) aceitas.push(`${from} → ${to}`);
      }
    }
    expect(aceitas).toEqual([]);
  });

  it("não tem aresta para o próprio estado", () => {
    for (const status of RUN_STEP_STATUS_VALUES) {
      expect(canTransitionRunStep(status, status), `${status} → ${status}`).toBe(false);
    }
  });
});

describe("RUN_STEP_TRANSITIONS", () => {
  it("cobre todos os estados e só aponta para estados existentes", () => {
    expect(Object.keys(RUN_STEP_TRANSITIONS).sort()).toEqual([...RUN_STEP_STATUS_VALUES].sort());
    for (const destinos of Object.values(RUN_STEP_TRANSITIONS)) {
      for (const destino of destinos) expect(RUN_STEP_STATUS_VALUES).toContain(destino);
    }
  });

  it("os terminais não têm saída, e são os cinco", () => {
    expect([...TERMINAL_RUN_STEP_STATUSES].sort()).toEqual(
      ["CANCELLED", "FAILED", "SKIPPED", "SUCCEEDED", "TIMED_OUT"].sort(),
    );
    for (const status of RUN_STEP_STATUS_VALUES) {
      expect(isTerminalRunStepStatus(status)).toBe(allowedRunStepTransitions(status).length === 0);
    }
  });

  it("falha é FAILED ou TIMED_OUT; pulado e cancelado não contam", () => {
    expect([...FAILED_RUN_STEP_STATUSES]).toEqual(["FAILED", "TIMED_OUT"]);
    expect(isFailedRunStepStatus("SKIPPED")).toBe(false);
    expect(isFailedRunStepStatus("CANCELLED")).toBe(false);
  });
});

describe("checkRunStepTransition", () => {
  it("devolve ok numa aresta válida", () => {
    expect(checkRunStepTransition("PENDING", "RUNNING")).toEqual({ ok: true });
  });

  it("devolve a recusa com os destinos possíveis", () => {
    expect(checkRunStepTransition("SUCCEEDED", "RUNNING")).toEqual({
      ok: false,
      rejection: { code: "INVALID_TRANSITION", from: "SUCCEEDED", to: "RUNNING", allowed: [] },
    });
  });
});
