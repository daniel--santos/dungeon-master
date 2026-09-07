import type { TaskStatus } from "@dungeon-master/contracts";

/**
 * A máquina de estados de Task (documento técnico, seção 36).
 *
 * ```text
 * INBOX   → READY | CANCELLED
 * READY   → QUEUED | COMPLETED | CANCELLED
 * QUEUED  → RUNNING | CANCELLED
 * RUNNING → COMPLETED | FAILED | WAITING | BLOCKED | CANCELLED
 * WAITING → RUNNING
 * BLOCKED → READY
 * FAILED  → QUEUED
 * ```
 *
 * `READY → COMPLETED` é a **conclusão manual**: o usuário marca o trabalho como
 * feito na interface, sem Run. Existe porque a Fase 1 entrega o gerenciador de
 * tarefas antes do runtime, e continua válida depois: nem todo trabalho precisa
 * de um agente. As regras de vizinhança (filhas resolvidas) valem para qualquer
 * chegada a `COMPLETED`, manual ou não.
 *
 * `QUEUED` e `RUNNING` só passam a ser alcançados de verdade pela Fase 2, com o
 * runtime de execução, mas a máquina entra inteira agora: uma transição que só
 * aparece depois é uma transição que ninguém testou antes de precisar dela.
 *
 * O tipo do mapa força a exaustividade — um estado novo em `TaskStatus` sem
 * linha aqui é erro de compilação, não um estado sem saída descoberto em
 * produção.
 */
export const TASK_TRANSITIONS = {
  INBOX: ["READY", "CANCELLED"],
  READY: ["QUEUED", "COMPLETED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "WAITING", "BLOCKED", "CANCELLED"],
  WAITING: ["RUNNING"],
  BLOCKED: ["READY"],
  FAILED: ["QUEUED"],
  COMPLETED: [],
  CANCELLED: [],
} as const satisfies Record<TaskStatus, readonly TaskStatus[]>;

/**
 * Estados sem saída. Uma Task aqui não muda mais de estado.
 *
 * `FAILED` não é terminal: volta para `QUEUED` numa nova tentativa. `COMPLETED`
 * e `CANCELLED` são, e é o que permite tratar as duas como "resolvida" na regra
 * das subtarefas.
 */
export const TERMINAL_TASK_STATUSES = [
  "COMPLETED",
  "CANCELLED",
] as const satisfies readonly TaskStatus[];

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (TERMINAL_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

/** Os estados alcançáveis a partir de um estado. Vazio nos terminais. */
export function allowedTaskTransitions(from: TaskStatus): readonly TaskStatus[] {
  return TASK_TRANSITIONS[from];
}

/**
 * Verdadeiro quando a aresta existe na máquina de estados.
 *
 * Só a forma do grafo: as regras que dependem de outras Tasks — subtarefas
 * pendentes, dependências não concluídas — ficam em `checkTaskTransition`, que
 * chama esta função primeiro.
 */
export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return (TASK_TRANSITIONS[from] as readonly TaskStatus[]).includes(to);
}

/**
 * Estados em que uma Task pode não ter Project.
 *
 * `INBOX` é a captura que ainda não foi triada. `CANCELLED` está aqui porque
 * descartar uma captura é levá-la a `CANCELLED` sem nunca lhe dar um Project:
 * exigir um Project no descarte obrigaria o usuário a escolher onde guardar
 * justamente aquilo que ele decidiu não fazer.
 *
 * Todo outro estado é trabalho vivo, e trabalho vivo pertence a um Project.
 */
export const PROJECTLESS_TASK_STATUSES = [
  "INBOX",
  "CANCELLED",
] as const satisfies readonly TaskStatus[];

/**
 * Verdadeiro quando o estado exige um Project.
 *
 * É a metade em código da restrição que o banco aplica com
 * `CHECK (project_id IS NOT NULL OR status IN ('INBOX','CANCELLED'))`. Sair de
 * `INBOX` para qualquer estado de trabalho é justamente o momento de escolher
 * um Project — o que a rota de promoção faz.
 */
export function taskStatusRequiresProject(status: TaskStatus): boolean {
  return !(PROJECTLESS_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}
