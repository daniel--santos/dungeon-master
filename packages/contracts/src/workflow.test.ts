import { describe, expect, it } from "vitest";

import { EXECUTION_EVENT_TYPE_VALUES } from "./execution-event.js";
import {
  ApprovalGateSchema,
  isWorkspaceRelativePath,
  PredicateSchema,
  ResolveApprovalGateSchema,
  RunStepResultSchema,
  RunStepSchema,
  WORKFLOW_KEY_PATTERN,
  type WorkflowDefinition,
  WorkflowDefinitionSchema,
} from "./workflow.js";
import {
  RUN_EVENT_TYPE_VALUES,
  RunEventPayloadSchema,
  WORKFLOW_EVENT_TYPE_VALUES,
  WorkflowEventSchema,
} from "./workflow-event.js";

/** A "Expedição guiada" do planejamento: Analyze → Plan → [Approval] → Execute → Validate. */
const GUIADA: WorkflowDefinition = {
  name: "Expedição guiada",
  steps: [
    { type: "agent", key: "analyze", name: "Analisar", dependsOn: [], prompt: "Analise." },
    {
      type: "agent",
      key: "plan",
      name: "Planejar",
      dependsOn: ["analyze"],
      includeOutputsOf: ["analyze"],
      prompt: "Planeje.",
    },
    {
      type: "approval",
      key: "approve-plan",
      name: "Aprovar o plano",
      dependsOn: ["plan"],
      gateKey: "plan",
      title: "O plano está bom?",
    },
    {
      type: "agent",
      key: "execute",
      name: "Executar",
      dependsOn: ["approve-plan"],
      includeOutputsOf: ["plan"],
      when: [{ kind: "stepSucceeded", step: "approve-plan" }],
      prompt: "Execute.",
    },
    {
      type: "validation",
      key: "validate",
      name: "Validar",
      dependsOn: ["execute"],
      argv: ["git", "status", "--porcelain"],
    },
  ],
};

