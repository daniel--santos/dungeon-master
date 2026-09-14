import type {
  AutomationKind,
  AutonomyLevel,
  BreakerScope,
  BreakerState,
  BudgetAction,
  BudgetLimitKey,
  BudgetScope,
  BudgetWindow,
  PolicyAction,
  PolicySubject,
  RoutingKind,
  RuleConditionKey,
  RunCreatedBy,
  TaskCreatedBy,
} from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";
import {
  Bot,
  Gavel,
  Landmark,
  ScrollText,
  ShieldHalf,
  Signpost,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import type {
  ApprovalPolicyRecord,
  BudgetUsageRecord,
  CircuitBreakerRecord,
  ProjectAutonomyRecord,
  RuleConditionsRecord,
} from "@/lib/api-types";
import { ENFORCEMENT_LEVELS } from "@/lib/execution-domain";
import { TASK_KINDS, TASK_PRIORITIES } from "@/lib/domain";

/**
 * A ponte entre os enums da autonomia controlada (Fase 9A) e o que a tela
 * mostra (Fase 9C).
 *
 * Mesma disciplina de `lib/execution-domain.ts`: nenhum label escrito, só
 * **chaves** de glossário resolvidas no ponto de render, e todo mapa é um
 * `Record<Enum, …>` para que um valor novo no contrato vire erro de
 * compilação em vez de uma linha sem nome.
 */

/** A cor da autonomia em toda a interface: um verde-azulado no eixo dos acentos. */
export const AUTONOMY_COLOR = "oklch(0.72 0.13 195)";
const ACCENT_GREEN = "oklch(0.72 0.13 150)";
const ACCENT_AMBER = "oklch(0.72 0.13 75)";
const ACCENT_BLUE = "oklch(0.72 0.13 250)";

/* --------------------------------------------------------- autonomy.level */

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [0, 1, 2, 3, 4];

interface AutonomyLevelPresentation {
  readonly label: GlossaryKey;
  readonly description: GlossaryKey;
}

export const AUTONOMY_LEVEL: Record<AutonomyLevel, AutonomyLevelPresentation> = {
  0: { label: "autonomy.level.manual", description: "autonomy.level.manual.description" },
  1: { label: "autonomy.level.suggest", description: "autonomy.level.suggest.description" },
  2: { label: "autonomy.level.propose", description: "autonomy.level.propose.description" },
  3: { label: "autonomy.level.policies", description: "autonomy.level.policies.description" },
  4: { label: "autonomy.level.delegate", description: "autonomy.level.delegate.description" },
};

export const AUTOMATION_KIND: Record<AutomationKind, GlossaryKey> = {
  SUGGEST: "autonomy.automation.suggest",
  AUTO_APPROVE_PROPOSAL: "autonomy.automation.autoApproveProposal",
  AUTO_APPROVE_GATE: "autonomy.automation.autoApproveGate",
  AUTO_DISPATCH: "autonomy.automation.autoDispatch",
  DELEGATE: "autonomy.automation.delegate",
};

export const AUTOMATION_KINDS = Object.keys(AUTOMATION_KIND) as readonly AutomationKind[];

/**
 * Uma cópia da escada de `packages/domain` (`AUTONOMY_MINIMUM_LEVEL`), em leitura.
 *
 * A web não importa o domínio (fronteira do ESLint), e o servidor continua
 * sendo a autoridade: o que o nível **atual** libera vem em
 * `ProjectAutonomy.allows`, e esta tabela só existe para o diálogo de
 * confirmação dizer o que um nível **ainda não escolhido** vai liberar.
 */
const AUTONOMY_MINIMUM_LEVEL: Record<AutomationKind, AutonomyLevel> = {
  SUGGEST: 1,
  AUTO_APPROVE_PROPOSAL: 3,
  AUTO_APPROVE_GATE: 3,
  AUTO_DISPATCH: 3,
  DELEGATE: 4,
};

/** As automações que um nível libera, na ordem da escada. */
export function automationsAllowedAt(level: AutonomyLevel): readonly AutomationKind[] {
  return AUTOMATION_KINDS.filter((kind) => level >= AUTONOMY_MINIMUM_LEVEL[kind]);
}

/** O que `to` libera e `from` não liberava: o texto do diálogo de confirmação. */
export function automationsGained(
  from: AutonomyLevel,
  to: AutonomyLevel,
): readonly AutomationKind[] {
  return automationsAllowedAt(to).filter((kind) => from < AUTONOMY_MINIMUM_LEVEL[kind]);
}

/** A partir deste nível, subir pede confirmação: é onde o sistema começa a decidir sozinho. */
export const AUTONOMY_CONFIRM_FROM: AutonomyLevel = 3;

export function needsAutonomyConfirmation(from: AutonomyLevel, to: AutonomyLevel): boolean {
  return to > from && to >= AUTONOMY_CONFIRM_FROM;
}

/* ----------------------------------------------------------------- policy */

export const POLICY_SUBJECT: Record<PolicySubject, GlossaryKey> = {
  PROPOSAL: "policy.subject.proposal",
  RUN_START: "policy.subject.runStart",
  GATE: "policy.subject.gate",
};

export const POLICY_SUBJECTS = Object.keys(POLICY_SUBJECT) as readonly PolicySubject[];

interface PolicyActionPresentation {
  readonly label: GlossaryKey;
  readonly color: string;
}

export const POLICY_ACTION: Record<PolicyAction, PolicyActionPresentation> = {
  REQUIRE_APPROVAL: { label: "policy.action.requireApproval", color: ACCENT_AMBER },
  AUTO_APPROVE: { label: "policy.action.autoApprove", color: ACCENT_GREEN },
  DENY: { label: "policy.action.deny", color: "var(--destructive)" },
};

export const POLICY_ACTIONS = Object.keys(POLICY_ACTION) as readonly PolicyAction[];

/** O assunto de uma política e a automação que o nível precisa liberar para ela valer. */
export const AUTOMATION_FOR_SUBJECT: Record<PolicySubject, AutomationKind> = {
  PROPOSAL: "AUTO_APPROVE_PROPOSAL",
  RUN_START: "AUTO_DISPATCH",
  GATE: "AUTO_APPROVE_GATE",
};

/**
 * Uma política `AUTO_APPROVE` que o nível do Project não libera é inerte: a
 * decisão vira revisão humana, e a tela precisa dizer isso onde ela aparece
 * (fail-closed visível). `allows` vem da API, que é a verdade do domínio.
 */
export function isPolicyInert(
  policy: Pick<ApprovalPolicyRecord, "action" | "subject">,
  allows: ProjectAutonomyRecord["allows"] | undefined,
): boolean {
  if (policy.action !== "AUTO_APPROVE" || allows === undefined) return false;
  return !allows[AUTOMATION_FOR_SUBJECT[policy.subject]];
}

/* -------------------------------------------------------------- condition */

/** Uma condição de lista aceita um valor ou vários ("qualquer um destes"). */
export type ConditionShape = "list" | "boolean" | "number" | "loadout" | "project";

interface ConditionPresentation {
  readonly label: GlossaryKey;
  readonly shape: ConditionShape;
  /** As opções de uma condição de lista, na ordem do contrato. */
  readonly options: readonly string[];
}

const HARNESS_KEYS = ["CLAUDE_CODE", "CODEX", "PI", "ANTIGRAVITY"] as const;
const EXECUTION_MODES = ["HOST", "DOCKER"] as const;
const STEP_TYPES = ["agent", "command", "validation", "approval", "knowledge"] as const;

export const RULE_CONDITION: Record<RuleConditionKey, ConditionPresentation> = {
  executionMode: { label: "condition.executionMode", shape: "list", options: EXECUTION_MODES },
  harnessKey: { label: "condition.harnessKey", shape: "list", options: HARNESS_KEYS },
  taskKind: { label: "condition.taskKind", shape: "list", options: TASK_KINDS },
  taskPriority: { label: "condition.taskPriority", shape: "list", options: TASK_PRIORITIES },
  hasCommandTools: { label: "condition.hasCommandTools", shape: "boolean", options: [] },
  enforcement: { label: "condition.enforcement", shape: "list", options: ENFORCEMENT_LEVELS },
  stepType: { label: "condition.stepType", shape: "list", options: STEP_TYPES },
  maxEstimatedTokens: { label: "condition.maxEstimatedTokens", shape: "number", options: [] },
  loadoutId: { label: "condition.loadoutId", shape: "loadout", options: [] },
  projectId: { label: "condition.projectId", shape: "project", options: [] },
  minBudgetPressure: { label: "condition.minBudgetPressure", shape: "number", options: [] },
};

export const RULE_CONDITION_KEYS = Object.keys(RULE_CONDITION) as readonly RuleConditionKey[];

/** Os valores de uma condição, sempre como lista: um valor único vira lista de um. */
export function conditionValues(
  conditions: RuleConditionsRecord,
  key: RuleConditionKey,
): readonly string[] {
  const value = conditions[key];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/** As condições presentes numa regra, na ordem do contrato. */
export function presentConditions(conditions: RuleConditionsRecord): readonly RuleConditionKey[] {
  return RULE_CONDITION_KEYS.filter((key) => conditions[key] !== undefined);
}

/* ----------------------------------------------------------------- budget */

export const BUDGET_SCOPE: Record<BudgetScope, GlossaryKey> = {
  GLOBAL: "budget.scope.global",
  PROJECT: "budget.scope.project",
  LOADOUT: "budget.scope.loadout",
};

export const BUDGET_SCOPES = Object.keys(BUDGET_SCOPE) as readonly BudgetScope[];

export const BUDGET_WINDOW: Record<BudgetWindow, GlossaryKey> = {
  DAY: "budget.window.day",
  WEEK: "budget.window.week",
  MONTH: "budget.window.month",
  PER_RUN: "budget.window.perRun",
};

export const BUDGET_WINDOWS = Object.keys(BUDGET_WINDOW) as readonly BudgetWindow[];

export const BUDGET_ACTION: Record<BudgetAction, GlossaryKey> = {
  BLOCK: "budget.action.block",
  WARN: "budget.action.warn",
};

export const BUDGET_ACTIONS = Object.keys(BUDGET_ACTION) as readonly BudgetAction[];

export const BUDGET_LIMIT_KEY: Record<BudgetLimitKey, GlossaryKey> = {
  maxTokens: "budget.limit.maxTokens",
  maxRuns: "budget.limit.maxRuns",
  maxWallClockMs: "budget.limit.maxWallClockMs",
  maxConcurrentRuns: "budget.limit.maxConcurrentRuns",
};

export const BUDGET_LIMIT_KEYS = Object.keys(BUDGET_LIMIT_KEY) as readonly BudgetLimitKey[];

/** Os tetos que uma janela aceita: `PER_RUN` só mede tokens e tempo. */
export function limitKeysFor(window: BudgetWindow): readonly BudgetLimitKey[] {
  return window === "PER_RUN" ? ["maxTokens", "maxWallClockMs"] : BUDGET_LIMIT_KEYS;
}

/** O consumo medido que corresponde a cada teto. */
export function usageValue(usage: BudgetUsageRecord, key: BudgetLimitKey): number {
  switch (key) {
    case "maxTokens":
      return usage.tokens;
    case "maxRuns":
      return usage.runs;
    case "maxWallClockMs":
      return usage.wallClockMs;
    case "maxConcurrentRuns":
      return usage.concurrentRuns;
  }
}

/**
 * A cor da pressão: verde longe do teto, âmbar a partir de 80%, a cor de
 * destruição no teto ou além. `0.8` é o mesmo limiar que uma regra
 * `minBudgetPressure` costuma usar para trocar de Model.
 */
export function pressureColor(pressure: number): string {
  if (pressure >= 1) return "var(--destructive)";
  if (pressure >= 0.8) return ACCENT_AMBER;
  return ACCENT_GREEN;
}

const NUMBER = new Intl.NumberFormat("pt-BR");

/** Um teto ou consumo, no formato do que ele mede: tempo em `h:mm:ss`, o resto em número. */
export function formatLimitValue(key: BudgetLimitKey, value: number): string {
  if (key === "maxWallClockMs") {
    const total = Math.floor(value / 1000);
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${String(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return NUMBER.format(value);
}

/* ---------------------------------------------------------------- breaker */

export const BREAKER_SCOPE: Record<BreakerScope, GlossaryKey> = {
  PROJECT: "breaker.scope.project",
  LOADOUT: "breaker.scope.loadout",
  HARNESS: "breaker.scope.harness",
};

export const BREAKER_SCOPES = Object.keys(BREAKER_SCOPE) as readonly BreakerScope[];

interface BreakerStatePresentation {
  readonly label: GlossaryKey;
  readonly dot: string;
  readonly pulse: boolean;
}

export const BREAKER_STATE: Record<BreakerState, BreakerStatePresentation> = {
  CLOSED: { label: "breaker.state.closed", dot: ACCENT_GREEN, pulse: false },
  OPEN: { label: "breaker.state.open", dot: "var(--destructive)", pulse: false },
  HALF_OPEN: { label: "breaker.state.halfOpen", dot: ACCENT_AMBER, pulse: true },
};

/** Quando um disjuntor `OPEN` volta a sondar: `openedAt` mais o cooldown. */
export function breakerReopensAt(
  breaker: Pick<CircuitBreakerRecord, "state" | "openedAt" | "cooldownMs">,
): string | null {
  if (breaker.state !== "OPEN" || breaker.openedAt === null) return null;
  const opened = new Date(breaker.openedAt).getTime();
  if (Number.isNaN(opened)) return null;
  return new Date(opened + breaker.cooldownMs).toISOString();
}

/* ---------------------------------------------------------------- routing */

export const ROUTING_KIND: Record<RoutingKind, GlossaryKey> = {
  MODEL: "routing.kind.model",
  LOADOUT: "routing.kind.loadout",
  WORKFLOW: "routing.kind.workflow",
};

export const ROUTING_KINDS = Object.keys(ROUTING_KIND) as readonly RoutingKind[];

/* ----------------------------------------------------------------- origin */

interface OriginPresentation {
  readonly label: GlossaryKey;
  readonly icon: LucideIcon;
}

export const RUN_CREATED_BY: Record<RunCreatedBy, OriginPresentation> = {
  USER: { label: "run.origin.user", icon: UserRound },
  POLICY: { label: "run.origin.policy", icon: ScrollText },
  DELEGATION: { label: "run.origin.delegation", icon: Bot },
};

export const RUN_CREATED_BY_VALUES = Object.keys(RUN_CREATED_BY) as readonly RunCreatedBy[];

export const TASK_CREATED_BY: Record<TaskCreatedBy, GlossaryKey> = {
  USER: "task.origin.user",
  PROPOSAL: "task.origin.proposal",
  POLICY: "task.origin.policy",
};

export const TASK_CREATED_BY_VALUES = Object.keys(TASK_CREATED_BY) as readonly TaskCreatedBy[];

/* -------------------------------------------------------------- decidedBy */

/**
 * Quem decidiu, decomposto do prefixo estável que o contrato fixa:
 * `POLICY:<id>`, `ROUTING:<id>`, `BUDGET:<id>`, `BREAKER:<id>`, `DEFAULT`,
 * `TIE:<id>,<id>`, `AUTONOMY:<nível>` e `RESET`.
 */
export type DecidedBy =
  | { readonly kind: "policy" | "routing" | "budget" | "breaker"; readonly id: string }
  | { readonly kind: "tie"; readonly ids: readonly string[] }
  | { readonly kind: "autonomy"; readonly level: string }
  | { readonly kind: "default" | "reset" | "unknown" };

export function parseDecidedBy(decidedBy: string): DecidedBy {
  const [prefix, rest] = decidedBy.split(":", 2) as [string, string | undefined];
  switch (prefix) {
    case "POLICY":
      return { kind: "policy", id: rest ?? "" };
    case "ROUTING":
      return { kind: "routing", id: rest ?? "" };
    case "BUDGET":
      return { kind: "budget", id: rest ?? "" };
    case "BREAKER":
      return { kind: "breaker", id: rest ?? "" };
    case "TIE":
      return { kind: "tie", ids: (rest ?? "").split(",").filter((id) => id !== "") };
    case "AUTONOMY":
      return { kind: "autonomy", level: rest ?? "" };
    case "DEFAULT":
      return { kind: "default" };
    case "RESET":
      return { kind: "reset" };
    default:
      return { kind: "unknown" };
  }
}

/** O ícone de quem decidiu, para a linha que nomeia a decisão. */
export const DECIDED_BY_ICON: Record<DecidedBy["kind"], LucideIcon> = {
  policy: ScrollText,
  routing: Signpost,
  budget: Landmark,
  breaker: ShieldHalf,
  tie: Gavel,
  autonomy: Gavel,
  default: Gavel,
  reset: Gavel,
  unknown: Gavel,
};

/* ------------------------------------------------------- modelSelectedBy */

export type ModelSelectedBy =
  | { readonly kind: "loadout" | "harnessDefault" | "none" }
  | { readonly kind: "routing"; readonly id: string };

/** `LOADOUT`, `HARNESS_DEFAULT`, `ROUTING:<id>` ou `NONE`, do snapshot do Run. */
export function parseModelSelectedBy(value: string | undefined): ModelSelectedBy | null {
  if (value === undefined) return null;
  if (value === "LOADOUT") return { kind: "loadout" };
  if (value === "HARNESS_DEFAULT") return { kind: "harnessDefault" };
  if (value === "NONE") return { kind: "none" };
  if (value.startsWith("ROUTING:")) return { kind: "routing", id: value.slice("ROUTING:".length) };
  return null;
}

/* ------------------------------------------------------------- diagnostic */

/** Os códigos de `Diagnostic` que a partida grava no diário (Fase 9A). */
export const AUTONOMY_DIAGNOSTIC_CODES = [
  "POLICY_DECIDED",
  "BUDGET_WARNED",
  "MODEL_ROUTED",
  "BREAKER_PROBE",
] as const;

export type AutonomyDiagnosticCode = (typeof AUTONOMY_DIAGNOSTIC_CODES)[number];

export const AUTONOMY_DIAGNOSTIC: Record<AutonomyDiagnosticCode, GlossaryKey> = {
  POLICY_DECIDED: "diagnostic.policyDecided",
  BUDGET_WARNED: "diagnostic.budgetWarned",
  MODEL_ROUTED: "diagnostic.modelRouted",
  BREAKER_PROBE: "diagnostic.breakerProbe",
};

export function isAutonomyDiagnosticCode(value: unknown): value is AutonomyDiagnosticCode {
  return (
    typeof value === "string" && (AUTONOMY_DIAGNOSTIC_CODES as readonly string[]).includes(value)
  );
}

/** A cor de um destaque do diário pelo código: o aviso de orçamento é âmbar, o resto é a cor da autonomia. */
export function diagnosticColor(code: AutonomyDiagnosticCode): string {
  return code === "BUDGET_WARNED"
    ? ACCENT_AMBER
    : code === "MODEL_ROUTED"
      ? ACCENT_BLUE
      : AUTONOMY_COLOR;
}
