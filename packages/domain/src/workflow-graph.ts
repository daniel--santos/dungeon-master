import type { Predicate, RunStepStatus, StepSkipReason } from "@dungeon-master/contracts";

import { isTerminalRunStepStatus } from "./run-step-status.js";

/**
 * O grafo de um Workflow: quem espera quem, e quem está pronto para rodar.
 *
 * Funções puras sobre a definição já validada e sobre o estado dos RunSteps.
 * O motor (Fase 4B) lê o estado, pergunta aqui, e aplica a resposta na mesma
 * transação; nada aqui conhece banco, relógio ou processo.
 *
 * O contrato já recusa ciclo e referência inexistente na validação, mas o
 * motor executa versões **congeladas**, e uma versão gravada por um schema
 * antigo pode ter sido validada por regras antigas. Por isso as checagens se
 * repetem aqui, fail-closed: um grafo que não faz sentido não produz step
 * pronto nenhum.
 */

/** O que o grafo precisa saber de um step. `WorkflowStepDefinition` satisfaz. */
export interface WorkflowGraphStep {
  readonly key: string;
  readonly dependsOn: readonly string[];
  /** Presença de `when` muda a regra de prontidão; o conteúdo é do avaliador. */
  readonly when?: readonly Predicate[] | undefined;
}

const WHITE = 0;
const GREY = 1;
const BLACK = 2;

/**
 * Procura um ciclo em `dependsOn` e devolve o caminho fechado, ou `null`.
 *
 * Mesmo algoritmo de `findDependencyCycle`, iterativo e com pilha explícita.
 * Arestas para chaves inexistentes e auto-arestas não entram: as duas já são
 * defeitos por si só, apontados por `missingDependencies`.
 */
export function findWorkflowCycle(steps: readonly WorkflowGraphStep[]): string[] | null {
  const known = new Set(steps.map((step) => step.key));
  const adjacency = new Map<string, string[]>();
  for (const step of steps) {
    adjacency.set(
      step.key,
      step.dependsOn.filter((dependency) => known.has(dependency) && dependency !== step.key),
    );
  }

  const color = new Map<string, number>();

  for (const start of adjacency.keys()) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;

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
      if (nextColor === GREY) return [...path.slice(path.indexOf(next)), next];
      if (nextColor === BLACK) continue;

      color.set(next, GREY);
      path.push(next);
      stack.push({ node: next, next: 0 });
    }
  }

  return null;
}

/** As referências de `dependsOn` que não apontam para step nenhum, ou para o próprio. */
export function missingDependencies(
  steps: readonly WorkflowGraphStep[],
): Array<{ readonly key: string; readonly dependency: string }> {
  const known = new Set(steps.map((step) => step.key));
  const missing: Array<{ key: string; dependency: string }> = [];
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!known.has(dependency) || dependency === step.key) {
        missing.push({ key: step.key, dependency });
      }
    }
  }
  return missing;
}

export type TopologicalOrder =
  | { readonly ok: true; readonly order: readonly string[] }
  | { readonly ok: false; readonly code: "CYCLE"; readonly cycle: readonly string[] }
  | {
      readonly ok: false;
      readonly code: "MISSING_DEPENDENCY";
      readonly missing: ReadonlyArray<{ readonly key: string; readonly dependency: string }>;
    };

/**
 * A ordem topológica dos steps, com a ordem da definição como desempate.
 *
 * É a `position` que a captura grava no WorkflowStep e no RunStep, e a ordem
 * em que a interface lista os steps. Determinística: a mesma definição produz
 * sempre a mesma ordem, o que é o que permite comparar duas capturas.
 *
 * A busca é quadrática no número de steps, que o contrato limita a cinquenta:
 * a cada passo escolhe-se o primeiro step, na ordem da definição, cujas
 * dependências já saíram. É mais simples de ler do que Kahn com fila e produz
 * o desempate certo sem estrutura auxiliar.
 */
