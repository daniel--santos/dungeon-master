import type { TaskGraph } from "@dungeon-master/contracts";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DatabaseExecutor } from "./dashboard-event.js";
import { findProjectRow } from "./project.js";
import { proposedTasks } from "./schema/proposed-task.js";
import { taskDependencies, tasks } from "./schema/task.js";

/**
 * O grafo de Tasks de um Project (documento técnico, seção 5.3).
 *
 * Três consultas, nenhuma correlacionada: as Tasks do Project, as arestas de
 * dependência com as **duas** pontas no Project, e as Tasks de origem com
 * proposta aberta. Uma aresta para uma Task de outro Project — possível pela
 * rota por aresta, que não exige o mesmo Project — fica fora do desenho, e
 * não vira um nó fantasma: o grafo é do Project, e a Task de fora aparece no
 * detalhe da Task, onde tem contexto.
 *
 * Devolve `null` quando o Project não existe: o grafo de um Project
 * inexistente é 404, não um grafo vazio.
 */
export async function getTaskGraph(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<TaskGraph | null> {
  const project = await findProjectRow(db, input);
  if (project === null) return null;

  const nodes = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      kind: tasks.kind,
      status: tasks.status,
      priority: tasks.priority,
      parentTaskId: tasks.parentTaskId,
      workflowId: tasks.workflowId,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, input.userId), eq(tasks.projectId, input.projectId)))
    .orderBy(asc(tasks.createdAt), asc(tasks.id));

  const dependent = alias(tasks, "dependent");
  const prerequisite = alias(tasks, "prerequisite");

  const edges = await db
    .select({ from: taskDependencies.dependsOnTaskId, to: taskDependencies.taskId })
    .from(taskDependencies)
    .innerJoin(dependent, eq(dependent.id, taskDependencies.taskId))
    .innerJoin(prerequisite, eq(prerequisite.id, taskDependencies.dependsOnTaskId))
    .where(
      and(
        eq(taskDependencies.userId, input.userId),
        eq(dependent.projectId, input.projectId),
        eq(prerequisite.projectId, input.projectId),
      ),
    )
    .orderBy(
      asc(taskDependencies.createdAt),
      asc(taskDependencies.taskId),
      asc(taskDependencies.dependsOnTaskId),
    );

  const comProposta = await db
    .selectDistinct({ originTaskId: proposedTasks.originTaskId })
    .from(proposedTasks)
    .where(
      and(
        eq(proposedTasks.userId, input.userId),
        eq(proposedTasks.projectId, input.projectId),
        eq(proposedTasks.status, "PROPOSED"),
      ),
    );
  const abertas = new Set(comProposta.map((row) => row.originTaskId));

  return {
    projectId: input.projectId,
    nodes: nodes.map((node) => ({ ...node, hasOpenProposals: abertas.has(node.id) })),
    edges: edges.map((edge) => ({ from: edge.from, to: edge.to, kind: "dependency" as const })),
  };
}
