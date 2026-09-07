import type {
  AgentRole,
  EnforcementLevel,
  ExecutionEventType,
  ExecutionMode,
  HarnessCapabilities,
  RunStatus,
  WorkspaceStrategy,
} from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";
import {
  BookOpen,
  CircleCheckBig,
  CircleStop,
  CircleX,
  Gauge,
  Hourglass,
  KeyRound,
  Package,
  Quote,
  ShieldHalf,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

/**
 * A ponte entre os enums de execução e o que a tela mostra.
 *
 * Vale aqui a mesma disciplina de `lib/domain.ts`: nenhum label escrito, só
 * **chaves** de glossário resolvidas no ponto de render, e todo mapa é um
 * `Record<Enum, …>` para que um valor novo no contrato vire erro de compilação
 * em vez de `undefined` numa tabela.
 */

/** A família de acentos do canvas: mesma luminosidade e croma, só o matiz muda. */
const ACCENT_BLUE = "oklch(0.72 0.13 250)";
const ACCENT_VIOLET = "oklch(0.72 0.13 305)";
const ACCENT_AMBER = "oklch(0.72 0.13 75)";
/** A Vitória precisava de um matiz próprio, no mesmo eixo (canvas da Fase 2). */
const ACCENT_GREEN = "oklch(0.72 0.13 150)";

/* ------------------------------------------------------------ run.status */

interface RunStatusPresentation {
  readonly label: GlossaryKey;
  /** A cor do ponto do chip. */
  readonly dot: string;
  /** Estado ainda não começado ou já esquecido: o texto vai em `muted-foreground`. */
  readonly dim: boolean;
  /** O ponto pulsa enquanto o estado é transitório. */
  readonly pulse: boolean;
}

export const RUN_STATUS: Record<RunStatus, RunStatusPresentation> = {
  CREATED: { label: "run.status.created", dot: "var(--muted-foreground)", dim: true, pulse: false },
  QUEUED: { label: "run.status.queued", dot: "var(--muted-foreground)", dim: true, pulse: false },
  PREPARING: {
    label: "run.status.preparing",
    dot: "var(--muted-foreground)",
    dim: true,
    pulse: true,
  },
  RUNNING: { label: "run.status.running", dot: ACCENT_BLUE, dim: false, pulse: true },
  WAITING_APPROVAL: {
    label: "run.status.waitingApproval",
    dot: ACCENT_AMBER,
    dim: false,
    pulse: true,
  },
  SUCCEEDED: { label: "run.status.succeeded", dot: ACCENT_GREEN, dim: false, pulse: false },
  FAILED: { label: "run.status.failed", dot: "var(--destructive)", dim: false, pulse: false },
  TIMED_OUT: { label: "run.status.timedOut", dot: ACCENT_AMBER, dim: false, pulse: false },
  CANCELLED: {
    label: "run.status.cancelled",
    dot: "var(--muted-foreground)",
    dim: true,
    pulse: false,
  },
};

export const RUN_STATUSES = Object.keys(RUN_STATUS) as readonly RunStatus[];

/** Os quatro estados terminais. Depois de um deles nada mais é escrito. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

/**
 * O Run ainda está de pé, então o cockpit segue o stream e oferece Cancelar.
 *
 * `CREATED` e `QUEUED` entram: cancelar ali é imediato, porque não há árvore de
 * processos a confirmar.
 */
export function isLiveRunStatus(status: RunStatus): boolean {
  return !isTerminalRunStatus(status);
}

/* --------------------------------------------------------------- ambiente */

interface ExecutionModePresentation {
  readonly label: GlossaryKey;
  /** O texto canônico que viaja com o nome em qualquer tema e qualquer tela. */
  readonly canonical: GlossaryKey;
  /** Só o modo host tem aviso, e ele nunca é omitido. */
  readonly warning: GlossaryKey | null;
}

/**
 * Segurança nunca é tematizada a ponto de sumir (planejamento v0.4, seção 14).
 *
 * O aviso e o texto canônico são chaves de glossário como o nome, e não texto
 * opcional de um componente: quem renderiza o modo host renderiza os três.
 */
export const EXECUTION_MODE: Record<ExecutionMode, ExecutionModePresentation> = {
  HOST: { label: "env.host", canonical: "env.host.canonical", warning: "env.host.warning" },
  DOCKER: { label: "env.docker", canonical: "env.docker.canonical", warning: null },
};

/* ------------------------------------------------------------ enforcement */

/**
 * O nível de barreira, e o identificador canônico que o cockpit mostra em
 * monoespaçada ao lado do label (documento técnico, seção 15).
 */
interface EnforcementPresentation {
  readonly label: GlossaryKey;
  readonly canonical: string;
  /** Âmbar quando a barreira não é nossa; cinza quando é só um pedido. */
  readonly className: string;
}

export const ENFORCEMENT: Record<EnforcementLevel, EnforcementPresentation> = {
  ADVISORY: {
    label: "enforcement.advisory",
    canonical: "advisory",
    className: "text-muted-foreground",
  },
  HARNESS_NATIVE: {
    label: "enforcement.harnessNative",
    canonical: "harness-native",
    className: "text-[oklch(0.72_0.13_75)]",
  },
  SANDBOX_ENFORCED: {
    label: "enforcement.sandboxEnforced",
    canonical: "sandbox-enforced",
    className: "text-[oklch(0.72_0.13_150)]",
  },
};

export const ENFORCEMENT_LEVELS = Object.keys(ENFORCEMENT) as readonly EnforcementLevel[];

/* ------------------------------------------------------ workspaceStrategy */

export const WORKSPACE_STRATEGY: Record<WorkspaceStrategy, GlossaryKey> = {
  CURRENT: "workspaceStrategy.current",
  GIT_WORKTREE: "workspaceStrategy.gitWorktree",
  COPY: "workspaceStrategy.copy",
};

export const WORKSPACE_STRATEGIES = Object.keys(WORKSPACE_STRATEGY) as readonly WorkspaceStrategy[];

/* ----------------------------------------------------------- agent.role */

export const AGENT_ROLE: Record<AgentRole, GlossaryKey> = {
  ARCHITECT: "agent.role.architect",
  ENGINEER: "agent.role.engineer",
  REVIEWER: "agent.role.reviewer",
  EXPLORER: "agent.role.explorer",
};

export const AGENT_ROLES = Object.keys(AGENT_ROLE) as readonly AgentRole[];

/* ------------------------------------------------- harness.capabilities */

/**
 * Os onze campos de `HarnessCapabilities`, na ordem do contrato.
 *
 * A lista é um `Record` sobre a interface inteira: um campo novo no contrato
 * quebra a compilação aqui, em vez de sumir em silêncio da tela de Guildas.
 */
export const HARNESS_CAPABILITY: Record<keyof HarnessCapabilities, GlossaryKey> = {
  streaming: "harness.capability.streaming",
  structuredOutput: "harness.capability.structuredOutput",
  resume: "harness.capability.resume",
  multiTurnProcess: "harness.capability.multiTurnProcess",
  toolEvents: "harness.capability.toolEvents",
  tokenUsage: "harness.capability.tokenUsage",
  modelSelection: "harness.capability.modelSelection",
  agentSelection: "harness.capability.agentSelection",
  nativePermissions: "harness.capability.nativePermissions",
  hostExecution: "harness.capability.hostExecution",
  dockerExecution: "harness.capability.dockerExecution",
};

export const HARNESS_CAPABILITY_KEYS = Object.keys(
  HARNESS_CAPABILITY,
) as readonly (keyof HarnessCapabilities)[];

/* --------------------------------------------------------- event types */

/**
 * Como cada tipo de `ExecutionEvent` aparece no Diário.
 *
 * `dim` são as linhas que existem para completar a história mas não a contam:
 * o resultado de uma chamada e o relatório de uso. Elas ficam menores e em
 * cinza, exatamente como no artboard de componente.
 */
export interface EventPresentation {
  readonly icon: LucideIcon;
  readonly color: string;
  readonly dim: boolean;
  readonly group: EventFilterId;
}

export const EXECUTION_EVENT: Record<ExecutionEventType, EventPresentation> = {
  RunStarted: { icon: BookOpen, color: ACCENT_BLUE, dim: false, group: "system" },
  TextDelta: { icon: Quote, color: "var(--foreground)", dim: false, group: "text" },
  ToolCall: { icon: Terminal, color: ACCENT_VIOLET, dim: false, group: "tools" },
  ToolResult: { icon: CircleCheckBig, color: "var(--muted-foreground)", dim: true, group: "tools" },
  Artifact: { icon: Package, color: ACCENT_AMBER, dim: false, group: "system" },
  Usage: { icon: Gauge, color: "var(--muted-foreground)", dim: true, group: "usage" },
  Diagnostic: { icon: TriangleAlert, color: ACCENT_AMBER, dim: false, group: "diagnostic" },
  ApprovalRequested: { icon: ShieldHalf, color: ACCENT_AMBER, dim: false, group: "system" },
  SessionCaptured: { icon: KeyRound, color: "var(--muted-foreground)", dim: true, group: "system" },
  RunCompleted: { icon: CircleCheckBig, color: ACCENT_GREEN, dim: false, group: "system" },
  RunFailed: { icon: CircleX, color: "var(--destructive)", dim: false, group: "system" },
  RunTimedOut: { icon: Hourglass, color: ACCENT_AMBER, dim: false, group: "system" },
  RunCancelled: { icon: CircleStop, color: "var(--muted-foreground)", dim: true, group: "system" },
};

/** Um tipo que o worker emitiu e esta versão da web ainda não conhece. */
export const UNKNOWN_EVENT: EventPresentation = {
  icon: TriangleAlert,
  color: "var(--muted-foreground)",
  dim: true,
  group: "system",
};

export function eventPresentation(type: string): EventPresentation {
  return (EXECUTION_EVENT as Record<string, EventPresentation | undefined>)[type] ?? UNKNOWN_EVENT;
}

/* ------------------------------------------------------- filtros do rodapé */

export const EVENT_FILTER_IDS = ["all", "tools", "text", "usage", "system", "diagnostic"] as const;

export type EventFilterId = (typeof EVENT_FILTER_IDS)[number];

/**
 * O rótulo de cada filtro.
 *
 * O grupo de ferramentas usa a chave do glossário porque "Item" é um label de
 * entidade; os outros quatro são palavras comuns e não têm chave.
 */
export const EVENT_FILTER_LABEL: Record<
  EventFilterId,
  { readonly text: string } | { readonly key: GlossaryKey }
> = {
  all: { text: "Tudo" },
  tools: { key: "entity.tool.plural" },
  text: { text: "Texto" },
  usage: { text: "Uso" },
  system: { text: "Sistema" },
  diagnostic: { text: "Diagnóstico" },
};
