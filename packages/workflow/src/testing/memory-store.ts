import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalRequestedEvent,
  HarnessKey,
  PolicyDecision,
  RunEventPayload,
  RunStatus,
  RunStep,
  RunStepStatus,
  WorkflowStepDefinition,
} from "@dungeon-master/contracts";
import {
  checkRunStepTransition,
  checkRunTransition,
  isTerminalRunStatus,
  isTerminalRunStepStatus,
  topologicalOrder,
} from "@dungeon-master/domain";

import type {
  ApprovalGateOutcome,
  ChildRunView,
  CreateApprovalGateInput,
  DelegationOutcome,
  OpenDelegationInput,
  RunStepTransitionOutcome,
  StepBudgetCheck,
  TransitionRunStepInput,
  WorkflowStore,
} from "../ports.js";

/**
 * O `WorkflowStore` em memória, com a mesma semântica do banco.
 *
 * O que ele imita de propósito, porque é o que o runner depende:
 *
 * - o CAS de `transitionRunStep`: `from` diferente do estado atual devolve
 *   `RUN_STEP_STATUS_CHANGED` com o estado atual, e nada muda;
 * - `attempt` sobe só com `incrementAttempt`, `started_at` na primeira ida a
 *   `RUNNING`, `finished_at` ao chegar num terminal;
 * - `createApprovalGate` idempotente por `gateKey`: cria uma vez, leva o step
 *   e o Run a `WAITING_APPROVAL` e grava `ApprovalRequested`; depois devolve
 *   o que existe sem escrever;
 * - `resolveGate` faz o que a API faz: assenta o step pelo desfecho e devolve
 *   o Run a `QUEUED`.
 *
 * Um "restart" é um novo runner sobre a mesma instância: nada aqui é
 * consultado pelo runner além do que estas funções devolvem.
 */

let contador = 0;

function fakeUuid(): string {
  contador += 1;
  const hex = contador.toString(16).padStart(12, "0");
  return `01990000-0000-7000-8000-${hex}`;
}

/** O que uma política de gate decidiria (Fase 9B), roteirizada por `gateKey`. */
export type ScriptedGatePolicy = (input: {
  gateKey: string;
  stepKey: string;
}) => { action: "AUTO_APPROVE" | "DENY"; policyId: string; reason?: string } | undefined;

/** O que a abertura de uma delegação responde (Fase 9B), roteirizada por chave de step. */
export type ScriptedDelegation = (
  input: OpenDelegationInput,
) => { ok: true; child?: Partial<ChildRunView> } | { ok: false; code: string; detail: string };

export interface MemoryWorkflowStoreOptions {
  readonly runId: string;
  readonly harnessKey?: HarnessKey | undefined;
  readonly steps: readonly WorkflowStepDefinition[];
  readonly now?: (() => number) | undefined;
  /** As políticas `GATE`. Ausente, todo gate pausa como sempre. */
  readonly gatePolicy?: ScriptedGatePolicy | undefined;
  /** As recusas de delegação. Ausente, toda delegação abre um filho `QUEUED`. */
  readonly delegation?: ScriptedDelegation | undefined;
  /** Os orçamentos antes de cada passo. Ausente, nada estoura. */
  readonly budget?: (() => StepBudgetCheck) | undefined;
}

export interface MemoryWorkflowStore extends WorkflowStore {
  readonly runId: string;
  readonly events: RunEventPayload[];
  readonly gates: ApprovalGate[];
  readonly harnessSessionIds: string[];
  /** Os Runs filhos abertos, por chave de step (Fase 9B). */
  readonly children: Map<string, ChildRunView>;
  /** Os pedidos de delegação recebidos, na ordem. */
  readonly delegations: OpenDelegationInput[];
  runStatus: RunStatus;
  cancelRequested: boolean;
  /** O que a API faria: CAS no gate, step assentado, Run de volta à fila. */
  resolveGate(gateKey: string, decision: ApprovalDecision, note?: string): ApprovalGate;
  /**
   * O que o desfecho do filho faria no banco (Fase 9B): grava o desfecho e,
   * se o Run mãe está em `WAITING_CHILD` por este step, o devolve a `QUEUED`.
   * O step continua `WAITING_CHILD`: quem o assenta é o runner.
   */
  settleChild(stepKey: string, patch: Partial<ChildRunView>): ChildRunView;
  step(key: string): RunStep;
  /** Força um estado, para montar cenários de restart. */
  seedStep(key: string, patch: Partial<RunStep>): void;
  /** Quantas transições foram pedidas por chave de step. */
  transitionsFor(key: string): TransitionRunStepInput[];
}

