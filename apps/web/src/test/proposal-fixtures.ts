import type {
  ProposedTaskListItemRecord,
  TaskGraphNodeRecord,
  TaskGraphRecord,
} from "@/lib/api-types";
import { RUN, TASK } from "@/test/execution-fixtures";

/**
 * Registros de proposta e de grafo para os testes de componente (Fase 5B).
 *
 * O grafo é o do Project da Task de execução: a Task de origem, duas Missões
 * prontas e uma filha da origem, com uma dependência entre as duas prontas.
 */

const NOW = "2026-09-08T12:00:00.000Z";

export const PROJECT_ID = TASK.projectId ?? "0199ffff-0000-7000-8000-000000000001";

export const ORIGIN_TASK_ID = TASK.id;
export const FORGE_TASK_ID = "0199eeee-0000-7000-8000-000000000002";
export const GATE_TASK_ID = "0199eeee-0000-7000-8000-000000000003";
export const CHILD_TASK_ID = "0199eeee-0000-7000-8000-000000000004";

function node(
  id: string,
  title: string,
  rest: Partial<TaskGraphNodeRecord> = {},
): TaskGraphNodeRecord {
  return {
    id,
    title,
    kind: "FEATURE",
    status: "READY",
    priority: "MEDIUM",
    parentTaskId: null,
    workflowId: null,
    hasOpenProposals: false,
    ...rest,
  };
}

export const GRAPH: TaskGraphRecord = {
  projectId: PROJECT_ID,
  nodes: [
    node(ORIGIN_TASK_ID, TASK.title, {
      kind: "BUG",
      status: "COMPLETED",
      priority: "URGENT",
      hasOpenProposals: true,
    }),
    node(FORGE_TASK_ID, "Forjar a chave"),
    node(GATE_TASK_ID, "Abrir o portão", {
      priority: "HIGH",
      workflowId: "0199a0a0-0000-7000-8000-000000000001",
    }),
    node(CHILD_TASK_ID, "Etapa da origem", { parentTaskId: ORIGIN_TASK_ID, status: "QUEUED" }),
  ],
  edges: [{ from: FORGE_TASK_ID, to: GATE_TASK_ID, kind: "dependency" }],
};

export const PROPOSAL: ProposedTaskListItemRecord = {
  id: "0199d0d0-0000-7000-8000-000000000001",
  projectId: PROJECT_ID,
  originTaskId: ORIGIN_TASK_ID,
  originRunId: RUN.id,
  title: "Cobrir o encerramento no macOS",
  description: "O mesmo caminho do Windows precisa de um teste no macOS.",
  rationale: "Encontrei o mesmo bug latente no launchd enquanto corrigia o Windows.",
  status: "PROPOSED",
  decidedAt: null,
  note: null,
  createdTaskId: null,
  createdAt: NOW,
  originTaskTitle: TASK.title,
  projectTitle: "Torre do Norte",
};

export const SECOND_PROPOSAL: ProposedTaskListItemRecord = {
  ...PROPOSAL,
  id: "0199d0d0-0000-7000-8000-000000000002",
  title: "Documentar o protocolo de kill",
  description: null,
  rationale: null,
};

/** Uma resposta de lista de propostas, com o total do servidor. */
export function proposalPage(items: readonly ProposedTaskListItemRecord[]) {
  return { items: [...items], page: 1, pageSize: 50, total: items.length };
}
