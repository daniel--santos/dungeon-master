import type {
  Predicate,
  RunStepResult,
  RunStepStatus,
  StepSkipReason,
} from "@dungeon-master/contracts";

import { isFailedRunStepStatus } from "./run-step-status.js";

/**
 * Avaliação dos predicados de `when` (planejamento v0.4, Fase 4).
 *
 * Conjunto fechado, sem linguagem de expressão: cada predicado é uma função
 * pura sobre o estado dos RunSteps, e a lista é uma **conjunção**. Tudo o que
 * não dá para afirmar é `false` — step ausente, resultado sem o campo
 * esperado, predicado de um tipo que este código não conhece. Fail-closed
 * (documento técnico, seção 19.1, item 6): a dúvida pula o step e deixa o
 * motivo gravado, em vez de rodar algo que ninguém pediu.
 */

/** O que o avaliador lê de um RunStep. `RunStep` satisfaz. */
export interface PredicateStepView {
  readonly status: RunStepStatus;
  readonly result: RunStepResult | null;
}

export interface PredicateContext {
  /** Os RunSteps do Run, por chave. */
  readonly steps: ReadonlyMap<string, PredicateStepView>;
  /**
   * Como saber se um arquivo existe no workspace.
   *
   * Injetado porque o domínio não lê disco. Ausente, `artifactExists` avalia
   * `false` com o motivo — nunca `true` por falta de quem perguntar.
   */
  readonly artifactExists?: ((path: string) => boolean) | undefined;
}

export type PredicateEvaluation =
  | { readonly ok: true }
  | { readonly ok: false; readonly predicate: Predicate; readonly detail: string };

function falso(predicate: Predicate, detail: string): PredicateEvaluation {
  return { ok: false, predicate, detail };
}

/** Avalia um predicado. Devolve o motivo quando é falso. */
export function evaluatePredicate(
  predicate: Predicate,
  context: PredicateContext,
): PredicateEvaluation {
  switch (predicate.kind) {
    case "stepSucceeded": {
      const step = context.steps.get(predicate.step);
      if (step === undefined)
        return falso(predicate, `O step "${predicate.step}" não existe neste Run.`);
      if (step.status !== "SUCCEEDED") {
        return falso(
          predicate,
          `O step "${predicate.step}" está em ${step.status}, não em SUCCEEDED.`,
        );
      }
      return { ok: true };
    }

    case "stepFailed": {
      const step = context.steps.get(predicate.step);
      if (step === undefined)
        return falso(predicate, `O step "${predicate.step}" não existe neste Run.`);
      if (!isFailedRunStepStatus(step.status)) {
        return falso(
          predicate,
          `O step "${predicate.step}" está em ${step.status}, que não é falha.`,
        );
      }
      return { ok: true };
    }

    case "outputStatusIs": {
      const step = context.steps.get(predicate.step);
      if (step === undefined)
        return falso(predicate, `O step "${predicate.step}" não existe neste Run.`);
      if (step.result === null) {
        return falso(predicate, `O step "${predicate.step}" não tem resultado gravado.`);
      }
      if (step.result.kind !== "agent") {
        return falso(
          predicate,
          `O step "${predicate.step}" tem resultado de ${step.result.kind}, não de agente.`,
        );
      }
      if (step.result.status !== predicate.status) {
        return falso(
          predicate,
          `O agente do step "${predicate.step}" reportou ${step.result.status}, não ${predicate.status}.`,
        );
      }
      return { ok: true };
    }

    case "validationPassed": {
      const step = context.steps.get(predicate.step);
      if (step === undefined)
        return falso(predicate, `O step "${predicate.step}" não existe neste Run.`);
      if (step.result === null) {
        return falso(predicate, `O step "${predicate.step}" não tem resultado gravado.`);
      }
      if (step.result.kind !== "validation") {
        return falso(
          predicate,
          `O step "${predicate.step}" tem resultado de ${step.result.kind}, não de validação.`,
        );
      }
      if (step.result.verdict !== "passed") {
        return falso(
          predicate,
          `A validação do step "${predicate.step}" saiu ${step.result.verdict}.`,
        );
      }
      return { ok: true };
    }

    case "artifactExists": {
      if (context.artifactExists === undefined) {
        return falso(predicate, "Não há como conferir o workspace neste contexto.");
      }
      if (!context.artifactExists(predicate.path)) {
        return falso(predicate, `O arquivo "${predicate.path}" não existe no workspace.`);
      }
      return { ok: true };
    }

    default: {
      // Uma definição congelada por um schema antigo pode carregar um tipo que
      // este código não conhece. `never` garante que todo tipo conhecido tem
      // um `case`; o `default` é o que sobra em tempo de execução.
      const desconhecido = predicate as { kind?: unknown };
      return falso(
        predicate,
        `Predicado desconhecido: ${JSON.stringify(desconhecido.kind ?? null)}.`,
      );
    }
  }
}

/**
 * Avalia a conjunção. O primeiro predicado falso decide, e o motivo é dele.
 *
 * Uma lista vazia é verdadeira: `when` ausente não é `when` impossível.
 */
export function evaluatePredicates(
  predicates: readonly Predicate[],
  context: PredicateContext,
): PredicateEvaluation {
  for (const predicate of predicates) {
    const evaluation = evaluatePredicate(predicate, context);
    if (!evaluation.ok) return evaluation;
  }
  return { ok: true };
}

/** O motivo de `StepSkipped` para uma avaliação falsa. */
export function skipReasonFor(
  evaluation: Extract<PredicateEvaluation, { ok: false }>,
): StepSkipReason {
  return { code: "PREDICATE_FALSE", predicate: evaluation.predicate, detail: evaluation.detail };
}
