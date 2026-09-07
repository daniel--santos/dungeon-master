import { TASK_STATUS_VALUES } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  checkTaskTransition,
  type TaskNode,
  uncompletedDependencies,
  unsettledChildren,
} from "./task-rules.js";

function no(id: string, status: TaskNode["status"]): TaskNode {
  return { id, status };
}

describe("regra das subtarefas", () => {
  it("deixa concluir quando toda filha está COMPLETED ou CANCELLED", () => {
    const resultado = checkTaskTransition({
      from: "RUNNING",
      to: "COMPLETED",
      children: [no("f1", "COMPLETED"), no("f2", "CANCELLED")],
    });

    expect(resultado).toEqual({ ok: true });
  });

  it("recusa concluir com filha pendente e diz quais são", () => {
    const resultado = checkTaskTransition({
      from: "RUNNING",
      to: "COMPLETED",
      children: [no("f1", "COMPLETED"), no("f2", "READY"), no("f3", "RUNNING")],
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;

    expect(resultado.rejection.code).toBe("CHILDREN_NOT_SETTLED");
    if (resultado.rejection.code !== "CHILDREN_NOT_SETTLED") return;

    expect([...resultado.rejection.blocking]).toEqual(["f2", "f3"]);
  });

  it("a regra só vale para COMPLETED: cancelar a mãe não espera as filhas", () => {
    const resultado = checkTaskTransition({
      from: "RUNNING",
      to: "CANCELLED",
      children: [no("f1", "READY")],
    });

    expect(resultado).toEqual({ ok: true });
  });

  it("unsettledChildren considera pendente todo estado não terminal", () => {
    const filhas = TASK_STATUS_VALUES.map((status) => no(status, status));

    expect(unsettledChildren(filhas)).toEqual(
      TASK_STATUS_VALUES.filter((status) => status !== "COMPLETED" && status !== "CANCELLED"),
    );
  });
});

describe("regra das dependências", () => {
  it("deixa enfileirar quando toda dependência está COMPLETED", () => {
    const resultado = checkTaskTransition({
      from: "READY",
      to: "QUEUED",
      dependencies: [no("d1", "COMPLETED"), no("d2", "COMPLETED")],
    });

    expect(resultado).toEqual({ ok: true });
  });

  it("recusa READY → QUEUED com dependência pendente e diz quais são", () => {
    const resultado = checkTaskTransition({
      from: "READY",
      to: "QUEUED",
      dependencies: [no("d1", "COMPLETED"), no("d2", "RUNNING")],
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;

    expect(resultado.rejection.code).toBe("DEPENDENCIES_NOT_COMPLETED");
    if (resultado.rejection.code !== "DEPENDENCIES_NOT_COMPLETED") return;

    expect([...resultado.rejection.blocking]).toEqual(["d2"]);
  });

  it("uma dependência CANCELLED continua bloqueando", () => {
    const resultado = checkTaskTransition({
      from: "READY",
      to: "QUEUED",
      dependencies: [no("d1", "CANCELLED")],
    });

    expect(resultado.ok).toBe(false);
    expect(uncompletedDependencies([no("d1", "CANCELLED")])).toEqual(["d1"]);
  });

  it("vale também para a nova tentativa, FAILED → QUEUED", () => {
    const resultado = checkTaskTransition({
      from: "FAILED",
      to: "QUEUED",
      dependencies: [no("d1", "BLOCKED")],
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.rejection.code).toBe("DEPENDENCIES_NOT_COMPLETED");
  });

  it("não atrapalha uma transição que não entra em QUEUED", () => {
    const resultado = checkTaskTransition({
      from: "READY",
      to: "CANCELLED",
      dependencies: [no("d1", "READY")],
    });

    expect(resultado).toEqual({ ok: true });
  });
});

describe("ordem das checagens", () => {
  it("a forma do grafo é verificada antes da vizinhança", () => {
    // `INBOX → COMPLETED` não existe na máquina. Mesmo sem filha pendente
    // alguma, o motivo relatado precisa ser a aresta, e não outra coisa.
    const resultado = checkTaskTransition({
      from: "INBOX",
      to: "COMPLETED",
      children: [no("f1", "READY")],
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.rejection.code).toBe("INVALID_TRANSITION");
  });
});