export function createMemoryWorkflowStore(
  options: MemoryWorkflowStoreOptions,
): MemoryWorkflowStore {
  const now = options.now ?? (() => Date.now());
  const harnessKey = options.harnessKey ?? "CLAUDE_CODE";
  const order = topologicalOrder(options.steps);
  const ordered = order.ok
    ? order.order
        .map((key) => options.steps.find((step) => step.key === key)!)
        .filter((step) => step !== undefined)
    : [...options.steps];

  const steps = new Map<string, RunStep>();
  ordered.forEach((definition, position) => {
    const iso = new Date(now()).toISOString();
    steps.set(definition.key, {
      id: fakeUuid(),
      runId: options.runId,
      workflowStepId: fakeUuid(),
      key: definition.key,
      name: definition.name,
      type: definition.type,
      position,
      status: "PENDING",
      attempt: 0,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      createdAt: iso,
      updatedAt: iso,
    });
  });

  const events: RunEventPayload[] = [];
  const gates: ApprovalGate[] = [];
  const harnessSessionIds: string[] = [];
  const children = new Map<string, ChildRunView>();
  const delegations: OpenDelegationInput[] = [];
  const transitions = new Map<string, TransitionRunStepInput[]>();

  const clone = (step: RunStep): RunStep => structuredClone(step);

  const moveRun = (to: RunStatus): void => {
    const check = checkRunTransition(store.runStatus, to);
    if (!check.ok) {
      throw new Error(`O Run em memória recusou ${store.runStatus} → ${to}.`);
    }
    store.runStatus = to;
  };

  const applyTransition = (input: TransitionRunStepInput): RunStepTransitionOutcome => {
    transitions.set(input.stepKey, [...(transitions.get(input.stepKey) ?? []), input]);

    const current = steps.get(input.stepKey);
    if (current === undefined) return { ok: false, code: "RUN_STEP_NOT_FOUND" };

    const check = checkRunStepTransition(input.from, input.to);
    if (!check.ok) {
      return { ok: false, code: "RUN_STEP_TRANSITION_REJECTED", from: input.from, to: input.to };
    }
    if (current.status !== input.from) {
      return { ok: false, code: "RUN_STEP_STATUS_CHANGED", current: clone(current) };
    }

    const iso = new Date(now()).toISOString();
    const patch = input.patch ?? {};
    const next: RunStep = {
      ...current,
      status: input.to,
      attempt: input.incrementAttempt === true ? current.attempt + 1 : current.attempt,
      startedAt: input.to === "RUNNING" ? (current.startedAt ?? iso) : current.startedAt,
      finishedAt: isTerminalRunStepStatus(input.to) ? iso : current.finishedAt,
      result: patch.result === undefined ? current.result : structuredClone(patch.result),
      error: patch.error === undefined ? current.error : structuredClone(patch.error),
      updatedAt: iso,
    };
    steps.set(input.stepKey, next);
    return { ok: true, step: clone(next) };
  };

  const store: MemoryWorkflowStore = {
    runId: options.runId,
    events,
    gates,
    harnessSessionIds,
    children,
    delegations,
    runStatus: "RUNNING",
    cancelRequested: false,

    listRunSteps: () =>
      Promise.resolve([...steps.values()].sort((a, b) => a.position - b.position).map(clone)),

    transitionRunStep: (input) => Promise.resolve(applyTransition(input)),

    createApprovalGate: (input: CreateApprovalGateInput): Promise<ApprovalGateOutcome> => {
      const existing = gates.find((gate) => gate.gateKey === input.gateKey);
      if (existing !== undefined) {
        return Promise.resolve({ ok: true, gate: structuredClone(existing), created: false });
      }
      const step = steps.get(input.stepKey);
      if (step === undefined) {
        return Promise.resolve({ ok: false, code: "RUN_STEP_NOT_FOUND", detail: input.stepKey });
      }
      if (store.runStatus !== "RUNNING") {
        return Promise.resolve({
          ok: false,
          code: "RUN_WRITE_REJECTED",
          detail: `Run em ${store.runStatus}`,
        });
      }

      // A política de gate (Fase 9B), como o banco faz: o gate nasce decidido,
      // com os eventos de auditoria, e nem o step nem o Run se movem.
      const politica = options.gatePolicy?.({ gateKey: input.gateKey, stepKey: input.stepKey });
      if (politica !== undefined) {
        const iso = new Date(now()).toISOString();
        const reason =
          politica.reason ??
          `A política (${politica.policyId}) casou e ${politica.action === "DENY" ? "recusa" : "autoriza"}.`;
        const decidido: ApprovalGate = {
          id: fakeUuid(),
          runId: options.runId,
          runStepId: step.id,
          gateKey: input.gateKey,
          title: input.title,
          description: input.description ?? null,
          status: politica.action === "AUTO_APPROVE" ? "GRANTED" : "REJECTED",
          requestedAt: iso,
          resolvedAt: iso,
          note: reason,
        };
        gates.push(decidido);
        events.push({
          type: "ApprovalRequested",
          timestamp: iso,
          harness: harnessKey,
          approvalKey: decidido.gateKey,
          summary: decidido.title,
          gateId: decidido.id,
          stepKey: step.key,
        });
        const base = {
          timestamp: iso,
          gateId: decidido.id,
          gateKey: decidido.gateKey,
          runStepId: step.id,
          stepKey: step.key,
          decidedBy: politica.policyId,
          note: reason,
          reason,
        };
        events.push(
          politica.action === "AUTO_APPROVE"
            ? { type: "ApprovalGranted", ...base, grantedBy: `POLICY:${politica.policyId}` }
            : { type: "ApprovalRejected", ...base, rejectedBy: `POLICY:${politica.policyId}` },
        );
        const decision: PolicyDecision = {
          subject: "GATE",
          action: politica.action,
          policyId: politica.policyId,
          policyAction: politica.action,
          decidedBy: `POLICY:${politica.policyId}`,
          autonomyLevel: 3,
          reason,
          decidedAt: iso,
        };
        return Promise.resolve({
          ok: true,
          gate: structuredClone(decidido),
          created: true,
          policyDecision: decision,
        });
      }

      const moved = applyTransition({
        stepKey: input.stepKey,
        from: step.status,
        to: "WAITING_APPROVAL",
      });
      if (!moved.ok) {
        return Promise.resolve({
          ok: false,
          code: "RUN_STEP_WRITE_REJECTED",
          detail: JSON.stringify(moved),
        });
      }
      store.runStatus = "WAITING_APPROVAL";
      const gate: ApprovalGate = {
        id: fakeUuid(),
        runId: options.runId,
        runStepId: step.id,
        gateKey: input.gateKey,
        title: input.title,
        description: input.description ?? null,
        status: "PENDING",
        requestedAt: new Date(now()).toISOString(),
        resolvedAt: null,
        note: null,
      };
      gates.push(gate);
      const requested: ApprovalRequestedEvent = {
        type: "ApprovalRequested",
        timestamp: gate.requestedAt,
        harness: harnessKey,
        approvalKey: gate.gateKey,
        summary: gate.title,
        gateId: gate.id,
        stepKey: step.key,
      };
      events.push(requested);
      return Promise.resolve({ ok: true, gate: structuredClone(gate), created: true });
    },

    openDelegation: (input: OpenDelegationInput): Promise<DelegationOutcome> => {
      delegations.push(structuredClone(input));
      const existente = children.get(input.stepKey);
      if (existente !== undefined) {
        return Promise.resolve({ ok: true, child: structuredClone(existente), created: false });
      }
      const step = steps.get(input.stepKey);
      if (step === undefined) {
        return Promise.resolve({ ok: false, code: "RUN_STEP_NOT_FOUND", detail: input.stepKey });
      }
      if (store.runStatus !== "RUNNING" || step.status !== "RUNNING") {
        return Promise.resolve({
          ok: false,
          code: "PARENT_NOT_RUNNING",
          detail: `Run em ${store.runStatus}, step em ${step.status}`,
        });
      }
      const roteiro = options.delegation?.(input) ?? { ok: true };
      if (!roteiro.ok) return Promise.resolve(roteiro);

      const iso = new Date(now()).toISOString();
      const child: ChildRunView = {
        id: fakeUuid(),
        taskId: fakeUuid(),
        status: "QUEUED",
        loadoutName: input.loadoutRef,
        resultStatus: null,
        summary: null,
        usage: null,
        error: null,
        ...roteiro.child,
      };
      children.set(input.stepKey, child);
      const moved = applyTransition({
        stepKey: input.stepKey,
        from: "RUNNING",
        to: "WAITING_CHILD",
      });
      if (!moved.ok) throw new Error(`O step recusou a espera: ${JSON.stringify(moved)}`);
      moveRun("WAITING_CHILD");
      events.push({
        type: "Diagnostic",
        timestamp: iso,
        harness: harnessKey,
        level: "INFO",
        source: "RUNTIME",
        code: "DELEGATION_STARTED",
        message: `Passo ${input.stepKey} delegou ao Run filho ${child.id}.`,
      });
      return Promise.resolve({ ok: true, child: structuredClone(child), created: true });
    },

    findChildRun: (stepKey) => {
      const child = children.get(stepKey);
      return Promise.resolve(child === undefined ? null : structuredClone(child));
    },

    checkStepBudget: () => Promise.resolve(options.budget?.() ?? { blocked: null, warnings: [] }),

    isCancelRequested: () => Promise.resolve(store.cancelRequested),

    appendEvent: (event) => {
      events.push(structuredClone(event));
      return Promise.resolve();
    },

    recordHarnessSession: (id) => {
      harnessSessionIds.push(id);
      return Promise.resolve();
    },

    resolveGate: (gateKey, decision, note) => {
      const gate = gates.find((item) => item.gateKey === gateKey);
      if (gate === undefined) throw new Error(`Não há gate ${gateKey}.`);
      if (gate.status !== "PENDING") throw new Error(`O gate ${gateKey} já foi decidido.`);
      if (store.runStatus !== "WAITING_APPROVAL") {
        throw new Error(`RUN_NOT_WAITING_APPROVAL: o Run está em ${store.runStatus}.`);
      }
      const step = [...steps.values()].find((item) => item.id === gate.runStepId);
      if (step === undefined) throw new Error("O step do gate sumiu.");

      const iso = new Date(now()).toISOString();
      const index = gates.indexOf(gate);
      const resolved: ApprovalGate = {
        ...gate,
        status: decision === "approve" ? "GRANTED" : "REJECTED",
        resolvedAt: iso,
        note: note ?? null,
      };
      gates[index] = resolved;

      const moved = applyTransition({
        stepKey: step.key,
        from: "WAITING_APPROVAL",
        to: decision === "approve" ? "SUCCEEDED" : "FAILED",
        patch: {
          result: {
            kind: "approval",
            gateId: gate.id,
            decision,
            note: resolved.note,
            resolvedAt: iso,
          },
          error:
            decision === "approve"
              ? null
              : {
                  code: "APPROVAL_REJECTED",
                  message:
                    resolved.note === null
                      ? `O gate "${gate.gateKey}" foi recusado.`
                      : `O gate "${gate.gateKey}" foi recusado: ${resolved.note}`,
                },
        },
      });
      if (!moved.ok) throw new Error(`O step recusou o desfecho do gate: ${JSON.stringify(moved)}`);

      store.runStatus = "QUEUED";
      const base = {
        timestamp: iso,
        gateId: gate.id,
        gateKey: gate.gateKey,
        runStepId: step.id,
        stepKey: step.key,
        decidedBy: "01996d00-0000-7000-8000-000000000001",
        note: resolved.note,
      };
      events.push(
        decision === "approve"
          ? { type: "ApprovalGranted", ...base, grantedBy: "USER" }
          : { type: "ApprovalRejected", ...base, rejectedBy: "USER" },
      );
      events.push({
        type: "StepFinished",
        timestamp: iso,
        runStepId: step.id,
        stepKey: step.key,
        status: moved.step.status,
        attempt: Math.max(moved.step.attempt, 1),
        summary: decision === "approve" ? `Aprovado: ${gate.title}` : `Recusado: ${gate.title}`,
      });
      return structuredClone(resolved);
    },

    settleChild: (stepKey, patch) => {
      const child = children.get(stepKey);
      if (child === undefined) throw new Error(`Não há filho para o step ${stepKey}.`);
      const settled: ChildRunView = { ...child, ...patch };
      children.set(stepKey, settled);
      const step = steps.get(stepKey);
      if (
        isTerminalRunStatus(settled.status) &&
        store.runStatus === "WAITING_CHILD" &&
        step?.status === "WAITING_CHILD"
      ) {
        moveRun("QUEUED");
        events.push({
          type: "Diagnostic",
          timestamp: new Date(now()).toISOString(),
          harness: harnessKey,
          level: "INFO",
          source: "RUNTIME",
          code: "DELEGATION_FINISHED",
          message: `O Run filho ${settled.id} terminou em ${settled.status}; o Run volta à fila.`,
        });
      }
      return structuredClone(settled);
    },

    step: (key) => {
      const step = steps.get(key);
      if (step === undefined) throw new Error(`Não há step ${key}.`);
      return clone(step);
    },

    seedStep: (key, patch) => {
      const step = steps.get(key);
      if (step === undefined) throw new Error(`Não há step ${key}.`);
      steps.set(key, { ...step, ...patch });
    },

    transitionsFor: (key) => transitions.get(key) ?? [],
  };

  return store;
}

/** O mapa `chave → status`, para asserções curtas. */
export function statusesOf(steps: readonly RunStep[]): Record<string, RunStepStatus> {
  return Object.fromEntries(steps.map((step) => [step.key, step.status]));
}