function issues(input: unknown): Array<{ path: string; message: string }> {
  const result = WorkflowDefinitionSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

describe("WorkflowDefinitionSchema", () => {
  it("aceita a Expedição guiada e aplica o padrão de dependsOn", () => {
    const parsed = WorkflowDefinitionSchema.parse({
      name: "Mínimo",
      steps: [{ type: "agent", key: "only", name: "Só", prompt: "Faça." }],
    });

    expect(parsed.steps[0]?.dependsOn).toEqual([]);
    expect(WorkflowDefinitionSchema.safeParse(GUIADA).success).toBe(true);
  });

  it("recusa chave de step fora do padrão", () => {
    expect(WORKFLOW_KEY_PATTERN.test("Analyze")).toBe(false);
    expect(WORKFLOW_KEY_PATTERN.test("a")).toBe(false);
    expect(WORKFLOW_KEY_PATTERN.test("analyze-1")).toBe(true);

    const found = issues({
      name: "x",
      steps: [{ type: "agent", key: "Analyze", name: "A", prompt: "p" }],
    });
    expect(found.map((issue) => issue.path)).toContain("steps.0.key");
  });

  it("recusa chave repetida, apontando o step e o campo", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "agent", key: "same", name: "A", prompt: "p" },
        { type: "agent", key: "same", name: "B", prompt: "p" },
      ],
    });

    expect(found).toEqual([
      { path: "steps.1.key", message: 'O step "same" repete a chave do step na posição 0.' },
    ]);
  });

  it("recusa dependência inexistente e auto-dependência", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "agent", key: "aa", name: "A", prompt: "p", dependsOn: ["ghost"] },
        { type: "agent", key: "bb", name: "B", prompt: "p", dependsOn: ["bb"] },
      ],
    });

    expect(found).toEqual([
      {
        path: "steps.0.dependsOn.0",
        message: 'O step "aa" depende de "ghost", que não existe na definição.',
      },
      { path: "steps.1.dependsOn.0", message: 'O step "bb" depende de si mesmo.' },
    ]);
  });

  it("recusa ciclo, mostrando o caminho", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "agent", key: "aa", name: "A", prompt: "p", dependsOn: ["cc"] },
        { type: "agent", key: "bb", name: "B", prompt: "p", dependsOn: ["aa"] },
        { type: "agent", key: "cc", name: "C", prompt: "p", dependsOn: ["bb"] },
      ],
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe("steps.0.dependsOn");
    expect(found[0]?.message).toContain("ciclo");
    expect(found[0]?.message).toContain("aa → cc → bb → aa");
  });

  it("recusa gateKey repetido entre steps de aprovação", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "approval", key: "g1", name: "G1", gateKey: "plan", title: "t" },
        { type: "approval", key: "g2", name: "G2", gateKey: "plan", title: "t" },
      ],
    });

    expect(found).toEqual([
      { path: "steps.1.gateKey", message: 'O step "g2" repete o gateKey "plan" do step "g1".' },
    ]);
  });

  it("recusa predicado desconhecido no campo `when`", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "agent", key: "aa", name: "A", prompt: "p" },
        {
          type: "agent",
          key: "bb",
          name: "B",
          prompt: "p",
          dependsOn: ["aa"],
          when: [{ kind: "always", step: "aa" }],
        },
      ],
    });

    expect(found.some((issue) => issue.path.startsWith("steps.1.when.0"))).toBe(true);
  });

  it("recusa predicado sobre step que não é dependência", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "agent", key: "aa", name: "A", prompt: "p" },
        {
          type: "agent",
          key: "bb",
          name: "B",
          prompt: "p",
          when: [{ kind: "stepSucceeded", step: "aa" }],
        },
      ],
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe("steps.1.when.0.step");
    expect(found[0]?.message).toContain('"bb"');
    expect(found[0]?.message).toContain("não é dependência");
  });

  it("aceita predicado sobre dependência indireta", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "validation", key: "check", name: "C", argv: ["true"] },
        { type: "agent", key: "mid", name: "M", prompt: "p", dependsOn: ["check"] },
        {
          type: "agent",
          key: "last",
          name: "L",
          prompt: "p",
          dependsOn: ["mid"],
          when: [{ kind: "validationPassed", step: "check" }],
        },
      ],
    });

    expect(found).toEqual([]);
  });

  it("exige que validationPassed aponte para validation e outputStatusIs para agent", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "agent", key: "aa", name: "A", prompt: "p" },
        { type: "command", key: "cc", name: "C", argv: ["true"] },
        {
          type: "agent",
          key: "zz",
          name: "Z",
          prompt: "p",
          dependsOn: ["aa", "cc"],
          when: [
            { kind: "validationPassed", step: "aa" },
            { kind: "outputStatusIs", step: "cc", status: "completed" },
          ],
        },
      ],
    });

    expect(found.map((issue) => issue.path)).toEqual([
      "steps.2.when.0.step",
      "steps.2.when.1.step",
    ]);
    expect(found[0]?.message).toContain("agent e não validation");
    expect(found[1]?.message).toContain("command e não agent");
  });

  it("recusa includeOutputsOf que não é dependência ou não existe", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "agent", key: "aa", name: "A", prompt: "p" },
        { type: "agent", key: "bb", name: "B", prompt: "p", includeOutputsOf: ["aa", "nope"] },
      ],
    });

    expect(found.map((issue) => issue.path)).toEqual([
      "steps.1.includeOutputsOf.0",
      "steps.1.includeOutputsOf.1",
    ]);
  });

  it("recusa argv vazio, cwd absoluto e cwd com `..`", () => {
    expect(isWorkspaceRelativePath("packages/api")).toBe(true);
    expect(isWorkspaceRelativePath("C:\\repo")).toBe(false);
    expect(isWorkspaceRelativePath("/repo")).toBe(false);
    expect(isWorkspaceRelativePath("../fora")).toBe(false);
    expect(isWorkspaceRelativePath("a/../b")).toBe(false);

    const found = issues({
      name: "x",
      steps: [
        { type: "command", key: "c1", name: "C", argv: [] },
        { type: "command", key: "c2", name: "C", argv: ["ls"], cwd: "/etc" },
        { type: "command", key: "c3", name: "C", argv: ["ls"], cwd: "../x" },
      ],
    });

    expect(found.map((issue) => issue.path)).toEqual([
      "steps.0.argv",
      "steps.1.cwd",
      "steps.2.cwd",
    ]);
  });

  it("limita retry a 5 tentativas e exige timeout positivo", () => {
    const found = issues({
      name: "x",
      steps: [
        { type: "agent", key: "aa", name: "A", prompt: "p", retry: { maxAttempts: 6 } },
        { type: "agent", key: "bb", name: "B", prompt: "p", timeoutMs: 0 },
      ],
    });

    expect(found.map((issue) => issue.path)).toEqual([
      "steps.0.retry.maxAttempts",
      "steps.1.timeoutMs",
    ]);
  });

  it("exige ao menos um step e um tipo conhecido", () => {
    expect(issues({ name: "x", steps: [] }).map((issue) => issue.path)).toEqual(["steps"]);
    expect(
      issues({ name: "x", steps: [{ type: "script", key: "s", name: "S" }] }).some((issue) =>
        issue.path.startsWith("steps.0"),
      ),
    ).toBe(true);
  });
});

describe("PredicateSchema", () => {
  it("é um conjunto fechado", () => {
    expect(PredicateSchema.safeParse({ kind: "stepSucceeded", step: "a-1" }).success).toBe(true);
    expect(
      PredicateSchema.safeParse({ kind: "artifactExists", path: "docs/plan.md" }).success,
    ).toBe(true);
    expect(PredicateSchema.safeParse({ kind: "expression", expr: "a && b" }).success).toBe(false);
    expect(
      PredicateSchema.safeParse({ kind: "outputStatusIs", step: "aa", status: "done" }).success,
    ).toBe(false);
  });
});

