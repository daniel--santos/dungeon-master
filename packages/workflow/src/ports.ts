/**
 * Os contratos pelos quais a infraestrutura entra no motor.
 *
 * `@dungeon-master/workflow` decide **o que** acontece com cada step e em que
 * ordem; quem grava linha, sobe processo e chama harness é quem implementa
 * estas portas — o Worker, com os repositórios reais, ou a memória dos
 * testes. É a mesma disciplina de `@dungeon-master/runtime` (planejamento
 * v0.4, seção 5): o pacote não importa banco, e o ESLint garante.
 *
 * Duas regras atravessam todas as portas:
 *
 * 1. **A escrita de estado propaga; a de observabilidade nunca lança.**
 *    `transitionRunStep` e `createApprovalGate` lançam quando o banco falha —
 *    o motor não pode seguir sobre um estado que ninguém tem. `appendEvent`
 *    nunca lança: um `StepStarted` perdido custa uma linha na timeline, não a
 *    execução (CLAUDE.md, seção 9).
 * 2. **O motor nunca guarda estado só em memória.** Tudo o que um Worker
 *    reiniciado precisa para continuar está no que estas portas gravaram.
 */

import type {
  ApprovalGate,
  ExecutionEvent,
  ExecutionMode,
  HarnessKey,
  RunError,
  RunEventPayload,
  RunStep,
  RunStepResult,
  RunStepStatus,
  WorkspaceStrategy,
} from "@dungeon-master/contracts";

// --------------------------------------------------------------------------
// O Run visto pelo motor
// --------------------------------------------------------------------------

/** O que os executores precisam saber do Run. Dados congelados, sem handle de banco. */
export interface WorkflowRunContext {
  readonly runId: string;
  readonly harnessKey: HarnessKey;
  /** Diretório onde os steps agem: o worktree do Run, ou o checkout do usuário. */
  readonly checkoutPath: string;
  readonly workspaceStrategy: WorkspaceStrategy;
  readonly executionMode: ExecutionMode;
}

// --------------------------------------------------------------------------
// Persistência
// --------------------------------------------------------------------------

export interface RunStepPatch {
  readonly result?: RunStepResult | null;
  readonly error?: RunError | null;
}

export interface TransitionRunStepInput {
  readonly stepKey: string;
  /** O estado de onde o motor acredita que o step sai. É a condição do CAS. */
  readonly from: RunStepStatus;
  readonly to: RunStepStatus;
  /** Soma um à tentativa. O motor liga ao entrar em `RUNNING`. */
  readonly incrementAttempt?: boolean;
  readonly patch?: RunStepPatch;
}

export type RunStepTransitionOutcome =
  | { readonly ok: true; readonly step: RunStep }
  | {
      /** O CAS perdeu: o step já não está no estado esperado. `current` é o que o banco mostra. */
      readonly ok: false;
      readonly code: "RUN_STEP_STATUS_CHANGED";
      readonly current: RunStep;
    }
  | {
      readonly ok: false;
      readonly code: "RUN_STEP_TRANSITION_REJECTED";
      readonly from: RunStepStatus;
      readonly to: RunStepStatus;
    }
  | { readonly ok: false; readonly code: "RUN_STEP_NOT_FOUND" };

export interface CreateApprovalGateInput {
  readonly stepKey: string;
  readonly gateKey: string;
  readonly title: string;
  readonly description?: string | undefined;
}

export type ApprovalGateOutcome =
  | {
      readonly ok: true;
      readonly gate: ApprovalGate;
      /** `false` quando o gate já existia para esta chave e nada foi escrito. */
      readonly created: boolean;
    }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/**
 * A persistência de um Run, já escopada nele.
 *
 * Escopada de propósito: o motor conduz um Run por vez, e uma porta que
 * pedisse `runId` em toda chamada só daria ao motor a chance de errar o id.
 */
