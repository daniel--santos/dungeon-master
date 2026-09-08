import { describe, expect, it } from "vitest";

import {
  canTransitionProposedTask,
  checkProposalApproval,
  checkTaskDependencies,
  decideProposalPolicy,
  isProposedTaskOpen,
  type ProposalTaskRef,
} from "./proposed-task-rules.js";

function task(id: string, overrides: Partial<Omit<ProposalTaskRef, "id">> = {}): ProposalTaskRef {
  return { id, projectId: "P1", status: "READY", ...overrides };
}

describe("máquina de estados da proposta", () => {
  it("PROPOSED vai para APPROVED ou REJECTED, e os dois são terminais", () => {
    expect(canTransitionProposedTask("PROPOSED", "APPROVED")).toBe(true);
    expect(canTransitionProposedTask("PROPOSED", "REJECTED")).toBe(true);
    expect(canTransitionProposedTask("APPROVED", "REJECTED")).toBe(false);
    expect(canTransitionProposedTask("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionProposedTask("APPROVED", "PROPOSED")).toBe(false);
  });

  it("só PROPOSED está aberta", () => {
    expect(isProposedTaskOpen("PROPOSED")).toBe(true);
    expect(isProposedTaskOpen("APPROVED")).toBe(false);
    expect(isProposedTaskOpen("REJECTED")).toBe(false);
  });
});

describe("checkTaskDependencies", () => {
  it("aceita dependências do mesmo Project sem ciclo", () => {
    const check = checkTaskDependencies({
      taskId: "T",
      projectId: "P1",
      dependencies: [task("A"), task("B")],
      edges: [{ taskId: "A", dependsOnTaskId: "B" }],
    });
    expect(check).toEqual({ ok: true });
  });

  it("recusa a auto-dependência antes de olhar o grafo", () => {
    const check = checkTaskDependencies({
      taskId: "T",
      projectId: "P1",
      dependencies: [task("T")],
      edges: [],
    });
    expect(check).toEqual({ ok: false, rejection: { code: "SELF_DEPENDENCY", taskId: "T" } });
  });

  it("recusa dependência de outro Project", () => {
    const check = checkTaskDependencies({
      taskId: "T",
      projectId: "P1",
      dependencies: [task("A", { projectId: "P2" })],
      edges: [],
    });
    expect(check).toEqual({
      ok: false,
      rejection: { code: "DEPENDENCY_IN_OTHER_PROJECT", taskId: "A" },
    });
  });

  it("recusa dependência na Inbox", () => {
    const check = checkTaskDependencies({
      taskId: "T",
      projectId: "P1",
      dependencies: [task("A", { projectId: null, status: "INBOX" })],
      edges: [],
    });
    expect(check).toEqual({ ok: false, rejection: { code: "DEPENDENCY_IN_INBOX", taskId: "A" } });
  });

  it("acha o ciclo que a aresta nova fecha e devolve o caminho", () => {
    // B espera T; fazer T esperar B fecha T → B → T.
    const check = checkTaskDependencies({
      taskId: "T",
      projectId: "P1",
      dependencies: [task("B")],
      edges: [{ taskId: "B", dependsOnTaskId: "T" }],
    });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection.code).toBe("DEPENDENCY_CYCLE");
    if (check.rejection.code !== "DEPENDENCY_CYCLE") return;
    expect(check.rejection.path).toEqual(["B", "T", "B"]);
  });

  it("acha um ciclo que só existe com as duas arestas novas juntas", () => {
    // C espera A. T passa a esperar A e C... sem ciclo. Mas se A espera T:
    // T → A → T. O caso relevante é o conjunto: T → C → A e A → T.
    const check = checkTaskDependencies({
      taskId: "T",
      projectId: "P1",
      dependencies: [task("A"), task("C")],
      edges: [
        { taskId: "C", dependsOnTaskId: "A" },
        { taskId: "A", dependsOnTaskId: "T" },
      ],
    });
    expect(check.ok).toBe(false);
    if (check.ok || check.rejection.code !== "DEPENDENCY_CYCLE") return;
    expect(check.rejection.path[0]).toBe(check.rejection.path.at(-1));
    expect(check.rejection.path).toContain("T");
  });
});

describe("checkProposalApproval", () => {
  const proposal = { status: "PROPOSED", projectId: "P1" } as const;

  it("aprova com a mãe de origem e dependências do mesmo Project", () => {
    const check = checkProposalApproval({
      proposal,
      newTaskId: "N",
      parent: task("O"),
      dependencies: [task("O")],
      edges: [],
    });
    expect(check).toEqual({ ok: true });
  });

  it("aprova sem mãe e sem dependências", () => {
    expect(
      checkProposalApproval({
        proposal,
        newTaskId: "N",
        parent: null,
        dependencies: [],
        edges: [],
      }),
    ).toEqual({ ok: true });
  });

  it("recusa uma proposta já decidida", () => {
    const check = checkProposalApproval({
      proposal: { status: "REJECTED", projectId: "P1" },
      newTaskId: "N",
      parent: null,
      dependencies: [],
      edges: [],
    });
    expect(check).toEqual({
      ok: false,
      rejection: { code: "PROPOSAL_ALREADY_DECIDED", status: "REJECTED" },
    });
  });

  it("recusa a mãe de outro Project e a mãe na Inbox", () => {
    expect(
      checkProposalApproval({
        proposal,
        newTaskId: "N",
        parent: task("M", { projectId: "P2" }),
        dependencies: [],
        edges: [],
      }),
    ).toEqual({ ok: false, rejection: { code: "PARENT_IN_OTHER_PROJECT", parentTaskId: "M" } });

    expect(
      checkProposalApproval({
        proposal,
        newTaskId: "N",
        parent: task("M", { projectId: null, status: "INBOX" }),
        dependencies: [],
        edges: [],
      }),
    ).toEqual({ ok: false, rejection: { code: "PARENT_IN_INBOX", parentTaskId: "M" } });
  });

  it("passa as dependências pelas regras de dependência", () => {
    const check = checkProposalApproval({
      proposal,
      newTaskId: "N",
      parent: null,
      dependencies: [task("X", { projectId: "P9" })],
      edges: [],
    });
    expect(check).toEqual({
      ok: false,
      rejection: { code: "DEPENDENCY_IN_OTHER_PROJECT", taskId: "X" },
    });
  });
});

describe("decideProposalPolicy", () => {
  it("hoje toda proposta vai para revisão humana", () => {
    expect(
      decideProposalPolicy({
        projectId: "P1",
        originTaskId: "O",
        title: "Cobrir o parser com testes",
        rationale: "Nenhum teste toca o caminho de erro.",
      }),
    ).toBe("human-review");
  });
});
