import type {
  ApprovalGate,
  DiagnosticEvent,
  RunError,
  RunEventPayload,
  RunResult,
  RunStep,
  RunStepStatus,
  StepFinishedEvent,
  StepSkipReason,
  StepSkippedEvent,
  StepStartedEvent,
  WorkflowStepDefinition,
} from "@dungeon-master/contracts";
import {
  evaluatePredicates,
  evaluateStepReadiness,
  isWorkflowSettled,
  skipReasonFor,
  topologicalOrder,
} from "@dungeon-master/domain";
import type { Clock } from "@dungeon-master/runtime";
import { systemClock } from "@dungeon-master/runtime";

import { aggregateRunResult } from "./aggregate.js";
import { agentStepExecutor } from "./executors/agent.js";
import { approvalStepExecutor } from "./executors/approval.js";
import { commandStepExecutor } from "./executors/command.js";
import { knowledgeStepExecutor } from "./executors/knowledge.js";
import type { StepAttemptOutcome, StepExecutionDeps, StepExecutor } from "./executors/types.js";
import { validationStepExecutor } from "./executors/validation.js";
import type { WorkflowLogger } from "./logger.js";
import type {
  ArtifactProbe,
  CheckoutSnapshotter,
  CommandExecutor,
  StepAgentRuntime,
  WorkflowRunContext,
  WorkflowStore,
} from "./ports.js";

/**
 * O runner: conduz um Run com Workflow do estado persistido até assentar,
 * pausar num gate ou ser cancelado.
 *
 * **Orquestrador determinístico** (documento técnico, seção 19.1): quem
 * decide o próximo passo são os dados — os RunSteps gravados — e o código —
 * o grafo e os predicados do domínio. A IA só decide dentro de um step de
 * agente. Nada aqui interpreta prosa.
 *
 * **Um passo por vez.** A cada volta o runner relê os RunSteps, pergunta ao
 * domínio quem está pronto, escolhe o primeiro na ordem topológica, executa,
 * assenta, e relê. Paralelismo entre passos fica fora da Fase 4.
 *
 * **Retomada por estado persistido.** Não há estado do Workflow em memória
 * entre duas voltas: um Worker que reinicia cria outro runner sobre o mesmo
 * store e continua de onde os RunSteps dizem. Passos assentados não rodam de
 * novo; o gate é reencontrado pela chave; um passo encontrado em `RUNNING`
 * sem ninguém executando é uma tentativa perdida, e conta como tal.
 */

export interface WorkflowDefinitionView {
  readonly name: string;
  /** Os steps da versão congelada. A ordem é recalculada aqui: só o grafo vale. */
  readonly steps: readonly WorkflowStepDefinition[];
}

export interface RunWorkflowInput {
  readonly run: WorkflowRunContext;
  readonly definition: WorkflowDefinitionView;
  readonly store: WorkflowStore;
  readonly agent: StepAgentRuntime;
  readonly commands: CommandExecutor;
  readonly snapshots: CheckoutSnapshotter;
  /** `artifactExists` dos predicados. Ausente, o predicado avalia falso com o motivo. */
  readonly artifactExists?: ArtifactProbe | undefined;
  /**
   * Teto de um step `command`/`validation` sem `timeoutMs` próprio. Vem do
   * perfil de execução do Worker. Ausente, o comando roda até acabar.
   */
  readonly defaultStepTimeoutMs?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly logger?: WorkflowLogger | undefined;
  /** Cancelamento vindo do Worker. Verificado entre passos e propagado ao passo em curso. */
  readonly signal?: AbortSignal | undefined;
}

export type WorkflowOutcome =
  | {
      readonly kind: "settled";
      readonly status: "SUCCEEDED" | "FAILED";
      readonly result: RunResult;
      readonly error?: RunError | undefined;
      readonly harnessSessionId?: string | undefined;
      readonly steps: readonly RunStep[];
    }
  | { readonly kind: "paused"; readonly gate: ApprovalGate; readonly stepKey: string }
  | {
      readonly kind: "cancelled";
      readonly reason?: string | undefined;
      readonly processTreeTerminated: boolean;
      readonly terminationMethod?: string | undefined;
      readonly steps: readonly RunStep[];
    };

