import type {
  ApprovalDecision,
  ApprovalGateStatus,
  RunStepStatus,
  StepSkipReason,
  WorkflowStepType,
} from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";
import {
  BookOpen,
  ClipboardCheck,
  ShieldCheck,
  ShieldHalf,
  ShieldX,
  Terminal,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/**
 * A ponte entre os enums do Workflow e o que a tela mostra (Fase 4C).
 *
 * Mesma disciplina de `lib/execution-domain.ts`: nenhum label escrito, só
 * **chaves** de glossário resolvidas no ponto de render, e todo mapa é um
 * `Record<Enum, …>` para que um valor novo no contrato vire erro de compilação
 * em vez de `undefined` numa lista.
 */

const ACCENT_BLUE = "var(--accent-blue)";
const ACCENT_VIOLET = "var(--accent-violet)";
const ACCENT_AMBER = "var(--accent-amber)";
const ACCENT_GREEN = "var(--accent-green)";

/* --------------------------------------------------------- runStep.status */

interface RunStepStatusPresentation {
  readonly label: GlossaryKey;
  readonly dot: string;
  /** Ainda não começou, foi pulado ou cancelado: o texto vai em `muted-foreground`. */
  readonly dim: boolean;
  /** O ponto pulsa enquanto o estado é transitório. */
  readonly pulse: boolean;
}

export const RUN_STEP_STATUS: Record<RunStepStatus, RunStepStatusPresentation> = {
  PENDING: {
    label: "runStep.status.pending",
    dot: "var(--muted-foreground)",
    dim: true,
    pulse: false,
  },
  RUNNING: { label: "runStep.status.running", dot: ACCENT_BLUE, dim: false, pulse: true },
  WAITING_APPROVAL: {
    label: "runStep.status.waitingApproval",
    dot: ACCENT_AMBER,
    dim: false,
    pulse: true,
  },
  SUCCEEDED: { label: "runStep.status.succeeded", dot: ACCENT_GREEN, dim: false, pulse: false },
  FAILED: { label: "runStep.status.failed", dot: "var(--destructive)", dim: false, pulse: false },
  SKIPPED: {
    label: "runStep.status.skipped",
    dot: "var(--muted-foreground)",
    dim: true,
    pulse: false,
  },
  TIMED_OUT: { label: "runStep.status.timedOut", dot: ACCENT_AMBER, dim: false, pulse: false },
  CANCELLED: {
    label: "runStep.status.cancelled",
    dot: "var(--muted-foreground)",
    dim: true,
    pulse: false,
  },
};

export const RUN_STEP_STATUSES = Object.keys(RUN_STEP_STATUS) as readonly RunStepStatus[];

export function isRunStepStatus(value: unknown): value is RunStepStatus {
  return typeof value === "string" && (RUN_STEP_STATUSES as readonly string[]).includes(value);
}

/* ------------------------------------------------------ workflowStep.type */

interface StepTypePresentation {
  readonly label: GlossaryKey;
  readonly icon: LucideIcon;
  readonly color: string;
}

export const WORKFLOW_STEP_TYPE: Record<WorkflowStepType, StepTypePresentation> = {
  agent: { label: "workflowStep.type.agent", icon: UserRound, color: ACCENT_VIOLET },
  command: { label: "workflowStep.type.command", icon: Terminal, color: ACCENT_BLUE },
  validation: { label: "workflowStep.type.validation", icon: ClipboardCheck, color: ACCENT_GREEN },
  approval: { label: "workflowStep.type.approval", icon: ShieldHalf, color: ACCENT_AMBER },
  knowledge: { label: "workflowStep.type.knowledge", icon: BookOpen, color: ACCENT_AMBER },
};

export const WORKFLOW_STEP_TYPES = Object.keys(WORKFLOW_STEP_TYPE) as readonly WorkflowStepType[];

export function isWorkflowStepType(value: unknown): value is WorkflowStepType {
  return typeof value === "string" && (WORKFLOW_STEP_TYPES as readonly string[]).includes(value);
}

/* --------------------------------------------------------- approval.status */

interface GateStatusPresentation {
  readonly label: GlossaryKey;
  readonly dot: string;
  readonly pulse: boolean;
}

export const APPROVAL_GATE_STATUS: Record<ApprovalGateStatus, GateStatusPresentation> = {
  PENDING: { label: "approval.status.pending", dot: ACCENT_AMBER, pulse: true },
  GRANTED: { label: "approval.status.granted", dot: ACCENT_GREEN, pulse: false },
  REJECTED: { label: "approval.status.rejected", dot: "var(--destructive)", pulse: false },
};

/* ------------------------------------------------------- approval.decision */

interface DecisionPresentation {
  readonly label: GlossaryKey;
  readonly confirmTitle: GlossaryKey;
  readonly confirmBody: GlossaryKey;
  readonly icon: LucideIcon;
  /** A cor do botão e do ícone: verde para conceder, o destrutivo para negar. */
  readonly color: string;
}

export const APPROVAL_DECISION: Record<ApprovalDecision, DecisionPresentation> = {
  approve: {
    label: "approval.decision.approve",
    confirmTitle: "approval.confirm.approve.title",
    confirmBody: "approval.confirm.approve.body",
    icon: ShieldCheck,
    color: ACCENT_GREEN,
  },
  reject: {
    label: "approval.decision.reject",
    confirmTitle: "approval.confirm.reject.title",
    confirmBody: "approval.confirm.reject.body",
    icon: ShieldX,
    color: "var(--destructive)",
  },
};

/* --------------------------------------------------------- runStep.skip */

export const STEP_SKIP_REASON: Record<StepSkipReason["code"], GlossaryKey> = {
  PREDICATE_FALSE: "runStep.skip.predicateFalse",
  DEPENDENCY_NOT_SUCCEEDED: "runStep.skip.dependencyNotSucceeded",
};

export function isStepSkipReasonCode(value: unknown): value is StepSkipReason["code"] {
  return typeof value === "string" && Object.hasOwn(STEP_SKIP_REASON, value);
}
