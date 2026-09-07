import { RUN_STATUS_VALUES, type RunStatus } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  allowedRunTransitions,
  canTransitionRun,
  checkRunTransition,
  isPreExecutionRunStatus,
  isTerminalRunStatus,
  PRE_EXECUTION_RUN_STATUSES,
  RUN_TRANSITIONS,
  TERMINAL_RUN_STATUSES,
} from "./run-status.js";

/**
 * A tabela completa da máquina de Run, escrita à mão.
 *
 * Como na de Task, não é derivada de `RUN_TRANSITIONS`: um teste derivado do
 * código sob teste concorda com qualquer erro dele. Esta é a segunda cópia, e
 * a divergência entre as duas é o que o teste procura.
 */
const TRANSICOES_VALIDAS: ReadonlyArray<readonly [RunStatus, RunStatus]> = [
  ["CREATED", "QUEUED"],
  ["CREATED", "CANCELLED"],
  ["QUEUED", "PREPARING"],
  ["QUEUED", "CANCELLED"],
  ["PREPARING", "RUNNING"],
  ["PREPARING", "FAILED"],
  ["PREPARING", "CANCELLED"],
  ["RUNNING", "SUCCEEDED"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "TIMED_OUT"],
  ["RUNNING", "CANCELLED"],
  ["RUNNING", "WAITING_APPROVAL"],
  ["WAITING_APPROVAL", "RUNNING"],
  ["WAITING_APPROVAL", "CANCELLED"],
];

function ehValida(from: RunStatus, to: RunStatus): boolean {
  return TRANSICOES_VALIDAS.some(([origem, destino]) => origem === from && destino === to);
}

describe("canTransitionRun", () => {
  it("aceita exatamente as arestas da máquina de estados", () => {
    for (const [from, to] of TRANSICOES_VALIDAS) {
      expect(canTransitionRun(from, to), `${from} → ${to} deveria valer`).toBe(true);
    }
  });

  it("recusa toda combinação que não está na tabela", () => {
    const recusadas: string[] = [];

    for (const from of RUN_STATUS_VALUES) {
      for (const to of RUN_STATUS_VALUES) {
        if (ehValida(from, to)) continue;
        if (canTransitionRun(from, to)) recusadas.push(`${from} → ${to}`);
      }
    }

    expect(recusadas).toEqual([]);
  });

  it("não tem aresta para o próprio estado", () => {
    for (const status of RUN_STATUS_VALUES) {
      expect(canTransitionRun(status, status), `${status} → ${status}`).toBe(false);
    }
  });
});

describe("RUN_TRANSITIONS", () => {
  it("cobre todos os estados", () => {
    expect(Object.keys(RUN_TRANSITIONS).sort()).toEqual([...RUN_STATUS_VALUES].sort());
  });

  it("só aponta para estados existentes", () => {
    for (const destinos of Object.values(RUN_TRANSITIONS)) {
      for (const destino of destinos) {
        expect(RUN_STATUS_VALUES).toContain(destino);
      }
    }
  });

  it("todo estado não terminal é alcançável a partir de algum outro", () => {
    const alcançáveis = new Set(Object.values(RUN_TRANSITIONS).flat());
    for (const status of RUN_STATUS_VALUES) {
      // `CREATED` é o estado inicial: ninguém aponta para ele.
      if (status === "CREATED") continue;
      expect(alcançáveis.has(status), `${status} não é alcançável`).toBe(true);
    }
  });
});

describe("estados terminais", () => {
  it("são os quatro desfechos de uma tentativa", () => {
    expect([...TERMINAL_RUN_STATUSES]).toEqual(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]);
  });

  it("não têm saída", () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(allowedRunTransitions(status)).toEqual([]);
      expect(isTerminalRunStatus(status)).toBe(true);
    }
  });

  it("FAILED é terminal num Run, ao contrário de uma Task", () => {
    // A retentativa é um Run novo, com `attempt` maior. Fazer o Run voltar à
    // fila apagaria a tentativa que falhou do histórico.
    expect(isTerminalRunStatus("FAILED")).toBe(true);
    expect(allowedRunTransitions("FAILED")).toEqual([]);
  });

  it("todo estado não terminal tem pelo menos uma saída", () => {
    for (const status of RUN_STATUS_VALUES) {
      if (isTerminalRunStatus(status)) continue;
      expect(allowedRunTransitions(status).length, status).toBeGreaterThan(0);
    }
  });

  it("todo estado não terminal alcança um terminal em algum número de passos", () => {
    for (const inicio of RUN_STATUS_VALUES) {
      const vistos = new Set<RunStatus>([inicio]);
      const fila: RunStatus[] = [inicio];
      let chegou = false;

      while (fila.length > 0) {
        const atual = fila.shift()!;
        if (isTerminalRunStatus(atual)) {
          chegou = true;
          break;
        }
        for (const proximo of allowedRunTransitions(atual)) {
          if (vistos.has(proximo)) continue;
          vistos.add(proximo);
          fila.push(proximo);
        }
      }

      expect(chegou, `${inicio} não alcança nenhum estado terminal`).toBe(true);
    }
  });
});

describe("PRE_EXECUTION_RUN_STATUSES", () => {
  it("são os estados em que nenhum processo subiu ainda", () => {
    expect([...PRE_EXECUTION_RUN_STATUSES]).toEqual(["CREATED", "QUEUED"]);
  });

  it("os dois alcançam CANCELLED direto, que é o que permite cancelar na hora", () => {
    for (const status of PRE_EXECUTION_RUN_STATUSES) {
      expect(isPreExecutionRunStatus(status)).toBe(true);
      expect(canTransitionRun(status, "CANCELLED")).toBe(true);
    }
  });

  it("PREPARING já subiu trabalho e não conta como pré-execução", () => {
    expect(isPreExecutionRunStatus("PREPARING")).toBe(false);
  });
});

describe("checkRunTransition", () => {
  it("aprova uma aresta existente", () => {
    expect(checkRunTransition("QUEUED", "PREPARING")).toEqual({ ok: true });
  });

  it("recusa com o código, os dois estados e a lista de destinos possíveis", () => {
    const check = checkRunTransition("QUEUED", "SUCCEEDED");

    expect(check.ok).toBe(false);
    if (check.ok) return;

    expect(check.rejection).toEqual({
      code: "INVALID_TRANSITION",
      from: "QUEUED",
      to: "SUCCEEDED",
      allowed: ["PREPARING", "CANCELLED"],
    });
  });

  it("recusa sair de um estado terminal, com a lista vazia", () => {
    const check = checkRunTransition("SUCCEEDED", "RUNNING");

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection.allowed).toEqual([]);
  });
});