/** Os tipos de step que agem no checkout, e para os quais o snapshot faz sentido. */
const TOUCHES_CHECKOUT = new Set<WorkflowStepDefinition["type"]>([
  "agent",
  "command",
  "validation",
]);

export async function runWorkflow(input: RunWorkflowInput): Promise<WorkflowOutcome> {
  const { run, store, logger } = input;
  const clock = input.clock ?? systemClock;
  const signal = input.signal ?? new AbortController().signal;

  const append = async (event: RunEventPayload): Promise<void> => {
    await store.appendEvent(event);
  };

  const diagnostic = async (
    level: DiagnosticEvent["level"],
    message: string,
    detail?: string,
  ): Promise<void> => {
    await append({
      type: "Diagnostic",
      timestamp: clock.nowIso(),
      harness: run.harnessKey,
      level,
      source: "RUNTIME",
      message,
      ...(detail === undefined ? {} : { detail }),
    });
  };

  const deps: StepExecutionDeps = {
    store,
    agent: input.agent,
    commands: input.commands,
    artifactExists: input.artifactExists ?? (() => false),
    logger,
    now: () => clock.now(),
  };

  // ------------------------------------------------------------ definição
  const order = topologicalOrder(input.definition.steps);
  const definitionsByKey = new Map(input.definition.steps.map((step) => [step.key, step] as const));

  if (!order.ok) {
    // Uma versão congelada por um schema antigo pode não ter ordem. Fail-closed:
    // nada roda, e o motivo fica no Run.
    const steps = await cancelPending(await store.listRunSteps(), "definição inválida");
    await diagnostic(
      "ERROR",
      "A definição congelada deste Workflow não tem ordem topológica; nenhum passo rodou.",
      JSON.stringify(order),
    );
    return settledInvalid(steps, {
      code: "WORKFLOW_DEFINITION_INVALID",
      message: `A definição do Workflow "${input.definition.name}" não tem ordem topológica.`,
      retryable: false,
      detail: order,
    });
  }

  // ------------------------------------------------------------------ laço
  for (;;) {
    const steps = await store.listRunSteps();
    const stepsByKey = new Map(steps.map((step) => [step.key, step] as const));
    const statusByKey = new Map<string, RunStepStatus>(
      steps.map((step) => [step.key, step.status] as const),
    );

    const semLinha = order.order.find((key) => !stepsByKey.has(key));
    if (semLinha !== undefined) {
      const cancelados = await cancelPending(steps, "RunStep ausente");
      await diagnostic(
        "ERROR",
        `O step "${semLinha}" da versão congelada não tem RunStep neste Run; nenhum passo rodou.`,
      );
      return settledInvalid(cancelados, {
        code: "RUN_STEP_MISSING",
        message: `O step "${semLinha}" não tem RunStep neste Run.`,
        retryable: false,
      });
    }

    if (isWorkflowSettled(statusByKey)) {
      return settle(steps);
    }

    // (a) Cancelamento entre passos: o sinal do Worker e a marca no banco.
    if (signal.aborted || (await store.isCancelRequested())) {
      const cancelados = await cancelPending(steps, "cancelamento pedido");
      return {
        kind: "cancelled",
        reason: "user_request",
        processTreeTerminated: true,
        steps: cancelados,
      };
    }

    // (b) Um passo em RUNNING sem ninguém executando: tentativa perdida.
    const perdido = steps.find((step) => step.status === "RUNNING");
    if (perdido !== undefined) {
      await recoverLostAttempt(perdido);
      continue;
    }

    // (c) Um passo esperando aprovação: o gate é reencontrado pela chave, e o
    // Run volta a soltar o Worker. Nunca um segundo gate.
    const esperando = steps.find((step) => step.status === "WAITING_APPROVAL");
    if (esperando !== undefined) {
      const definition = definitionsByKey.get(esperando.key);
      if (definition?.type !== "approval") {
        await settleLost(esperando, "FAILED", {
          code: "STEP_NOT_APPROVAL",
          message: `O step "${esperando.key}" está em WAITING_APPROVAL mas não é um step de aprovação.`,
          retryable: false,
        });
        continue;
      }
      const gate = await store.createApprovalGate({
        stepKey: esperando.key,
        gateKey: definition.gateKey,
        title: definition.title,
        description: definition.description,
      });
      if (!gate.ok) {
        await settleLost(esperando, "FAILED", {
          code: gate.code,
          message: `Não consegui reencontrar o gate "${definition.gateKey}": ${gate.detail}`,
          retryable: false,
        });
        continue;
      }
      if (gate.gate.status === "PENDING") {
        logger?.info?.(
          { runId: run.runId, stepKey: esperando.key, gateId: gate.gate.id },
          "gate pendente reencontrado; o Run continua esperando",
        );
        return { kind: "paused", gate: gate.gate, stepKey: esperando.key };
      }
      // O gate foi decidido, e o step não assentou junto. A decisão vale.
      const aprovado = gate.gate.status === "GRANTED";
      await settleLost(esperando, aprovado ? "SUCCEEDED" : "FAILED", undefined, {
        kind: "approval",
        gateId: gate.gate.id,
        decision: aprovado ? "approve" : "reject",
        note: gate.gate.note,
        resolvedAt: gate.gate.resolvedAt ?? clock.nowIso(),
      });
      continue;
    }

    // (d) Prontidão pelo domínio: quem pula, pula com motivo gravado.
    const readiness = evaluateStepReadiness(input.definition.steps, statusByKey);
    if (readiness.skipped.length > 0) {
      for (const skipped of readiness.skipped) {
        const step = stepsByKey.get(skipped.key);
        if (step !== undefined) await skipStep(step, skipped.reason);
      }
      continue;
    }

    const proximaChave = order.order.find((key) => readiness.ready.includes(key));
    if (proximaChave === undefined) {
      // Nada pronto e nada assentando: o grafo travou. Fail-closed, com o
      // estado gravado para quem for investigar.
      const cancelados = await cancelPending(steps, "grafo sem passo pronto");
      await diagnostic(
        "ERROR",
        "Nenhum passo está pronto e o Workflow não assentou; os passos restantes foram cancelados.",
        JSON.stringify([...statusByKey.entries()]),
      );
      return settledInvalid(cancelados, {
        code: "WORKFLOW_STUCK",
        message: "Nenhum passo do Workflow ficou pronto para rodar.",
        retryable: false,
      });
    }

    const step = stepsByKey.get(proximaChave)!;
    const definition = definitionsByKey.get(proximaChave)!;

    // (e) Predicados de `when`, fail-closed.
    if (definition.when !== undefined && definition.when.length > 0) {
      const evaluation = evaluatePredicates(definition.when, {
        steps: stepsByKey,
        artifactExists: input.artifactExists,
      });
      if (!evaluation.ok) {
        await skipStep(step, skipReasonFor(evaluation));
        continue;
      }
    }

    // (f) A tentativa.
    const outcome = await attempt(step, definition, stepsByKey);
    if (outcome !== undefined) return outcome;
  }

  // ---------------------------------------------------------------- passos

  /**
   * Uma tentativa de um passo, do `RUNNING` ao desfecho gravado.
   *
   * Devolve um `WorkflowOutcome` só quando o laço precisa parar — gate ou
   * cancelamento; `undefined` manda o laço reler os RunSteps e seguir.
   */
  async function attempt(
    step: RunStep,
    definition: WorkflowStepDefinition,
    stepsByKey: ReadonlyMap<string, RunStep>,
  ): Promise<WorkflowOutcome | undefined> {
    const maxAttempts = definition.retry?.maxAttempts ?? 1;
    const retentativa = step.attempt > 0;

    // O snapshot fica fora do laço de retry: tirado antes da primeira
    // tentativa, restaurado antes de cada retentativa — e só num worktree do
    // Run. No checkout do usuário nada é destruído.
    if (TOUCHES_CHECKOUT.has(definition.type) && maxAttempts > 1) {
      if (!retentativa) {
        try {
          await input.snapshots.snapshot(step.key);
        } catch (error) {
          await diagnostic(
            "WARN",
            `Não consegui registrar o estado do checkout antes do passo «${definition.name}»; uma retentativa vai partir do estado que sobrar.`,
            describeError(error),
          );
        }
      } else if (run.workspaceStrategy === "GIT_WORKTREE") {
        try {
          await input.snapshots.restore(step.key);
          await diagnostic(
            "INFO",
            `Checkout restaurado ao estado anterior à primeira tentativa do passo «${definition.name}».`,
          );
        } catch (error) {
          await diagnostic(
            "WARN",
            `Não consegui restaurar o checkout antes de retentar o passo «${definition.name}»; a retentativa parte do estado que sobrou.`,
            describeError(error),
          );
        }
      } else {
        await diagnostic(
          "INFO",
          `Retentativa do passo «${definition.name}» sem restaurar o checkout: a estratégia ` +
            `de workspace é ${run.workspaceStrategy}, e o diretório do usuário nunca é destruído.`,
        );
      }
    }

    const moved = await store.transitionRunStep({
      stepKey: step.key,
      from: "PENDING",
      to: "RUNNING",
      incrementAttempt: true,
      patch: { error: null },
    });
    if (!moved.ok) {
      logger?.warn?.(
        { runId: run.runId, stepKey: step.key, failure: moved },
        "não consegui mover o passo para RUNNING; relendo o estado",
      );
      return undefined;
    }

    const running = moved.step;
    const iniciadoEm = clock.now();

    const started: StepStartedEvent = {
      type: "StepStarted",
      timestamp: clock.nowIso(),
      runStepId: running.id,
      stepKey: running.key,
      stepType: running.type,
      attempt: Math.max(running.attempt, 1),
    };
    await append(started);
    logger?.info?.(
      { runId: run.runId, stepKey: running.key, type: running.type, attempt: running.attempt },
      "passo iniciado",
    );

    const timeoutMs =
      definition.timeoutMs ??
      (definition.type === "command" || definition.type === "validation"
        ? input.defaultStepTimeoutMs
        : undefined);

    let outcome: StepAttemptOutcome;
    try {
      outcome = await executorFor(definition).execute({
        run,
        step: running,
        definition,
        stepsByKey,
        definitionsByKey,
        timeoutMs,
        signal,
        deps,
        append,
      });
    } catch (error) {
      // Um executor que estoura é defeito nosso; o passo não pode ficar em
      // RUNNING por causa dele.
      logger?.error?.(
        { err: error, runId: run.runId, stepKey: running.key },
        "executor do passo lançou",
      );
      outcome = {
        kind: "failed",
        error: { code: "EXECUTOR_ERROR", message: describeError(error), retryable: true },
        summary: `O executor do passo falhou: ${describeError(error)}`,
      };
    }

    const durationMs = Math.max(0, clock.now() - iniciadoEm);

    switch (outcome.kind) {
      case "paused":
        return { kind: "paused", gate: outcome.gate, stepKey: running.key };

      case "succeeded": {
        await finish(running, "SUCCEEDED", outcome.summary, durationMs, {
          result: outcome.result,
          error: null,
        });
        await discardSnapshot(running.key);
        return undefined;
      }

      case "failed":
      case "timed_out": {
        const terminal: RunStepStatus = outcome.kind === "failed" ? "FAILED" : "TIMED_OUT";
        if (running.attempt < maxAttempts) {
          const voltou = await store.transitionRunStep({
            stepKey: running.key,
            from: "RUNNING",
            to: "PENDING",
            patch: { error: outcome.error, result: outcome.result ?? null },
          });
          if (voltou.ok) {
            await diagnostic(
              "WARN",
              `Tentativa ${String(running.attempt)} de ${String(maxAttempts)} do passo «${definition.name}» ` +
                `terminou em ${terminal}; o passo volta à fila para retentar.`,
              outcome.error.message,
            );
          } else {
            logger?.warn?.(
              { runId: run.runId, stepKey: running.key, failure: voltou },
              "não consegui devolver o passo a PENDING para a retentativa",
            );
          }
          return undefined;
        }
        await finish(running, terminal, outcome.summary, durationMs, {
          result: outcome.result ?? null,
          error: outcome.error,
        });
        await discardSnapshot(running.key);
        return undefined;
      }

      case "cancelled": {
        await finish(running, "CANCELLED", outcome.summary, durationMs, {
          result: null,
          error: {
            code: "CANCELLED",
            message: "O passo foi cancelado a pedido.",
            processTreeTerminated: outcome.processTreeTerminated,
            ...(outcome.terminationMethod === undefined
              ? {}
              : { terminationMethod: outcome.terminationMethod }),
          },
        });
        const restantes = await store.listRunSteps();
        const cancelados = await cancelPending(restantes, "cancelamento pedido");
        return {
          kind: "cancelled",
          reason: outcome.reason,
          processTreeTerminated: outcome.processTreeTerminated,
          terminationMethod: outcome.terminationMethod,
          steps: cancelados,
        };
      }
    }
  }

  /** Assenta o passo e grava `StepFinished` pelo contrato que não lança. */
  async function finish(
    step: RunStep,
    status: RunStepStatus,
    summary: string,
    durationMs: number,
    patch: { result: RunStep["result"]; error: RunError | null },
  ): Promise<void> {
    const moved = await store.transitionRunStep({
      stepKey: step.key,
      from: "RUNNING",
      to: status,
      patch,
    });
    if (!moved.ok) {
      logger?.warn?.(
        { runId: run.runId, stepKey: step.key, to: status, failure: moved },
        "não consegui assentar o passo; relendo o estado",
      );
      return;
    }
    const finished: StepFinishedEvent = {
      type: "StepFinished",
      timestamp: clock.nowIso(),
      runStepId: step.id,
      stepKey: step.key,
      status,
      attempt: Math.max(step.attempt, 1),
      summary,
      durationMs,
    };
    await append(finished);
    logger?.info?.(
      { runId: run.runId, stepKey: step.key, status, attempt: step.attempt, durationMs },
      "passo assentado",
    );
  }

  async function skipStep(step: RunStep, reason: StepSkipReason): Promise<void> {
    const message = describeSkipReason(reason);
    const moved = await store.transitionRunStep({
      stepKey: step.key,
      from: "PENDING",
      to: "SKIPPED",
      patch: { result: null, error: { code: reason.code, message, reason } },
    });
    if (!moved.ok) {
      logger?.warn?.(
        { runId: run.runId, stepKey: step.key, failure: moved },
        "não consegui pular o passo; relendo o estado",
      );
      return;
    }
    const skipped: StepSkippedEvent = {
      type: "StepSkipped",
      timestamp: clock.nowIso(),
      runStepId: step.id,
      stepKey: step.key,
      reason,
    };
    await append(skipped);
    logger?.info?.({ runId: run.runId, stepKey: step.key, reason: reason.code }, "passo pulado");
  }

  /**
   * Um passo em `RUNNING` que este runner não iniciou: o Worker anterior morreu
   * no meio da tentativa. Ela conta: se ainda houver tentativa, o passo volta a
   * `PENDING` com o motivo; senão assenta em `FAILED` com erro claro.
   */
  async function recoverLostAttempt(step: RunStep): Promise<void> {
    const definition = definitionsByKey.get(step.key);
    const maxAttempts = definition?.retry?.maxAttempts ?? 1;
    const error: RunError = {
      code: "STEP_ATTEMPT_LOST",
      message:
        `A tentativa ${String(Math.max(step.attempt, 1))} do passo «${step.name}» (${step.key}) ` +
        "estava em execução num Worker que terminou sem gravar o desfecho.",
      retryable: true,
    };
    if (step.attempt < maxAttempts) {
      const voltou = await store.transitionRunStep({
        stepKey: step.key,
        from: "RUNNING",
        to: "PENDING",
        patch: { error },
      });
      if (voltou.ok) {
        await diagnostic("WARN", `${error.message} Ainda há tentativa: o passo volta à fila.`);
      }
      return;
    }
    await settleLost(step, "FAILED", {
      ...error,
      message: `${error.message} Não há mais tentativas.`,
    });
  }

  /** Assenta um passo que não foi iniciado por este runner. */
  async function settleLost(
    step: RunStep,
    status: RunStepStatus,
    error: RunError | undefined,
    result?: RunStep["result"],
  ): Promise<void> {
    const moved = await store.transitionRunStep({
      stepKey: step.key,
      from: step.status,
      to: status,
      patch: { ...(result === undefined ? {} : { result }), error: error ?? null },
    });
    if (!moved.ok) {
      logger?.warn?.(
        { runId: run.runId, stepKey: step.key, to: status, failure: moved },
        "não consegui assentar o passo perdido; relendo o estado",
      );
      return;
    }
    const finished: StepFinishedEvent = {
      type: "StepFinished",
      timestamp: clock.nowIso(),
      runStepId: step.id,
      stepKey: step.key,
      status,
      attempt: Math.max(step.attempt, 1),
      summary: error?.message ?? `Assentado em ${status} por decisão já gravada.`,
    };
    await append(finished);
    await discardSnapshot(step.key);
  }

  /** Leva a `CANCELLED` tudo o que ainda não assentou. Devolve o estado final. */
  async function cancelPending(steps: readonly RunStep[], motivo: string): Promise<RunStep[]> {
    for (const step of steps) {
      if (
        step.status !== "PENDING" &&
        step.status !== "RUNNING" &&
        step.status !== "WAITING_APPROVAL"
      ) {
        continue;
      }
      const moved = await store.transitionRunStep({
        stepKey: step.key,
        from: step.status,
        to: "CANCELLED",
        patch: { error: { code: "CANCELLED", message: `Passo cancelado: ${motivo}.` } },
      });
      if (!moved.ok) {
        logger?.warn?.(
          { runId: run.runId, stepKey: step.key, failure: moved },
          "não consegui cancelar o passo",
        );
      }
      await discardSnapshot(step.key);
    }
    return [...(await store.listRunSteps())];
  }

  async function discardSnapshot(stepKey: string): Promise<void> {
    try {
      await input.snapshots.discard(stepKey);
    } catch (error) {
      logger?.warn?.(
        { err: error, runId: run.runId, stepKey },
        "não consegui descartar o snapshot",
      );
    }
  }

  function settle(steps: readonly RunStep[]): WorkflowOutcome {
    const aggregated = aggregateRunResult(steps);
    return {
      kind: "settled",
      status: aggregated.status,
      result: aggregated.result,
      error: aggregated.error,
      harnessSessionId: aggregated.harnessSessionId,
      steps,
    };
  }

  function settledInvalid(steps: readonly RunStep[], error: RunError): WorkflowOutcome {
    const aggregated = aggregateRunResult(steps);
    return {
      kind: "settled",
      status: "FAILED",
      result: { ...aggregated.result, status: "failed", summary: error.message },
      error,
      harnessSessionId: aggregated.harnessSessionId,
      steps,
    };
  }
}

function executorFor(definition: WorkflowStepDefinition): StepExecutor<WorkflowStepDefinition> {
  switch (definition.type) {
    case "agent":
      return agentStepExecutor as StepExecutor<WorkflowStepDefinition>;
    case "command":
      return commandStepExecutor as StepExecutor<WorkflowStepDefinition>;
    case "validation":
      return validationStepExecutor as StepExecutor<WorkflowStepDefinition>;
    case "approval":
      return approvalStepExecutor as StepExecutor<WorkflowStepDefinition>;
    case "knowledge":
      return knowledgeStepExecutor as StepExecutor<WorkflowStepDefinition>;
  }
}

/** A frase do motivo de um passo pulado, para o RunStep e para o `warning` do Run. */
export function describeSkipReason(reason: StepSkipReason): string {
  if (reason.code === "DEPENDENCY_NOT_SUCCEEDED") {
    return `a dependência "${reason.dependency}" terminou em ${reason.status}, não em SUCCEEDED.`;
  }
  return `o predicado ${reason.predicate.kind} avaliou falso: ${reason.detail}`;
}

function describeError(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
