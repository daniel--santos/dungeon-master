import type { TaskKind, TaskPriority, TaskStatus } from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";
import { BugIcon, Compass, Target, Wrench, type LucideIcon } from "lucide-react";

/**
 * A ponte entre os enums canônicos do domínio e o que a tela mostra.
 *
 * Nenhum label aparece aqui: só **chaves** de glossário, resolvidas por
 * `useGlossary` no ponto de render. É por isso que este arquivo pode listar
 * todos os estados sem violar a seção 2 do CLAUDE.md.
 *
 * Os mapas são `Record<Enum, …>` de propósito: um valor novo em `TaskStatus`
 * vira erro de compilação aqui, e não um `undefined` silencioso na tabela.
 */

/* ------------------------------------------------------------------- kind */

interface KindPresentation {
  readonly label: GlossaryKey;
  readonly plural: GlossaryKey;
  readonly icon: LucideIcon;
}

export const TASK_KIND: Record<TaskKind, KindPresentation> = {
  BUG: { label: "entity.task.kind.bug", plural: "entity.task.kind.bug.plural", icon: BugIcon },
  FEATURE: {
    label: "entity.task.kind.feature",
    plural: "entity.task.kind.feature.plural",
    icon: Target,
  },
  RESEARCH: {
    label: "entity.task.kind.research",
    plural: "entity.task.kind.research.plural",
    icon: Compass,
  },
  CHORE: { label: "entity.task.kind.chore", plural: "entity.task.kind.chore.plural", icon: Wrench },
};

export const TASK_KINDS = Object.keys(TASK_KIND) as readonly TaskKind[];

/* ----------------------------------------------------------------- status */

/**
 * A família de acentos do design: mesma luminosidade e croma, só o matiz muda.
 *
 * Os valores são literais e não variáveis do tema porque não existem como
 * token do shadcn — são a paleta derivada que o canvas da Fase 1 fixou.
 */
const ACCENT_BLUE = "oklch(0.72 0.13 250)";
const ACCENT_VIOLET = "oklch(0.72 0.13 305)";
const ACCENT_AMBER = "oklch(0.72 0.13 75)";

interface StatusPresentation {
  readonly label: GlossaryKey;
  /** A cor do ponto do chip. */
  readonly dot: string;
  /** Estado resolvido ou ainda não começado: o texto vai em `muted-foreground`. */
  readonly dim: boolean;
}

export const TASK_STATUS: Record<TaskStatus, StatusPresentation> = {
  INBOX: { label: "task.status.inbox", dot: "var(--muted-foreground)", dim: true },
  READY: { label: "task.status.ready", dot: ACCENT_BLUE, dim: false },
  QUEUED: { label: "task.status.queued", dot: "var(--muted-foreground)", dim: true },
  RUNNING: { label: "task.status.running", dot: ACCENT_VIOLET, dim: false },
  WAITING: { label: "task.status.waiting", dot: ACCENT_AMBER, dim: false },
  BLOCKED: { label: "task.status.blocked", dot: "var(--destructive)", dim: false },
  COMPLETED: { label: "task.status.completed", dot: "var(--ring)", dim: true },
  FAILED: { label: "task.status.failed", dot: "var(--destructive)", dim: false },
  CANCELLED: { label: "task.status.cancelled", dot: "var(--ring)", dim: true },
};

export const TASK_STATUSES = Object.keys(TASK_STATUS) as readonly TaskStatus[];

/* --------------------------------------------------------------- priority */

interface PriorityPresentation {
  readonly label: GlossaryKey;
  /** Classe utilitária da cor do texto. */
  readonly className: string;
}

export const TASK_PRIORITY: Record<TaskPriority, PriorityPresentation> = {
  URGENT: { label: "task.priority.urgent", className: "text-destructive" },
  HIGH: { label: "task.priority.high", className: "text-foreground" },
  MEDIUM: { label: "task.priority.medium", className: "text-muted-foreground" },
  LOW: { label: "task.priority.low", className: "text-muted-foreground" },
};

/** Da mais urgente para a menos, que é como a API ordena por `priority`. */
export const TASK_PRIORITIES = Object.keys(TASK_PRIORITY) as readonly TaskPriority[];

/* ------------------------------------------------------ máquina de estados */

/**
 * Uma cópia da máquina de estados de `packages/domain`, em leitura.
 *
 * A web não pode importar o pacote de domínio (fronteira do ESLint), e mesmo
 * que pudesse, o servidor continua sendo a autoridade: isto aqui só decide
 * **quais botões oferecer**. Toda recusa real chega como `409` com o motivo em
 * `detail`, inclusive as regras que dependem de outras Tasks — subtarefa
 * pendente, dependência não concluída — que esta tabela não conhece.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  INBOX: ["READY", "CANCELLED"],
  READY: ["QUEUED", "COMPLETED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "WAITING", "BLOCKED", "CANCELLED"],
  WAITING: ["RUNNING"],
  BLOCKED: ["READY"],
  FAILED: ["QUEUED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** `true` quando a aresta existe na máquina — a forma do grafo, só isso. */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

/* --------------------------------------------------------------- ordenação */

export const TASK_SORT_FIELDS = ["updatedAt", "createdAt", "priority", "title"] as const;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];
