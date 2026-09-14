import type { RuleFacts } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import { type ApprovalPolicyRule, decideApproval } from "./approval-policies.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

const FACTS: RuleFacts = {
  projectId: "P1",
  loadoutId: "L1",
  taskKind: "CHORE",
  taskPriority: "LOW",
  executionMode: "HOST",
  harnessKey: "CLAUDE_CODE",
};

function policy(id: string, overrides: Partial<ApprovalPolicyRule> = {}): ApprovalPolicyRule {
  return {
    id,
    name: `política ${id}`,
    subject: "PROPOSAL",
    projectId: null,
    priority: 100,
    conditions: {},
    action: "AUTO_APPROVE",
    enabled: true,
    ...overrides,
  };
}

describe("decideApproval", () => {
  it("fail-closed: sem política que case, revisão humana por DEFAULT", () => {
    const decision = decideApproval({
      subject: "PROPOSAL",
      policies: [policy("a", { conditions: { taskKind: "BUG" } })],
      facts: FACTS,
      autonomyLevel: 3,
      now: NOW,
    });
    expect(decision).toMatchObject({
      subject: "PROPOSAL",
      action: "REQUIRE_APPROVAL",
      policyId: null,
      policyAction: null,
      decidedBy: "DEFAULT",
      autonomyLevel: 3,
      decidedAt: NOW.toISOString(),
    });
    expect(decision.reason).toContain("Nenhuma política");
  });

  it("uma política de outro assunto não decide este", () => {
    const decision = decideApproval({
      subject: "PROPOSAL",
      policies: [policy("gate", { subject: "GATE" }), policy("run", { subject: "RUN_START" })],
      facts: FACTS,
      autonomyLevel: 4,
      now: NOW,
    });
    expect(decision.decidedBy).toBe("DEFAULT");
  });

  it("AUTO_APPROVE vale com nível 3 e diz quem decidiu", () => {
    const decision = decideApproval({
      subject: "PROPOSAL",
      policies: [policy("chores", { conditions: { taskKind: "CHORE" } })],
      facts: FACTS,
      autonomyLevel: 3,
      now: NOW,
    });
    expect(decision).toMatchObject({
      action: "AUTO_APPROVE",
      policyId: "chores",
      policyAction: "AUTO_APPROVE",
      decidedBy: "POLICY:chores",
    });
    expect(decision.reason).toContain("libera AUTO_APPROVE_PROPOSAL");
  });

  it("AUTO_APPROVE com nível 2 é rebaixado a revisão humana pela autonomia", () => {
    const decision = decideApproval({
      subject: "PROPOSAL",
      policies: [policy("chores")],
      facts: FACTS,
      autonomyLevel: 2,
      now: NOW,
    });
    expect(decision).toMatchObject({
      action: "REQUIRE_APPROVAL",
      policyId: "chores",
      policyAction: "AUTO_APPROVE",
      decidedBy: "AUTONOMY:2",
    });
    expect(decision.reason).toContain("não libera");
  });

  it("RUN_START exige AUTO_DISPATCH (nível 3) e GATE exige AUTO_APPROVE_GATE (nível 3)", () => {
    const partida = decideApproval({
      subject: "RUN_START",
      policies: [policy("p", { subject: "RUN_START" })],
      facts: FACTS,
      autonomyLevel: 2,
      now: NOW,
    });
    expect(partida.action).toBe("REQUIRE_APPROVAL");
    expect(partida.reason).toContain("AUTO_DISPATCH");

    const gate = decideApproval({
      subject: "GATE",
      policies: [policy("g", { subject: "GATE", conditions: { stepType: "approval" } })],
      facts: { ...FACTS, stepType: "approval" },
      autonomyLevel: 3,
      now: NOW,
    });
    expect(gate.action).toBe("AUTO_APPROVE");
  });

  it("DENY nunca é rebaixado, nem no nível 0", () => {
    const decision = decideApproval({
      subject: "PROPOSAL",
      policies: [policy("nada", { action: "DENY" })],
      facts: FACTS,
      autonomyLevel: 0,
      now: NOW,
    });
    expect(decision).toMatchObject({ action: "DENY", decidedBy: "POLICY:nada" });
  });

  it("REQUIRE_APPROVAL explícito é revisão humana pela política", () => {
    const decision = decideApproval({
      subject: "PROPOSAL",
      policies: [policy("humana", { action: "REQUIRE_APPROVAL" })],
      facts: FACTS,
      autonomyLevel: 4,
      now: NOW,
    });
    expect(decision).toMatchObject({ action: "REQUIRE_APPROVAL", decidedBy: "POLICY:humana" });
  });

  it("a de maior prioridade vence; empate é revisão humana com as duas nomeadas", () => {
    const vence = decideApproval({
      subject: "PROPOSAL",
      policies: [
        policy("nega", { action: "DENY", priority: 10 }),
        policy("aprova", { action: "AUTO_APPROVE", priority: 200 }),
      ],
      facts: FACTS,
      autonomyLevel: 3,
      now: NOW,
    });
    expect(vence.decidedBy).toBe("POLICY:aprova");

    const empate = decideApproval({
      subject: "PROPOSAL",
      policies: [
        policy("x", { action: "DENY", priority: 200 }),
        policy("y", { action: "AUTO_APPROVE", priority: 200 }),
      ],
      facts: FACTS,
      autonomyLevel: 3,
      now: NOW,
    });
    expect(empate).toMatchObject({
      action: "REQUIRE_APPROVAL",
      policyId: null,
      decidedBy: "TIE:x,y",
    });
    expect(empate.reason).toContain("empate");
  });

  it("a política de um Project só vale nele; a global vale em todos", () => {
    const policies = [
      policy("do-p2", { projectId: "P2", priority: 900, action: "DENY" }),
      policy("global", { priority: 1, action: "AUTO_APPROVE" }),
    ];
    const emP1 = decideApproval({ subject: "PROPOSAL", policies, facts: FACTS, autonomyLevel: 3, now: NOW });
    expect(emP1.decidedBy).toBe("POLICY:global");
    const emP2 = decideApproval({
      subject: "PROPOSAL",
      policies,
      facts: { ...FACTS, projectId: "P2" },
      autonomyLevel: 3,
      now: NOW,
    });
    expect(emP2.decidedBy).toBe("POLICY:do-p2");
  });

  it("condições sobre fatos não medidos não casam (fail-closed)", () => {
    const decision = decideApproval({
      subject: "PROPOSAL",
      policies: [policy("barata", { conditions: { maxEstimatedTokens: 50_000 } })],
      facts: FACTS,
      autonomyLevel: 3,
      now: NOW,
    });
    expect(decision.decidedBy).toBe("DEFAULT");
  });
});
