import { TASK_STATUS_VALUES, type TaskStatus } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import { checkTaskTransition } from "./task-rules.js";
import {
  allowedTaskTransitions,
  canTransitionTask,
  isTerminalTaskStatus,
  PROJECTLESS_TASK_STATUSES,
  TASK_TRANSITIONS,
  taskStatusRequiresProject,
  TERMINAL_TASK_STATUSES,
} from "./task-status.js";

/**
 * A tabela completa da seção 36 do documento técnico, escrita à mão.
 *
 * Não é derivada de `TASK_TRANSITIONS`: um teste que se deriva do código sob
 * teste concorda com qualquer erro que o código tenha. Esta é a segunda cópia,
 * independente, e a divergência entre as duas é o que o teste procura.
 */
const TRANSICOES_VALIDAS: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
  ["INBOX", "READY"],
  ["INBOX", "CANCELLED"],
  ["READY", "QUEUED"],
  ["READY", "COMPLETED"],
  ["READY", "CANCELLED"],
  ["QUEUED", "RUNNING"],
  ["QUEUED", "CANCELLED"],
  ["RUNNING", "COMPLETED"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "WAITING"],
  ["RUNNING", "BLOCKED"],
  ["RUNNING", "CANCELLED"],
  ["WAITING", "RUNNING"],
  ["BLOCKED", "READY"],
  ["FAILED", "QUEUED"],
];

function ehValida(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSICOES_VALIDAS.some(([origem, destino]) => origem === from && destino === to);
}

describe("canTransitionTask", () => {
  it("aceita exatamente as arestas da máquina de estados", () => {
    for (const [from, to] of TRANSICOES_VALIDAS) {
      expect(canTransitionTask(from, to), `${from} → ${to} deveria valer`).toBe(true);
    }
  });

  it("recusa toda combinação que não está na tabela", () => {
    const recusadas: string[] = [];

    for (const from of TASK_STATUS_VALUES) {
      for (const to of TASK_STATUS_VALUES) {
        if (ehValida(from, to)) continue;
        if (canTransitionTask(from, to)) recusadas.push(`${from} → ${to}`);
      }
    }

    expect(recusadas).toEqual([]);
  });

  it("cobre os 81 pares possíveis, e só 15 passam", () => {
    const total = TASK_STATUS_VALUES.length * TASK_STATUS_VALUES.length;
    const validas = TASK_STATUS_VALUES.flatMap((from) =>
      TASK_STATUS_VALUES.filter((to) => canTransitionTask(from, to)),
    );

    expect(total).toBe(81);
    expect(validas).toHaveLength(TRANSICOES_VALIDAS.length);
  });

  it("nenhum estado transita para si mesmo", () => {
    for (const status of TASK_STATUS_VALUES) {
      expect(canTransitionTask(status, status), `${status} → ${status}`).toBe(false);
    }
  });

  it("todo estado tem uma linha na tabela de transições", () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...TASK_STATUS_VALUES].sort());
  });
});

describe("estados terminais", () => {
  it("COMPLETED e CANCELLED não têm saída", () => {
    expect([...TERMINAL_TASK_STATUSES]).toEqual(["COMPLETED", "CANCELLED"]);

    for (const status of TERMINAL_TASK_STATUSES) {
      expect(isTerminalTaskStatus(status)).toBe(true);
      expect(allowedTaskTransitions(status)).toEqual([]);
    }
  });

  it("FAILED não é terminal: volta para QUEUED", () => {
    expect(isTerminalTaskStatus("FAILED")).toBe(false);
    expect(allowedTaskTransitions("FAILED")).toEqual(["QUEUED"]);
  });

  it("um estado sem saída é exatamente um estado terminal", () => {
    for (const status of TASK_STATUS_VALUES) {
      expect(allowedTaskTransitions(status).length === 0).toBe(isTerminalTaskStatus(status));
    }
  });
});

describe("taskStatusRequiresProject", () => {
  it("só a captura e o descarte vivem sem Project", () => {
    for (const status of TASK_STATUS_VALUES) {
      const semProject = status === "INBOX" || status === "CANCELLED";
      expect(taskStatusRequiresProject(status), status).toBe(!semProject);
    }
  });

  it("os estados sem Project são exatamente os declarados", () => {
    expect([...PROJECTLESS_TASK_STATUSES]).toEqual(["INBOX", "CANCELLED"]);
  });
});

describe("checkTaskTransition sem vizinhança", () => {
  it("recusa uma aresta inexistente dizendo o que era possível", () => {
    const resultado = checkTaskTransition({ from: "INBOX", to: "RUNNING" });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;

    expect(resultado.rejection.code).toBe("INVALID_TRANSITION");
    if (resultado.rejection.code !== "INVALID_TRANSITION") return;

    expect(resultado.rejection.allowed).toEqual(["READY", "CANCELLED"]);
  });

  it("aceita uma aresta válida quando não há filhas nem dependências", () => {
    expect(checkTaskTransition({ from: "READY", to: "QUEUED" })).toEqual({ ok: true });
  });
});
