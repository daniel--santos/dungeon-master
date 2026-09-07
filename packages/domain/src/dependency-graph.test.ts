import { describe, expect, it } from "vitest";

import {
  findDependencyCycle,
  type TaskDependencyEdge,
  wouldCreateDependencyCycle,
} from "./dependency-graph.js";

function aresta(taskId: string, dependsOnTaskId: string): TaskDependencyEdge {
  return { taskId, dependsOnTaskId };
}

describe("findDependencyCycle", () => {
  it("não vê ciclo num grafo vazio", () => {
    expect(findDependencyCycle([])).toBeNull();
  });

  it("não vê ciclo numa cadeia", () => {
    expect(findDependencyCycle([aresta("A", "B"), aresta("B", "C")])).toBeNull();
  });

  it("não vê ciclo num losango", () => {
    // A espera B e C; B e C esperam D. Sem ciclo, apesar de D ser alcançado
    // por dois caminhos — é o caso que uma busca sem marcação de 'já explorado'
    // reportaria errado.
    const edges = [aresta("A", "B"), aresta("A", "C"), aresta("B", "D"), aresta("C", "D")];

    expect(findDependencyCycle(edges)).toBeNull();
  });

  it("acha o ciclo direto A → B → A", () => {
    expect(findDependencyCycle([aresta("A", "B"), aresta("B", "A")])).toEqual(["A", "B", "A"]);
  });

  it("acha o ciclo indireto A → B → C → A", () => {
    const edges = [aresta("A", "B"), aresta("B", "C"), aresta("C", "A")];

    expect(findDependencyCycle(edges)).toEqual(["A", "B", "C", "A"]);
  });

  it("acha a auto-dependência como ciclo de comprimento um", () => {
    expect(findDependencyCycle([aresta("A", "A")])).toEqual(["A", "A"]);
  });

  it("acha um ciclo que não passa pelo primeiro nó visitado", () => {
    // A → B, e o ciclo B → C → D → B fica adiante. Uma busca que só olhasse
    // o nó de partida não o encontraria.
    const edges = [aresta("A", "B"), aresta("B", "C"), aresta("C", "D"), aresta("D", "B")];

    expect(findDependencyCycle(edges)).toEqual(["B", "C", "D", "B"]);
  });

  it("aguenta uma cadeia longa sem estourar a pilha", () => {
    const tamanho = 50_000;
    const edges: TaskDependencyEdge[] = [];
    for (let i = 0; i < tamanho; i += 1) {
      edges.push(aresta(`n${String(i)}`, `n${String(i + 1)}`));
    }

    expect(findDependencyCycle(edges)).toBeNull();

    edges.push(aresta(`n${String(tamanho)}`, "n0"));
    expect(findDependencyCycle(edges)).toHaveLength(tamanho + 2);
  });
});

describe("wouldCreateDependencyCycle", () => {
  it("libera uma aresta que não fecha ciclo", () => {
    const existentes = [aresta("A", "B")];

    expect(wouldCreateDependencyCycle(existentes, aresta("B", "C"))).toBeNull();
  });

  it("recusa a aresta que fecharia o ciclo indireto A → B → C → A", () => {
    const existentes = [aresta("A", "B"), aresta("B", "C")];

    expect(wouldCreateDependencyCycle(existentes, aresta("C", "A"))).toEqual(["A", "B", "C", "A"]);
  });

  it("recusa a auto-dependência", () => {
    expect(wouldCreateDependencyCycle([], aresta("A", "A"))).toEqual(["A", "A"]);
  });

  it("não altera a lista de arestas recebida", () => {
    const existentes = [aresta("A", "B")];

    wouldCreateDependencyCycle(existentes, aresta("B", "A"));

    expect(existentes).toHaveLength(1);
  });
});
