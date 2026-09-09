import dagre from "@dagrejs/dagre";
import type { TaskStatus } from "@dungeon-master/contracts";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

import type { TaskGraphNodeRecord, TaskGraphRecord } from "@/lib/api-types";

/**
 * A montagem do Mapa: do `TaskGraph` da API para os nós e arestas do React
 * Flow, já posicionados pelo dagre (Fase 5B).
 *
 * Função pura, sem React, para o layout ser testável e determinístico: o
 * mesmo grafo produz as mesmas posições. Da esquerda para a direita, porque
 * a aresta de dependência já vem no sentido da execução (`from` termina antes
 * de `to`), e é essa a ordem de leitura que se quer.
 *
 * Duas relações, dois desenhos. A dependência é uma aresta sólida com seta,
 * e é a única que se edita aqui. A hierarquia (mãe e filha) vem em
 * `parentTaskId` de cada nó, e vira uma aresta tracejada, sem seta e sem
 * ação: uma filha não espera a mãe, e desenhá-la como dependência seria
 * mentir sobre a ordem. Ela entra no dagre com peso menor, para a mãe ficar à
 * esquerda das filhas — é a leitura de "Feature → Research, Backend, Frontend"
 * do documento técnico, seção 5.3 — sem disputar a ordem com as dependências.
 */

export type TaskGraphEdgeKind = "dependency" | "parent";

export interface TaskNodeData extends Record<string, unknown> {
  readonly task: TaskGraphNodeRecord;
}

export type TaskFlowNode = Node<TaskNodeData, "task">;

export interface TaskEdgeData extends Record<string, unknown> {
  readonly kind: TaskGraphEdgeKind;
}

export type TaskFlowEdge = Edge<TaskEdgeData, TaskGraphEdgeKind>;

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 84;

/** O id da aresta de dependência, estável entre releituras: `from` termina antes de `to`. */
export function dependencyEdgeId(from: string, to: string): string {
  return `dep:${from}->${to}`;
}

export function parentEdgeId(parent: string, child: string): string {
  return `parent:${parent}->${child}`;
}

/** Uma aresta de dependência, no traço do Mapa. */
export function dependencyEdge(from: string, to: string): TaskFlowEdge {
  return {
    id: dependencyEdgeId(from, to),
    source: from,
    target: to,
    type: "dependency",
    data: { kind: "dependency" },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--ring)" },
    style: { stroke: "var(--ring)", strokeWidth: 1.5 },
  };
}

function parentEdge(parent: string, child: string): TaskFlowEdge {
  return {
    id: parentEdgeId(parent, child),
    source: parent,
    target: child,
    type: "parent",
    data: { kind: "parent" },
    selectable: false,
    focusable: false,
    style: { stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "4 4" },
  };
}

export interface LayoutOptions {
  /** Só os nós nestes estados. Vazio ou ausente é "todos". */
  readonly statuses?: readonly TaskStatus[];
}

export interface TaskGraphLayout {
  readonly nodes: TaskFlowNode[];
  readonly edges: TaskFlowEdge[];
  /** Quantos nós o filtro escondeu. */
  readonly hidden: number;
}

/** Nós e arestas já posicionados pelo dagre. */
export function layoutTaskGraph(
  graph: TaskGraphRecord,
  options: LayoutOptions = {},
): TaskGraphLayout {
  const statuses = options.statuses ?? [];
  const visible =
    statuses.length === 0
      ? graph.nodes
      : graph.nodes.filter((node) => statuses.includes(node.status));
  const known = new Set(visible.map((node) => node.id));

  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 80, marginx: 12, marginy: 12 });

  for (const node of visible) {
    layout.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const edges: TaskFlowEdge[] = [];

  for (const node of visible) {
    if (node.parentTaskId === null || !known.has(node.parentTaskId)) continue;
    layout.setEdge(node.parentTaskId, node.id, { weight: 1, minlen: 1 });
    edges.push(parentEdge(node.parentTaskId, node.id));
  }

  for (const edge of graph.edges) {
    // Uma aresta com uma ponta fora do filtro some com ela: desenhá-la para o
    // nada não diria nada.
    if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) continue;
    layout.setEdge(edge.from, edge.to, { weight: 3, minlen: 1 });
    edges.push(dependencyEdge(edge.from, edge.to));
  }

  dagre.layout(layout);

  const nodes = visible.map((task): TaskFlowNode => {
    const placed = layout.node(task.id);
    return {
      id: task.id,
      type: "task",
      position: { x: placed.x - NODE_WIDTH / 2, y: placed.y - NODE_HEIGHT / 2 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: { task },
    };
  });

  return { nodes, edges, hidden: graph.nodes.length - visible.length };
}

/** As Tasks das quais `taskId` depende, lidas das arestas do grafo. */
export function dependenciesOf(graph: TaskGraphRecord, taskId: string): string[] {
  return graph.edges.filter((edge) => edge.to === taskId).map((edge) => edge.from);
}

/**
 * As Tasks das quais `taskId` depende, lidas do **desenho na tela**.
 *
 * É a leitura que o `PUT` de dependências precisa: ele substitui o conjunto
 * inteiro, e o conjunto certo é o que está desenhado — que já inclui a aresta
 * otimista da ligação anterior, ainda não confirmada pelo servidor. A aresta
 * de hierarquia fica de fora: mãe e filha não são dependência.
 */
export function dependencyIdsOf(edges: readonly TaskFlowEdge[], taskId: string): string[] {
  return edges
    .filter((edge) => edge.data?.kind === "dependency" && edge.target === taskId)
    .map((edge) => edge.source);
}
