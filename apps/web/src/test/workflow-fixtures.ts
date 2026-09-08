import type {
  ApprovalGateRecord,
  RunStepRecord,
  WorkflowDefinitionBody,
  WorkflowRecord,
} from "@/lib/api-types";
import { RUN } from "@/test/execution-fixtures";

/**
 * Registros de Workflow para os testes de componente (Fase 4C).
 *
 * A definição é a "Expedição guiada" do planejamento, com os nomes neutros
 * do exemplo embutido: `Analyze → Plan → [Approval] → Execute → Validate`.
 */

const NOW = "2026-09-08T10:15:00.000Z";

export const DEFINITION: WorkflowDefinitionBody = {
  name: "Cerimônia dos testes",
  description: "Analisa, planeja, espera a decisão, executa e valida.",
  steps: [
    {
      type: "agent",
      key: "analyze",
      name: "Analisar",
      dependsOn: [],
      prompt: "Analise a tarefa.",
    },
    {
      type: "agent",
      key: "plan",
      name: "Planejar",
      dependsOn: ["analyze"],
      includeOutputsOf: ["analyze"],
      prompt: "Escreva um plano.",
    },
    {
      type: "approval",
      key: "approve-plan",
      name: "Revisar o plano",
      dependsOn: ["plan"],
      gateKey: "plan",
      title: "Confirmar o plano de implementação",
      description: "O plano precisa de confirmação antes da execução.",
    },
    {
      type: "agent",
      key: "execute",
      name: "Executar",
      dependsOn: ["approve-plan"],
      when: [{ kind: "stepSucceeded", step: "approve-plan" }],
      prompt: "Implemente o plano.",
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

export const WORKFLOW: WorkflowRecord = {
  id: "0199a0a0-0000-7000-8000-000000000001",
  name: DEFINITION.name,
  description: DEFINITION.description ?? null,
  definition: DEFINITION,
  latestVersion: null,
  createdAt: NOW,
  updatedAt: NOW,
};

export const GATE: ApprovalGateRecord = {
  id: "0199b0b0-0000-7000-8000-000000000001",
  runId: RUN.id,
  runStepId: "0199c0c0-0000-7000-8000-000000000003",
  gateKey: "plan",
  title: "Confirmar o plano de implementação",
  description: "O plano precisa de confirmação antes da execução.",
  status: "PENDING",
  requestedAt: NOW,
  resolvedAt: null,
  note: null,
};

function step(
  position: number,
  key: string,
  name: string,
  type: RunStepRecord["type"],
  rest: Partial<RunStepRecord> = {},
): RunStepRecord {
  return {
    id: `0199c0c0-0000-7000-8000-00000000000${String(position + 1)}`,
    runId: RUN.id,
    workflowStepId: `0199d0d0-0000-7000-8000-00000000000${String(position + 1)}`,
    key,
    name,
    type,
    position,
    status: "PENDING",
    attempt: 0,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
  };
}

/** Um Run parado no gate: dois passos feitos, um esperando, dois por vir. */
export const RUN_STEPS: readonly RunStepRecord[] = [
  step(0, "analyze", "Analisar", "agent", {
    status: "SUCCEEDED",
    attempt: 1,
    startedAt: "2026-09-08T10:00:00.000Z",
    finishedAt: "2026-09-08T10:01:30.000Z",
    result: { kind: "agent", status: "completed", summary: "Três arquivos precisam mudar." },
  }),
  step(1, "plan", "Planejar", "agent", {
    status: "SUCCEEDED",
    attempt: 2,
    startedAt: "2026-09-08T10:01:31.000Z",
    finishedAt: "2026-09-08T10:03:00.000Z",
    result: { kind: "agent", status: "completed", summary: "Plano em cinco passos." },
  }),
  step(2, "approve-plan", "Revisar o plano", "approval", {
    status: "WAITING_APPROVAL",
    attempt: 1,
    startedAt: "2026-09-08T10:03:01.000Z",
  }),
  step(3, "execute", "Executar", "agent"),
  step(4, "validate", "Validar", "validation"),
];

/** Os mesmos passos depois de um Run inteiro, com pulo, comando e validação. */
export const FINISHED_STEPS: readonly RunStepRecord[] = [
  RUN_STEPS[0]!,
  RUN_STEPS[1]!,
  step(2, "approve-plan", "Revisar o plano", "approval", {
    status: "FAILED",
    attempt: 1,
    startedAt: "2026-09-08T10:03:01.000Z",
    finishedAt: "2026-09-08T10:10:00.000Z",
    result: {
      kind: "approval",
      gateId: GATE.id,
      decision: "reject",
      note: "Falta cobrir o Windows.",
      resolvedAt: "2026-09-08T10:10:00.000Z",
    },
    error: { code: "APPROVAL_REJECTED", message: 'O gate "plan" foi recusado.' },
  }),
  step(3, "execute", "Executar", "agent", {
    status: "SKIPPED",
    finishedAt: "2026-09-08T10:10:01.000Z",
    error: {
      code: "STEP_SKIPPED",
      message: "approve-plan não terminou em SUCCEEDED",
      details: {
        code: "PREDICATE_FALSE",
        predicate: { kind: "stepSucceeded", step: "approve-plan" },
        detail: "approve-plan terminou em FAILED",
      },
    },
  }),
  step(4, "validate", "Validar", "validation", {
    status: "SUCCEEDED",
    attempt: 1,
    startedAt: "2026-09-08T10:10:02.000Z",
    finishedAt: "2026-09-08T10:10:03.000Z",
    result: {
      kind: "validation",
      verdict: "failed",
      exitCode: 1,
      durationMs: 800,
      stdoutTail: " M apps/web/src/main.tsx\n?? notes.md\n",
    },
  }),
];