export function topologicalOrder(steps: readonly WorkflowGraphStep[]): TopologicalOrder {
  const missing = missingDependencies(steps);
  if (missing.length > 0) return { ok: false, code: "MISSING_DEPENDENCY", missing };

  const cycle = findWorkflowCycle(steps);
  if (cycle !== null) return { ok: false, code: "CYCLE", cycle };

  const placed = new Set<string>();
  const order: string[] = [];

  while (order.length < steps.length) {
    const next = steps.find(
      (step) =>
        !placed.has(step.key) && step.dependsOn.every((dependency) => placed.has(dependency)),
    );
    // Sem ciclo e sem referência solta sempre existe um próximo; o `if` é a
    // garantia de que um defeito aqui vira erro e não laço infinito.
    if (next === undefined) {
      return { ok: false, code: "CYCLE", cycle: steps.map((step) => step.key) };
    }
    placed.add(next.key);
    order.push(next.key);
  }

  return { ok: true, order };
}

export interface StepReadiness {
  /** Steps `PENDING` cujas dependências assentaram e que podem ser avaliados agora. */
  readonly ready: readonly string[];
  /** Steps `PENDING` que não vão rodar, com o motivo. O motor os marca `SKIPPED`. */
  readonly skipped: ReadonlyArray<{ readonly key: string; readonly reason: StepSkipReason }>;
}

/**
 * Quais steps ficam prontos dado o estado atual dos RunSteps.
 *
 * Um step é candidato quando está `PENDING` e **toda** dependência está em
 * estado terminal. A partir daí a regra depende de `when`:
 *
 * - **Sem `when`**, o step só roda se toda dependência terminou em
 *   `SUCCEEDED`. Qualquer outro terminal na dependência pula o step com
 *   `DEPENDENCY_NOT_SUCCEEDED`. É a semântica de `needs` que todo mundo
 *   espera de um pipeline: o que vem depois de uma falha não roda.
 * - **Com `when`**, os predicados decidem, e é o motor quem os avalia com
 *   `evaluatePredicates`. É isso que permite um step de limpeza rodar depois
 *   de uma falha (`stepFailed`), ou o `execute` só rodar depois de um gate
 *   aprovado (`stepSucceeded`).
 *
 * Uma dependência ausente do mapa de estado conta como não assentada: o
 * step nunca fica pronto, e nunca é pulado por engano. Fail-closed.
 */
export function evaluateStepReadiness(
  steps: readonly WorkflowGraphStep[],
  statusByKey: ReadonlyMap<string, RunStepStatus>,
): StepReadiness {
  const ready: string[] = [];
  const skipped: Array<{ key: string; reason: StepSkipReason }> = [];

  for (const step of steps) {
    if (statusByKey.get(step.key) !== "PENDING") continue;

    const settled = step.dependsOn.every((dependency) => {
      const status = statusByKey.get(dependency);
      return status !== undefined && isTerminalRunStepStatus(status);
    });
    if (!settled) continue;

    if (step.when !== undefined && step.when.length > 0) {
      ready.push(step.key);
      continue;
    }

    const notSucceeded = step.dependsOn.find(
      (dependency) => statusByKey.get(dependency) !== "SUCCEEDED",
    );
    if (notSucceeded === undefined) {
      ready.push(step.key);
    } else {
      skipped.push({
        key: step.key,
        reason: {
          code: "DEPENDENCY_NOT_SUCCEEDED",
          dependency: notSucceeded,
          status: statusByKey.get(notSucceeded) ?? "CANCELLED",
        },
      });
    }
  }

  return { ready, skipped };
}

/** Verdadeiro quando não sobrou step fora de estado terminal: o Workflow assentou. */
export function isWorkflowSettled(statusByKey: ReadonlyMap<string, RunStepStatus>): boolean {
  for (const status of statusByKey.values()) {
    if (!isTerminalRunStepStatus(status)) return false;
  }
  return true;
}
