/**
 * Grafo de dependências entre Tasks.
 *
 * Uma aresta `taskId → dependsOnTaskId` significa "esta Task espera aquela".
 * Um ciclo é um impasse: nenhuma das Tasks do ciclo poderia ser enfileirada,
 * porque cada uma esperaria por outra do mesmo ciclo. O banco recusa a
 * auto-dependência com um `CHECK`, mas ciclo indireto não cabe em restrição de
 * tabela — a checagem é aqui, e quem chama a faz dentro da transação que insere
 * a aresta.
 */

/** Uma aresta do grafo. */
export interface TaskDependencyEdge {
  readonly taskId: string;
  readonly dependsOnTaskId: string;
}

const WHITE = 0;
const GREY = 1;
const BLACK = 2;

function buildAdjacency(edges: readonly TaskDependencyEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const existing = adjacency.get(edge.taskId);
    if (existing === undefined) {
      adjacency.set(edge.taskId, [edge.dependsOnTaskId]);
    } else {
      existing.push(edge.dependsOnTaskId);
    }
  }

  return adjacency;
}

/**
 * Procura um ciclo e devolve o caminho fechado, ou `null` se não houver.
 *
 * O caminho volta ao primeiro id no fim (`["A","B","C","A"]`), para a mensagem
 * de erro conseguir mostrar o impasse inteiro em vez de só dizer que existe um.
 *
 * A busca em profundidade é iterativa, com pilha explícita: uma cadeia de
 * dependências longa o bastante estouraria a pilha de chamadas do JavaScript, e
 * um `RangeError` no meio de uma transação é o pior lugar possível para
 * descobrir isso.
 */
export function findDependencyCycle(edges: readonly TaskDependencyEdge[]): string[] | null {
  const adjacency = buildAdjacency(edges);
  const color = new Map<string, number>();

  for (const start of adjacency.keys()) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;

    // `path` é a pilha de nós cinzas: o caminho da raiz até o nó em exploração.
    const path: string[] = [start];
    const stack: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
    color.set(start, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbours = adjacency.get(frame.node) ?? [];

      if (frame.next >= neighbours.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        path.pop();
        continue;
      }

      const next = neighbours[frame.next]!;
      frame.next += 1;

      const nextColor = color.get(next) ?? WHITE;

      // Cinza é um nó que ainda está no caminho atual: chegar nele de novo
      // fecha o ciclo. Preto já foi explorado inteiro e não leva a ciclo algum.
      if (nextColor === GREY) {
        return [...path.slice(path.indexOf(next)), next];
      }
      if (nextColor === BLACK) continue;

      color.set(next, GREY);
      path.push(next);
      stack.push({ node: next, next: 0 });
    }
  }

  return null;
}

/**
 * O ciclo que a aresta nova criaria, ou `null` se ela for segura.
 *
 * Cobre também a auto-dependência, que sai como `["A","A"]`: é o mesmo defeito,
 * um ciclo de comprimento um.
 */
export function wouldCreateDependencyCycle(
  edges: readonly TaskDependencyEdge[],
  candidate: TaskDependencyEdge,
): string[] | null {
  return findDependencyCycle([...edges, candidate]);
}
