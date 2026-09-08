import { z } from "zod";

import { TaskKindSchema, TaskPrioritySchema, TaskStatusSchema } from "./task.js";

/**
 * TaskGraph: **o que precisa ser feito** num Project, como grafo (documento
 * técnico, seção 5.3).
 *
 * Não é o Workflow, que diz *como* uma unidade de trabalho é processada: o
 * Workflow pode ficar igual enquanto este grafo cresce a cada Run que propõe
 * trabalho novo. Os nós são as Tasks do Project; as arestas são as
 * dependências entre elas. A hierarquia (mãe e filha) vai em `parentTaskId`
 * de cada nó, e não como aresta, porque é outra relação: uma filha não espera
 * a mãe, e uma mãe só conclui depois das filhas.
 */

export const TaskGraphNodeSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    kind: TaskKindSchema,
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    parentTaskId: z.uuid().nullable().describe("Task mãe, quando este nó é uma subtarefa."),
    workflowId: z.uuid().nullable().describe("Workflow que os Runs deste nó seguem."),
    hasOpenProposals: z
      .boolean()
      .describe("Verdadeiro quando algum Run desta Task propôs trabalho ainda não decidido."),
  })
  .meta({ id: "TaskGraphNode", description: "Uma Task como nó do grafo do Project." });

export type TaskGraphNode = z.infer<typeof TaskGraphNodeSchema>;

export const TaskGraphEdgeKindSchema = z.enum(["dependency"]).meta({
  id: "TaskGraphEdgeKind",
  description: "Tipo de uma aresta do grafo. Hoje só dependência.",
});

export type TaskGraphEdgeKind = z.infer<typeof TaskGraphEdgeKindSchema>;

/**
 * Uma aresta no sentido da execução: `from` precisa terminar antes de `to`
 * poder ser enfileirada.
 *
 * É o inverso da linha de `task_dependency` (`task_id` espera
 * `depends_on_task_id`), de propósito: um layout em camadas desenha `from → to`
 * da esquerda para a direita, e o que se quer ver é a ordem em que o trabalho
 * acontece, não a ordem em que ele foi declarado.
 */
export const TaskGraphEdgeSchema = z
  .object({
    from: z.uuid().describe("A Task que precisa terminar antes."),
    to: z.uuid().describe("A Task que espera por `from`."),
    kind: TaskGraphEdgeKindSchema,
  })
  .meta({ id: "TaskGraphEdge", description: "Uma dependência, no sentido da execução." });

export type TaskGraphEdge = z.infer<typeof TaskGraphEdgeSchema>;

export const TaskGraphSchema = z
  .object({
    projectId: z.uuid(),
    nodes: z
      .array(TaskGraphNodeSchema)
      .describe("As Tasks do Project, da mais antiga para a mais nova."),
    edges: z.array(TaskGraphEdgeSchema).describe("As dependências entre Tasks do Project."),
  })
  .meta({ id: "TaskGraph", description: "As Tasks de um Project e as dependências entre elas." });

export type TaskGraph = z.infer<typeof TaskGraphSchema>;

/** Teto de dependências de uma Task. Acima disso é engano, não intenção. */
export const TASK_MAX_DEPENDENCIES = 100;

/**
 * O conjunto completo de dependências de uma Task.
 *
 * É um `PUT` de verdade: o que não estiver na lista sai, o que estiver e não
 * existir entra, e o que já existir fica. Idempotente. A rota por aresta
 * (`PUT /tasks/{id}/dependencies/{dependsOnId}`) continua existindo para quem
 * quer mexer numa só.
 */
export const ReplaceTaskDependenciesSchema = z
  .object({
    dependsOn: z
      .array(z.uuid())
      .max(TASK_MAX_DEPENDENCIES)
      .describe("As Tasks das quais esta passa a depender. Vazio remove todas. Mesmo Project."),
  })
  .meta({
    id: "ReplaceTaskDependencies",
    description: "Corpo de `PUT /api/v1/tasks/{id}/dependencies`.",
  });

export type ReplaceTaskDependencies = z.infer<typeof ReplaceTaskDependenciesSchema>;
