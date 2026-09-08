/**
 * O contrato de um executor de step.
 *
 * Um executor por tipo, em módulo próprio (documento técnico, seção 19.1:
 * "executor monolítico" é anti-padrão). O runner é quem move o RunStep de
 * estado e grava evento; o executor recebe o step já em `RUNNING` e devolve o
 * **desfecho da tentativa**. Ele não conhece retry, nem ordem, nem os outros
 * steps além do que `stepsByKey` mostra para montar prompt e resultado.
 */

import type {
  ApprovalGate,
  RunStepError,
  RunEventPayload,
  RunStep,
  RunStepResult,
  WorkflowStepDefinition,
} from "@dungeon-master/contracts";

import type { WorkflowLogger } from "../logger.js";
import type {
  ArtifactProbe,
  CommandExecutor,
  StepAgentRuntime,
  WorkflowRunContext,
  WorkflowStore,
} from "../ports.js";

/** O desfecho de uma tentativa. O runner traduz em transição, evento e retry. */
export type StepAttemptOutcome =
  | {
      readonly kind: "succeeded";
      readonly result: RunStepResult;
      readonly summary: string;
    }
  | {
      readonly kind: "failed";
      readonly result?: RunStepResult | undefined;
      readonly error: RunStepError;
      readonly summary: string;
    }
  | {
      readonly kind: "timed_out";
      readonly result?: RunStepResult | undefined;
      readonly error: RunStepError;
      readonly summary: string;
    }
  | {
      readonly kind: "cancelled";
      readonly reason?: string | undefined;
      readonly processTreeTerminated: boolean;
      readonly terminationMethod?: string | undefined;
      readonly summary: string;
    }
  | {
      /** Só o executor de `approval` produz: o Run solta o Worker até a decisão. */
      readonly kind: "paused";
      readonly gate: ApprovalGate;
    };

export interface StepExecutionDeps {
  readonly store: WorkflowStore;
  readonly agent: StepAgentRuntime;
  readonly commands: CommandExecutor;
  readonly artifactExists: ArtifactProbe;
  readonly logger: WorkflowLogger | undefined;
  readonly now: () => number;
}

export interface StepExecutionContext<TDefinition extends WorkflowStepDefinition> {
  readonly run: WorkflowRunContext;
  /** O RunStep já em `RUNNING`, com `attempt` desta tentativa. */
  readonly step: RunStep;
  readonly definition: TDefinition;
  /** Os RunSteps do Run como estavam ao iniciar esta tentativa, por chave. */
  readonly stepsByKey: ReadonlyMap<string, RunStep>;
  /** As definições da versão congelada, por chave. Para resumir resultados pelo nome. */
  readonly definitionsByKey: ReadonlyMap<string, WorkflowStepDefinition>;
  /** Teto desta tentativa, quando o step declara `timeoutMs`. */
  readonly timeoutMs: number | undefined;
  /** Cancelamento do Run. */
  readonly signal: AbortSignal;
  readonly deps: StepExecutionDeps;
  /** Grava um evento no log do Run. Nunca lança. */
  append(event: RunEventPayload): Promise<void>;
}

export interface StepExecutor<TDefinition extends WorkflowStepDefinition> {
  execute(context: StepExecutionContext<TDefinition>): Promise<StepAttemptOutcome>;
}