export interface WorkflowStore {
  /** Os RunSteps do Run, na ordem topológica da captura. */
  listRunSteps(): Promise<readonly RunStep[]>;
  /** O CAS do step. **Propaga** falha de infraestrutura. */
  transitionRunStep(input: TransitionRunStepInput): Promise<RunStepTransitionOutcome>;
  /**
   * Abre o gate, ou devolve o que já existe para a chave. **Propaga**.
   *
   * Contrato herdado de `createApprovalGate` do banco: exige o RunStep em
   * `RUNNING` e o Run em `RUNNING`; ao criar, leva os dois a `WAITING_APPROVAL`
   * e grava `ApprovalRequested` na mesma transação.
   */
  createApprovalGate(input: CreateApprovalGateInput): Promise<ApprovalGateOutcome>;
  /** `cancel_requested_at` está marcado? Lido entre passos. */
  isCancelRequested(): Promise<boolean>;
  /** Grava um evento no log do Run. **Nunca lança.** */
  appendEvent(event: RunEventPayload): Promise<void>;
  /** Guarda o id de sessão do harness no Run. **Nunca lança.** */
  recordHarnessSession(harnessSessionId: string): Promise<void>;
}

// --------------------------------------------------------------------------
// Agente
// --------------------------------------------------------------------------

export interface AgentStepRequest {
  /** Identificador da tentativa, para log: `<runId>:<stepKey>:<attempt>`. */
  readonly executionId: string;
  readonly stepKey: string;
  /** O prompt completo do step: o literal da definição mais os resumos anexados. */
  readonly prompt: string;
  /**
   * Teto da tentativa, quando o step declara `timeoutMs`. Ausente, valem os
   * relógios do perfil de execução que o Worker configurou.
   */
  readonly timeoutMs?: number | undefined;
  /** Cancelamento do Run. O runtime mata a árvore e emite `RunCancelled`. */
  readonly signal: AbortSignal;
}

/**
 * O runtime de agente visto por um step.
 *
 * Mais estreito que `AgentRuntime` de propósito: quem sabe montar o
 * `ExecutionRequest` inteiro — Loadout, perfil, política de permissão, schema
 * do resultado — é o Worker. O motor só sabe o prompt e o teto. O fluxo
 * devolvido segue o contrato do runtime: nunca lança, e termina num evento
 * terminal.
 */
export interface StepAgentRuntime {
  execute(request: AgentStepRequest): AsyncIterable<ExecutionEvent>;
}

// --------------------------------------------------------------------------
// Comando
// --------------------------------------------------------------------------

export interface CommandRequest {
  /** Programa e argumentos, um por posição. Spawn sem shell. */
  readonly argv: readonly string[];
  /** Diretório de trabalho absoluto, já validado dentro do checkout. */
  readonly cwd: string;
}

export interface CommandResult {
  /** Nulo quando o processo morreu por sinal ou nem chegou a nascer. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdoutTail: string;
  readonly stderrTail: string;
  readonly durationMs: number;
  /** Preenchido quando o processo não nasceu ou o executor recusou o pedido. */
  readonly error?: { readonly code: string; readonly message: string } | undefined;
}

export interface CommandTermination {
  /** O desaparecimento da árvore foi confirmado por polling? */
  readonly terminated: boolean;
  readonly method?: string | undefined;
}

export interface CommandHandle {
  /** Resolve quando o processo saiu e a saída foi drenada. Nunca rejeita. */
  readonly result: Promise<CommandResult>;
  /** Mata a árvore e confirma. Nunca lança. Idempotente. */
  terminate(): Promise<CommandTermination>;
}

/**
 * Quem sobe o processo de um step `command` ou `validation`.
 *
 * `start` nunca lança: um executável ausente volta em `result.error`. Timeout
 * e cancelamento são do motor, que chama `terminate` — o executor só sabe subir
 * e matar.
 */
export interface CommandExecutor {
  start(request: CommandRequest): CommandHandle;
}

// --------------------------------------------------------------------------
// Snapshot de checkout
// --------------------------------------------------------------------------

/**
 * O estado do checkout antes da primeira tentativa de um step, e a volta a ele
 * antes de cada retentativa.
 *
 * Fora do laço de retry (planejamento v0.4, Fase 4): o snapshot é tirado uma
 * vez, e cada nova tentativa parte dele. A implementação precisa sobreviver a
 * um restart do Worker — o snapshot não pode morar só em memória.
 */
export interface CheckoutSnapshotter {
  snapshot(stepKey: string): Promise<void>;
  restore(stepKey: string): Promise<void>;
  /** O step assentou; o snapshot dele não vai mais ser restaurado. */
  discard(stepKey: string): Promise<void>;
}

/** `artifactExists` dos predicados: o arquivo existe no checkout? Caminho relativo. */
export type ArtifactProbe = (relativePath: string) => boolean;