describe("RunStep e ApprovalGate", () => {
  const AGORA = "2026-09-08T12:00:00.000Z";

  it("aceita um RunStep com resultado de validação", () => {
    const parsed = RunStepSchema.parse({
      id: "01996d00-0000-7000-8000-000000000010",
      runId: "01996d00-0000-7000-8000-000000000011",
      workflowStepId: "01996d00-0000-7000-8000-000000000012",
      key: "validate",
      name: "Validar",
      type: "validation",
      position: 4,
      status: "SUCCEEDED",
      attempt: 1,
      startedAt: AGORA,
      finishedAt: AGORA,
      result: { kind: "validation", verdict: "failed", exitCode: 1, durationMs: 12 },
      error: null,
      createdAt: AGORA,
      updatedAt: AGORA,
    });

    expect(parsed.result?.kind).toBe("validation");
  });

  it("discrimina o resultado pelo tipo do step", () => {
    expect(RunStepResultSchema.safeParse({ kind: "agent", status: "completed" }).success).toBe(
      true,
    );
    expect(RunStepResultSchema.safeParse({ kind: "agent", verdict: "passed" }).success).toBe(false);
    expect(
      RunStepResultSchema.safeParse({
        kind: "approval",
        gateId: "01996d00-0000-7000-8000-000000000013",
        decision: "approve",
        note: null,
        resolvedAt: AGORA,
      }).success,
    ).toBe(true);
  });

  it("aceita um gate pendente e o corpo de resolução", () => {
    const gate = ApprovalGateSchema.parse({
      id: "01996d00-0000-7000-8000-000000000013",
      runId: "01996d00-0000-7000-8000-000000000011",
      runStepId: "01996d00-0000-7000-8000-000000000010",
      gateKey: "plan",
      title: "O plano está bom?",
      description: null,
      status: "PENDING",
      requestedAt: AGORA,
      resolvedAt: null,
      note: null,
    });
    expect(gate.status).toBe("PENDING");

    expect(ResolveApprovalGateSchema.parse({ decision: "reject", note: " não " })).toEqual({
      decision: "reject",
      note: "não",
    });
    expect(ResolveApprovalGateSchema.safeParse({ decision: "maybe" }).success).toBe(false);
  });
});

describe("WorkflowEventSchema", () => {
  const AGORA = "2026-09-08T12:00:00.000Z";
  const RUN_STEP = "01996d00-0000-7000-8000-000000000010";

  it("aceita os cinco tipos", () => {
    expect(
      WorkflowEventSchema.safeParse({
        type: "StepStarted",
        timestamp: AGORA,
        runStepId: RUN_STEP,
        stepKey: "analyze",
        stepType: "agent",
        attempt: 1,
      }).success,
    ).toBe(true);

    expect(
      WorkflowEventSchema.safeParse({
        type: "StepSkipped",
        timestamp: AGORA,
        runStepId: RUN_STEP,
        stepKey: "execute",
        reason: {
          code: "PREDICATE_FALSE",
          predicate: { kind: "stepSucceeded", step: "approve-plan" },
          detail: "O step approve-plan terminou em FAILED.",
        },
      }).success,
    ).toBe(true);

    expect(
      WorkflowEventSchema.safeParse({
        type: "ApprovalRejected",
        timestamp: AGORA,
        gateId: "01996d00-0000-7000-8000-000000000013",
        gateKey: "plan",
        runStepId: RUN_STEP,
        stepKey: "approve-plan",
        decidedBy: "01996d00-0000-7000-8000-000000000001",
        note: null,
      }).success,
    ).toBe(true);
  });

  it("não compartilha nome com os eventos de execução", () => {
    for (const type of WORKFLOW_EVENT_TYPE_VALUES) {
      expect(EXECUTION_EVENT_TYPE_VALUES).not.toContain(type);
    }
    expect(new Set(RUN_EVENT_TYPE_VALUES).size).toBe(RUN_EVENT_TYPE_VALUES.length);
  });

  it("RunEventPayload aceita evento de harness e de motor, e recusa tipo estranho", () => {
    expect(
      RunEventPayloadSchema.safeParse({
        type: "TextDelta",
        timestamp: AGORA,
        harness: "CLAUDE_CODE",
        text: "oi",
      }).success,
    ).toBe(true);
    expect(
      RunEventPayloadSchema.safeParse({
        type: "StepFinished",
        timestamp: AGORA,
        runStepId: RUN_STEP,
        stepKey: "analyze",
        status: "SUCCEEDED",
        attempt: 1,
        summary: "ok",
      }).success,
    ).toBe(true);
    expect(RunEventPayloadSchema.safeParse({ type: "StepPaused", timestamp: AGORA }).success).toBe(
      false,
    );
  });
});
