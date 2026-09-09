import { describe, expect, it } from "vitest";

import {
  dependenciesOf,
  dependencyEdge,
  dependencyEdgeId,
  dependencyIdsOf,
  layoutTaskGraph,
  NODE_WIDTH,
  parentEdgeId,
} from "@/lib/task-graph-layout";
import {
  CHILD_TASK_ID,
  FORGE_TASK_ID,
  GATE_TASK_ID,
  GRAPH,
  ORIGIN_TASK_ID,
} from "@/test/proposal-fixtures";

/**
 * A montagem do Mapa: do grafo da API para os nós e arestas do React Flow.
 *
 * O que se prende aqui é a tradução — cada Task vira um nó, cada dependência
 * uma aresta sólida no sentido da execução, cada `parentTaskId` uma aresta
 * tracejada — e o layout ser determinístico e da esquerda para a direita.
 */

describe("layoutTaskGraph", () => {
  it("cada Task vira um nó com os dados dela, e cada relação vira a aresta do seu tipo", () => {
    const { nodes, edges, hidden } = layoutTaskGraph(GRAPH);

    expect(nodes.map((node) => node.id)).toEqual(GRAPH.nodes.map((node) => node.id));
    expect(nodes.every((node) => node.type === "task" && node.width === NODE_WIDTH)).toBe(true);
    expect(nodes.find((node) => node.id === ORIGIN_TASK_ID)?.data.task.hasOpenProposals).toBe(true);
    expect(hidden).toBe(0);

    const dependency = edges.find(
      (edge) => edge.id === dependencyEdgeId(FORGE_TASK_ID, GATE_TASK_ID),
    );
    expect(dependency).toMatchObject({
      source: FORGE_TASK_ID,
      target: GATE_TASK_ID,
      type: "dependency",
      data: { kind: "dependency" },
    });
    expect(dependency?.markerEnd).toBeDefined();

    const parent = edges.find((edge) => edge.id === parentEdgeId(ORIGIN_TASK_ID, CHILD_TASK_ID));
    expect(parent).toMatchObject({
      source: ORIGIN_TASK_ID,
      target: CHILD_TASK_ID,
      type: "parent",
      data: { kind: "parent" },
      selectable: false,
    });
    expect(parent?.markerEnd).toBeUndefined();
    expect(edges).toHaveLength(2);
  });

  it("desenha da esquerda para a direita: quem termina antes fica à esquerda, e a mãe também", () => {
    const { nodes } = layoutTaskGraph(GRAPH);
    const x = (id: string) => nodes.find((node) => node.id === id)?.position.x ?? Number.NaN;

    expect(x(FORGE_TASK_ID)).toBeLessThan(x(GATE_TASK_ID));
    expect(x(ORIGIN_TASK_ID)).toBeLessThan(x(CHILD_TASK_ID));
  });

  it("é determinístico: o mesmo grafo produz as mesmas posições", () => {
    const first = layoutTaskGraph(GRAPH);
    const second = layoutTaskGraph({ ...GRAPH, nodes: [...GRAPH.nodes], edges: [...GRAPH.edges] });

    expect(second.nodes.map((node) => [node.id, node.position])).toEqual(
      first.nodes.map((node) => [node.id, node.position]),
    );
    expect(second.edges.map((edge) => edge.id)).toEqual(first.edges.map((edge) => edge.id));
  });

  it("o filtro por estado esconde os nós e leva junto as arestas que os tocam", () => {
    const { nodes, edges, hidden } = layoutTaskGraph(GRAPH, { statuses: ["READY"] });

    expect(nodes.map((node) => node.id).sort()).toEqual([FORGE_TASK_ID, GATE_TASK_ID].sort());
    expect(hidden).toBe(2);
    // A dependência entre as duas prontas fica; a hierarquia com a origem some.
    expect(edges.map((edge) => edge.id)).toEqual([dependencyEdgeId(FORGE_TASK_ID, GATE_TASK_ID)]);
  });

  it("uma aresta com uma ponta fora do grafo, ou para si mesma, é omitida", () => {
    const { edges } = layoutTaskGraph({
      ...GRAPH,
      edges: [
        ...GRAPH.edges,
        { from: "0199eeee-0000-7000-8000-00000000ffff", to: GATE_TASK_ID, kind: "dependency" },
        { from: GATE_TASK_ID, to: GATE_TASK_ID, kind: "dependency" },
      ],
    });

    expect(edges.filter((edge) => edge.type === "dependency")).toHaveLength(1);
  });
});

describe("dependenciesOf", () => {
  it("lê das arestas quem precisa terminar antes de uma Task", () => {
    expect(dependenciesOf(GRAPH, GATE_TASK_ID)).toEqual([FORGE_TASK_ID]);
    expect(dependenciesOf(GRAPH, FORGE_TASK_ID)).toEqual([]);
  });
});

describe("dependencyIdsOf", () => {
  it("lê do desenho na tela, incluindo a aresta otimista que o servidor ainda não conhece", () => {
    const { edges } = layoutTaskGraph(GRAPH);

    // Duas ligações seguidas para a mesma Task, antes de a releitura voltar.
    // O `PUT` substitui o conjunto inteiro, então o segundo pedido precisa
    // levar a primeira aresta junto, ou ela é apagada em silêncio.
    const afterFirst = [...edges, dependencyEdge(ORIGIN_TASK_ID, GATE_TASK_ID)];
    expect(dependencyIdsOf(afterFirst, GATE_TASK_ID)).toEqual([FORGE_TASK_ID, ORIGIN_TASK_ID]);

    const afterSecond = [...afterFirst, dependencyEdge(CHILD_TASK_ID, GATE_TASK_ID)];
    expect(dependencyIdsOf(afterSecond, GATE_TASK_ID)).toEqual([
      FORGE_TASK_ID,
      ORIGIN_TASK_ID,
      CHILD_TASK_ID,
    ]);

    // O grafo do servidor continua sem saber das duas: é dele que o pedido
    // saía, e por isso a primeira dependência sumia.
    expect(dependenciesOf(GRAPH, GATE_TASK_ID)).toEqual([FORGE_TASK_ID]);
  });

  it("ignora a aresta de hierarquia: mãe e filha não são dependência", () => {
    const { edges } = layoutTaskGraph(GRAPH);

    expect(dependencyIdsOf(edges, CHILD_TASK_ID)).toEqual([]);
  });
});
