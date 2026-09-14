import type { DelegateStepDefinition } from "@dungeon-master/contracts";
import { settleDelegateStep } from "@dungeon-master/domain";

import type { ChildRunView } from "../ports.js";
import { buildStepPrompt, collectStepOutputs } from "../prompt.js";
import type { StepAttemptOutcome, StepExecutor } from "./types.js";

/**
 * O executor de um step `delegate` (Fase 9B).
 *
 * Ele não conduz o filho: abre o Run filho pela porta (ou reencontra o que já
 * existe para a chave do step) e devolve `waiting`. Quem leva o RunStep e o
 * Run a `WAITING_CHILD` é a própria abertura, na mesma transação que cria o
 * filho. O Worker então solta o Run — trava de workspace e capacidade —, e o
 * desfecho do filho o devolve à fila. Quando o motor reclama o Run de novo,
 * encontra o passo em `WAITING_CHILD` e assenta pelo desfecho do filho, sem
 * passar por aqui.
 *
 * O caminho defensivo — um filho que já existe para o step, com o passo de
 * volta a `RUNNING` (uma tentativa perdida que o motor devolveu à fila) —
 * reencontra o filho em vez de abrir um segundo: se ele já terminou, o passo
 * assenta pelo desfecho; se ainda roda, o passo volta a esperar.
 */
export const delegateStepExecutor: StepExecutor<DelegateStepDefinition> = {
  async execute(context): Promise<StepAttemptOutcome> {
    const { run, step, definition, deps } = context;

    const existente = await deps.store.findChildRun(step.key);
    if (existente !== null) {
      deps.logger?.info?.(
        { runId: run.runId, stepKey: step.key, childRunId: existente.id },
        "run filho reencontrado pela chave do passo",
      );
      return outcomeFromChild(existente, step.key);
    }

    const outputs = collectStepOutputs(
      definition.includeOutputsOf ?? [],
      context.stepsByKey,
      context.definitionsByKey,
    );
    const prompt = buildStepPrompt(definition.prompt, outputs, { taskPrompt: run.prompt });

    const aberto = await deps.store.openDelegation({
      stepKey: step.key,
      loadoutRef: definition.loadoutRef,
      prompt,
      taskStrategy: definition.taskStrategy,
    });

    if (!aberto.ok) {
      return {
        kind: "failed",
        error: {
          code: aberto.code,
          message: `Não consegui delegar o passo «${definition.name}»: ${aberto.detail}`,
          retryable: false,
          loadoutRef: definition.loadoutRef,
        },
        summary: `Delegação recusada: ${aberto.code}.`,
      };
    }

    deps.logger?.info?.(
      {
        runId: run.runId,
        stepKey: step.key,
        childRunId: aberto.child.id,
        created: aberto.created,
        loadout: aberto.child.loadoutName,
      },
      aberto.created ? "run filho aberto; o Run espera" : "run filho reencontrado; o Run espera",
    );

    return outcomeFromChild(aberto.child, step.key);
  },
};

/** O desfecho do passo a partir do filho: espera, ou assenta pelo desfecho dele. */
export function outcomeFromChild(child: ChildRunView, stepKey: string): StepAttemptOutcome {
  const settled = settleDelegateStep(child);
  switch (settled.kind) {
    case "waiting":
      return { kind: "waiting", childRunId: child.id, stepKey };
    case "succeeded":
      return { kind: "succeeded", result: settled.result, summary: settled.summary };
    case "failed":
      return {
        kind: "failed",
        result: settled.result,
        error: settled.error,
        summary: settled.summary,
      };
  }
}
