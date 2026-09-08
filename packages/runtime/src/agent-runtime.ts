/**
 * `AgentRuntime` — o único lugar que promete que toda execução termina.
 *
 * O domínio não chama Sandcastle nem CLI nenhuma: chama isto (documento
 * técnico, seção 13). E o que isto garante, um adapter sozinho não garantiria:
 *
 * - **Um evento terminal, sempre.** `execute` é um `AsyncIterable` que nunca
 *   lança para quem consome. Preflight que falha, spawn que não nasce, parser
 *   que quebra, promessa que rejeita: tudo vira `RunFailed`. Um `for await` do
 *   worker não precisa de `try`.
 * - **Dois relógios nossos.** Ocioso (silêncio por N ms) e de conclusão (teto
 *   total). O Sandcastle tem um par parecido, mas força a conclusão sem matar
 *   ninguém, deixando o agente e os filhos dele órfãos no host; aqui os dois
 *   terminam em kill de árvore com confirmação por polling.
 * - **`RunCancelled` só depois da árvore sumir.** O evento carrega
 *   `processTreeTerminated`, e `false` é um resultado que a interface mostra em
 *   vez de esconder.
 * - **Ambiente por allow-list e worktree por Run**, montados antes de qualquer
 *   processo subir.
 */

import type {
  ExecutionEvent,
  HarnessKey,
  TimeoutKind,
  UsageSummary,
} from "@dungeon-master/contracts";

import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import { buildExecutionEnv } from "./env.js";
import type {
  ExecutionRequest,
  ExecutionResult,
  StructuredOutputSpec,
} from "./execution-request.js";
import { DEFAULT_OUTPUT_TAG } from "./execution-request.js";
import type {
  HarnessAdapter,
  HarnessCancelResult,
  HarnessEvent,
  HarnessExecutionRequest,
  HarnessFinishedEvent,
  PreflightResult,
  ResolvedPermission,
} from "./harness.js";
import { isHarnessFinished, RuntimeRequestError } from "./harness.js";
import type { HarnessRegistry } from "./registry.js";
import type { StructuredOutputResult } from "./structured-output.js";
import {
  applyStructuredOutputInstruction,
  buildStructuredOutputRetryPrompt,
  extractStructuredOutput,
} from "./structured-output.js";
import type {
  EnforcementLevel,
  ExecutionProfileSnapshot,
  ExecutionStatus,
  ExecutionTimeouts,
} from "./types.js";
import { DEFAULT_EXECUTION_TIMEOUTS } from "./types.js";
import type { ResolvedWorkspace, WorkspaceResolver } from "./workspace-resolver.js";

/** Como o `RunTimedOut` classifica o estouro; espelha `TimeoutKind` do contrato. */
type RuntimeTimeoutKind = TimeoutKind;

/**
 * Teto da espera de `cancel()`.
 *
 * Generoso porque o kill no Windows sobe um `taskkill` e confirma por polling,
 * e apertado o bastante para que um consumidor travado não segure quem cancelou
 * para sempre.
 */
const CANCEL_WAIT_CEILING_MS = 60_000;

export interface AgentRuntimeOptions {
  readonly registry: HarnessRegistry;
  readonly workspace: WorkspaceResolver;
  readonly clock?: Clock;
  /** Padrões usados quando o `ExecutionRequest` não traz os seus. */
  readonly defaultTimeouts?: Partial<ExecutionTimeouts>;
  /** Origem do ambiente. Padrão: `process.env`. Existe para teste. */
  readonly envSource?: NodeJS.ProcessEnv;
  /**
   * Chaves de ambiente que todo adapter recebe além do piso do SO. Serve para
   * o worker declarar um proxy corporativo uma vez, em vez de em cada Loadout.
   */
  readonly extraEnvKeys?: readonly string[];
}

export interface AgentRuntime {
  execute<T>(request: ExecutionRequest<T>): AsyncIterable<ExecutionEvent>;
  /** Mata a árvore do Run e confirma o término. Sem execução ativa, não faz nada. */
  cancel(runId: string): Promise<void>;
}

interface RunControl {
  readonly cancelled: Promise<{ reason?: string }>;
  requestCancel(reason?: string): void;
  adapter?: HarnessAdapter;
  executionId?: string;
  /** Resolve quando o cancelamento terminou de matar a árvore. */
  finished: Promise<void>;
  settleFinished(): void;
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const clock = options.clock ?? systemClock;
  const runs = new Map<string, RunControl>();

  const register = (runId: string): RunControl => {
    if (runs.has(runId)) {
      throw new RuntimeRequestError(
        `O Run ${runId} já está em execução neste runtime. Um Run é uma tentativa concreta; para tentar de novo, crie outro.`,
        { code: "RUN_ALREADY_RUNNING" },
      );
    }
    let requestCancel!: (reason?: string) => void;
    const cancelled = new Promise<{ reason?: string }>((resolve) => {
      requestCancel = (reason) => {
        resolve(reason === undefined ? {} : { reason });
      };
    });
    let settleFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      settleFinished = resolve;
    });
    const control: RunControl = { cancelled, requestCancel, finished, settleFinished };
    runs.set(runId, control);
    return control;
  };

  async function* execute<T>(request: ExecutionRequest<T>): AsyncIterable<ExecutionEvent> {
    const harnessKey = request.harness.key;
    const startedAt = clock.now();
    const stamp = <E extends { type: string }>(
      event: E,
    ): E & {
      timestamp: string;
      harness: HarnessKey;
    } => ({ ...event, timestamp: clock.nowIso(), harness: harnessKey });

    const diagnostic = (
      level: "DEBUG" | "INFO" | "WARN" | "ERROR",
      message: string,
      detail?: string,
    ): ExecutionEvent =>
      stamp({
        type: "Diagnostic" as const,
        level,
        source: "RUNTIME" as const,
        message,
        ...(detail === undefined ? {} : { detail }),
      });

    let control: RunControl;
    try {
      control = register(request.runId);
    } catch (error) {
      yield stamp({
        type: "RunFailed" as const,
        error: { message: describeError(error) },
        retryable: false,
        durationMs: clock.now() - startedAt,
      });
      return;
    }

    const onAbort = (): void => {
      control.requestCancel("AbortSignal");
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted === true) control.requestCancel("AbortSignal");

    let workspace: ResolvedWorkspace | undefined;
    let status: ExecutionStatus = "FAILED";
    let sessionId: string | undefined;
    let usage: UsageSummary | undefined;

    try {
      const adapter = options.registry.resolve(harnessKey);
      control.adapter = adapter;

      // ---------------------------------------------------------- capabilities
      if (request.resume !== undefined && !adapter.capabilities.resume) {
        yield stamp({
          type: "RunFailed" as const,
          error: {
            message: `O adapter ${adapter.id} não retoma sessão, e o pedido trouxe resume=${request.resume.harnessSessionId}.`,
            code: "RESUME_UNSUPPORTED",
          },
          retryable: false,
          durationMs: clock.now() - startedAt,
        });
        return;
      }
      if (request.outputSchema !== undefined && !adapter.capabilities.structuredOutput) {
        yield stamp({
          type: "RunFailed" as const,
          error: {
            message: `O adapter ${adapter.id} não produz resultado estruturado, e o pedido trouxe outputSchema.`,
            code: "STRUCTURED_OUTPUT_UNSUPPORTED",
          },
          retryable: false,
          durationMs: clock.now() - startedAt,
        });
        return;
      }

      // ------------------------------------------------------------- preflight
      const preflight: PreflightResult = await adapter.preflight({
        mode: request.executionProfile.mode,
      });
      const fatal = preflight.problems.filter((problem) => problem.fatal);
      for (const problem of preflight.problems.filter((p) => !p.fatal)) {
        yield diagnostic("WARN", `Preflight de ${adapter.id}: ${problem.message}`, problem.code);
      }
      if (!preflight.installed || fatal.length > 0) {
        const message =
          fatal.length > 0
            ? fatal.map((problem) => problem.message).join(" ")
            : `${adapter.id} não está instalado ou não foi encontrado no PATH.`;
        yield stamp({
          type: "RunFailed" as const,
          // Preflight não melhora com retentativa: instalar a CLI é ação
          // humana. Marcar como retryable faria o worker girar em falso.
          error: { message, code: fatal[0]?.code ?? "NOT_INSTALLED" },
          retryable: false,
          durationMs: clock.now() - startedAt,
        });
        return;
      }
      const harnessVersion = preflight.version ?? "desconhecida";

      // ------------------------------------------------------------- workspace
      workspace = await options.workspace.resolve(request);

      // ------------------------------------------------------------ permissões
      const permission = resolvePermission(request.executionProfile, adapter);
      for (const note of permission.notes) {
        yield diagnostic(note.level, note.message);
      }

      // ------------------------------------------------------------- ambiente
      const env = buildExecutionEnv({
        ...(request.executionProfile.environmentPolicy === undefined
          ? {}
          : { policy: request.executionProfile.environmentPolicy }),
        adapterKeys: [...(options.extraEnvKeys ?? []), ...adapterEnvKeys(adapter)],
        ...(options.envSource === undefined ? {} : { source: options.envSource }),
      });

      const model = request.model ?? request.loadout.model;
      if (model !== undefined && !adapter.capabilities.modelSelection) {
        yield diagnostic(
          "WARN",
          `O adapter ${adapter.id} não aceita escolha de modelo; ${model.id} foi ignorado.`,
        );
      }

      const timeouts = resolveTimeouts(request.timeouts, options.defaultTimeouts);

      yield stamp({
        type: "RunStarted" as const,
        harnessVersion,
        ...(model === undefined ? {} : { model: model.id }),
        workspacePath: workspace.cwd,
        executionMode: request.executionProfile.mode,
        enforcement: permission.permission.enforcement,
      });

      // ------------------------------------------------------------ tentativas
      const spec = request.outputSchema;
      const tag = spec?.tag ?? DEFAULT_OUTPUT_TAG;
      const maxAttempts = spec === undefined ? 1 : 1 + Math.max(0, spec.maxRetries ?? 1);

      let prompt = applyStructuredOutputInstruction(request.prompt, spec);
      let resume = request.resume;
      let lastFailure: Extract<StructuredOutputResult<unknown>, { ok: false }> | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const harnessRequest: HarnessExecutionRequest = {
          executionId: request.runId,
          cwd: workspace.cwd,
          prompt,
          env,
          ...(model === undefined ? {} : { model }),
          ...(resume === undefined
            ? {}
            : {
                resume: {
                  harnessSessionId: resume.harnessSessionId,
                  ...(resume.fork === undefined ? {} : { fork: resume.fork }),
                },
              }),
          permission: permission.permission,
          ...(request.loadout.harnessArgs === undefined
            ? {}
            : { extraArgs: request.loadout.harnessArgs }),
        };
        control.executionId = harnessRequest.executionId;

        const attemptRun = runAttempt({
          adapter,
          request: harnessRequest,
          timeouts,
          clock,
          control,
          startedAt,
        });

        let outcome: AttemptOutcome | undefined;
        for await (const step of attemptRun) {
          if (step.kind === "event") {
            if (step.event.type === "SessionCaptured") sessionId = step.event.harnessSessionId;
            if (step.event.type === "Usage") usage = step.event.usage;
            yield step.event;
            continue;
          }
          outcome = step.outcome;
        }

        /* c8 ignore next 3 -- runAttempt sempre termina emitindo um outcome. */
        if (outcome === undefined) {
          outcome = { kind: "ERROR", error: new Error("A tentativa terminou sem desfecho.") };
        }

        if (outcome.kind === "CANCELLED") {
          status = "CANCELLED";
          yield stamp({
            type: "RunCancelled" as const,
            ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
            processTreeTerminated: outcome.cancel.terminated,
            ...(outcome.cancel.method === undefined
              ? {}
              : { terminationMethod: outcome.cancel.method }),
            elapsedMs: clock.now() - startedAt,
          });
          return;
        }

        if (outcome.kind === "TIMEOUT") {
          status = "TIMED_OUT";
          if (!outcome.cancel.terminated) {
            yield diagnostic(
              "ERROR",
              `O timeout ${outcome.timeoutKind} matou a árvore de processos, mas o desaparecimento não foi confirmado em ${String(timeouts.killConfirmMs)} ms.`,
            );
          }
          yield stamp({
            type: "RunTimedOut" as const,
            kind: outcome.timeoutKind,
            elapsedMs: outcome.elapsedMs,
            limitMs: outcome.limitMs,
            processTreeTerminated: outcome.cancel.terminated,
            ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
          });
          return;
        }

        if (outcome.kind === "ERROR") {
          status = "FAILED";
          yield stamp({
            type: "RunFailed" as const,
            error: { message: describeError(outcome.error), code: "RUNTIME_ERROR" },
            retryable: true,
            ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
            durationMs: clock.now() - startedAt,
          });
          return;
        }

        const finished = outcome.finished;
        if (finished.harnessSessionId !== undefined) sessionId = finished.harnessSessionId;
        if (finished.usage !== undefined) usage = finished.usage;

        const failure = describeHarnessFailure(finished);
        if (failure !== undefined) {
          status = "FAILED";
          if (finished.stderrTail.trim().length > 0) {
            yield diagnostic("ERROR", "Saída de erro do harness.", finished.stderrTail);
          }
          yield stamp({
            type: "RunFailed" as const,
            error: failure.error,
            retryable: failure.retryable,
            ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
            durationMs: clock.now() - startedAt,
          });
          return;
        }

        const summary = finished.finalText ?? lastNonEmptyText(finished.assistantText);

        if (spec === undefined) {
          status = "SUCCEEDED";
          yield stamp({
            type: "RunCompleted" as const,
            summary,
            ...(usage === undefined ? {} : { usage }),
            ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
            durationMs: clock.now() - startedAt,
          });
          return;
        }

        const extracted = await extractStructuredOutput(finished.assistantText, spec);
        if (extracted.ok) {
          status = "SUCCEEDED";
          yield stamp({
            type: "RunCompleted" as const,
            summary,
            output: extracted.value,
            ...(usage === undefined ? {} : { usage }),
            ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
            durationMs: clock.now() - startedAt,
          });
          return;
        }

        lastFailure = extracted;
        yield diagnostic(
          "WARN",
          `Tentativa ${String(attempt)} de ${String(maxAttempts)}: ${extracted.message}`,
          extracted.raw,
        );

        const canRetry =
          attempt < maxAttempts && adapter.capabilities.resume && sessionId !== undefined;

        if (!canRetry) break;

        prompt = buildStructuredOutputRetryPrompt(extracted, tag);
        resume = { harnessSessionId: sessionId as string };
      }

      status = "FAILED";
      const rawDetail = lastFailure?.raw;
      yield diagnostic(
        "ERROR",
        "O agente não produziu um resultado estruturado válido.",
        rawDetail ?? "(nenhum bloco foi emitido)",
      );
      yield stamp({
        type: "RunFailed" as const,
        error: {
          message: lastFailure?.message ?? `O bloco <${tag}> não apareceu na saída do agente.`,
          code: "STRUCTURED_OUTPUT_INVALID",
        },
        // Não é retentável: o agente já teve a chance de corrigir e o resultado
        // é determinístico o bastante para uma segunda rodada repetir o erro.
        retryable: false,
        ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
        durationMs: clock.now() - startedAt,
      });
      return;
    } catch (error) {
      status = "FAILED";
      yield stamp({
        type: "RunFailed" as const,
        error: {
          message: describeError(error),
          code: error instanceof RuntimeRequestError ? error.code : "UNEXPECTED",
        },
        retryable: error instanceof RuntimeRequestError ? error.retryable : true,
        ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
        durationMs: clock.now() - startedAt,
      });
      return;
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
      runs.delete(request.runId);
      control.settleFinished();
      if (workspace !== undefined) {
        // A limpeza nunca derruba o Run: o evento terminal já saiu, e um
        // worktree que sobrou é um problema de disco, não de execução.
        await workspace.release(status).catch(() => undefined);
      }
    }
  }

  return {
    execute,
    cancel: async (runId: string) => {
      const control = runs.get(runId);
      if (control === undefined) return;
      control.requestCancel("cancel() do runtime");
      // Espera a árvore ser tratada — não o consumidor terminar de ler. A
      // promessa é resolvida logo depois do kill, dentro da tentativa; o teto
      // existe para que um consumidor que parou de puxar não trave quem
      // cancelou.
      const guard = createTimer(CANCEL_WAIT_CEILING_MS);
      try {
        await Promise.race([control.finished, guard.promise]);
      } finally {
        guard.cancel();
      }
    },
  };
}

// ---------------------------------------------------------------- tentativa

type AttemptOutcome =
  | { readonly kind: "FINISHED"; readonly finished: HarnessFinishedEvent }
  | {
      readonly kind: "TIMEOUT";
      readonly timeoutKind: RuntimeTimeoutKind;
      readonly elapsedMs: number;
      readonly limitMs: number;
      readonly cancel: HarnessCancelResult;
    }
  | {
      readonly kind: "CANCELLED";
      readonly reason?: string;
      readonly cancel: HarnessCancelResult;
    }
  | { readonly kind: "ERROR"; readonly error: Error };

type AttemptStep =
  | { readonly kind: "event"; readonly event: ExecutionEvent }
  | { readonly kind: "outcome"; readonly outcome: AttemptOutcome };

interface RunAttemptOptions {
  readonly adapter: HarnessAdapter;
  readonly request: HarnessExecutionRequest;
  readonly timeouts: Required<ExecutionTimeouts>;
  readonly clock: Clock;
  readonly control: RunControl;
  readonly startedAt: number;
}

/**
 * Uma passagem pelo adapter, com os dois relógios e o cancelamento.
 *
 * A corrida é entre quatro coisas: o próximo evento do adapter, o silêncio, o
 * teto total e o pedido de cancelamento. Perder a corrida não é motivo para
 * largar o `next()` pendente: ele é drenado depois do kill, e é durante essa
 * drenagem que o id de sessão de um agente morto ainda costuma aparecer.
 */
async function* runAttempt(options: RunAttemptOptions): AsyncGenerator<AttemptStep> {
  const { adapter, request, timeouts, clock, control } = options;
  const attemptStartedAt = clock.now();
  const completionDeadline = attemptStartedAt + timeouts.completionMs;

  let iterator: AsyncIterator<HarnessEvent>;
  try {
    iterator = adapter.execute(request)[Symbol.asyncIterator]();
  } catch (error) {
    yield { kind: "outcome", outcome: { kind: "ERROR", error: toError(error) } };
    return;
  }

  let pending: Promise<IteratorResult<HarnessEvent>> | undefined;

  const kill = async (): Promise<HarnessCancelResult> => {
    let result: HarnessCancelResult;
    try {
      result = await adapter.cancel(request.executionId);
    } catch (error) {
      result = { terminated: false, elapsedMs: 0, method: describeError(error) };
    }
    // Quem pediu o cancelamento já pode voltar: a árvore foi tratada. Esperar
    // o consumidor puxar o evento terminal transformaria `cancel()` num
    // impasse quando o mesmo código consome e cancela.
    control.settleFinished();
    await drain(iterator, pending);
    return result;
  };

  // Derivada uma vez só: dentro do laço, cada iteração acrescentaria uma
  // reação nova a uma promessa que vive o Run inteiro.
  const cancelledWinner = control.cancelled.then((info): RaceWinner => ({
    kind: "cancelled",
    ...(info.reason === undefined ? {} : { reason: info.reason }),
  }));

  for (;;) {
    if (pending === undefined) pending = iterator.next();

    const idleLimit = timeouts.idleMs;
    const remainingCompletion = Math.max(0, completionDeadline - clock.now());
    const waitMs = Math.min(idleLimit, remainingCompletion);

    const timer = createTimer(waitMs);
    let winner: RaceWinner;
    try {
      winner = await Promise.race([
        pending.then(
          (result): RaceWinner => ({ kind: "next", result }),
          (error): RaceWinner => ({ kind: "failed", error: toError(error) }),
        ),
        timer.promise.then((): RaceWinner => ({ kind: "timeout" })),
        cancelledWinner,
      ]);
    } finally {
      timer.cancel();
    }

    if (winner.kind === "cancelled") {
      const cancel = await kill();
      yield {
        kind: "outcome",
        outcome: {
          kind: "CANCELLED",
          ...(winner.reason === undefined ? {} : { reason: winner.reason }),
          cancel,
        },
      };
      return;
    }

    if (winner.kind === "timeout") {
      const elapsed = clock.now() - attemptStartedAt;
      const timeoutKind: RuntimeTimeoutKind =
        remainingCompletion <= idleLimit ? "COMPLETION" : "IDLE";
      const cancel = await kill();
      yield {
        kind: "outcome",
        outcome: {
          kind: "TIMEOUT",
          timeoutKind,
          elapsedMs: elapsed,
          limitMs: timeoutKind === "COMPLETION" ? timeouts.completionMs : idleLimit,
          cancel,
        },
      };
      return;
    }

    if (winner.kind === "failed") {
      pending = undefined;
      yield { kind: "outcome", outcome: { kind: "ERROR", error: winner.error } };
      return;
    }

    pending = undefined;
    const { result } = winner;
    if (result.done === true) {
      yield {
        kind: "outcome",
        outcome: {
          kind: "ERROR",
          error: new Error(
            `O adapter ${adapter.id} encerrou o stream sem emitir HarnessFinished. Todo adapter precisa fechar com um desfecho.`,
          ),
        },
      };
      return;
    }

    const event = result.value;
    if (isHarnessFinished(event)) {
      yield { kind: "outcome", outcome: { kind: "FINISHED", finished: event } };
      return;
    }
    yield { kind: "event", event };
  }
}

type RaceWinner =
  | { kind: "next"; result: IteratorResult<HarnessEvent> }
  | { kind: "failed"; error: Error }
  | { kind: "timeout" }
  | { kind: "cancelled"; reason?: string };

/** Timer que não segura o event loop e que é sempre cancelado. */
function createTimer(ms: number): { promise: Promise<void>; cancel: () => void } {
  let handle: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
    handle.unref?.();
  });
  return {
    promise,
    cancel: () => {
      if (handle !== undefined) clearTimeout(handle);
    },
  };
}

/**
 * Consome o resto do stream depois do kill, com teto.
 *
 * Sem isto, o `next()` pendente vira uma promessa órfã e o gerador do adapter
 * nunca roda o `finally` dele — que é onde os listeners do processo saem. Com
 * teto porque um adapter travado não pode travar o Run que já terminou.
 */
async function drain(
  iterator: AsyncIterator<HarnessEvent>,
  pending: Promise<IteratorResult<HarnessEvent>> | undefined,
): Promise<void> {
  const DRAIN_BUDGET_MS = 5_000;
  const deadline = Date.now() + DRAIN_BUDGET_MS;
  const timer = createTimer(DRAIN_BUDGET_MS);

  const consume = async (): Promise<void> => {
    try {
      let result = pending === undefined ? await iterator.next() : await pending;
      while (result.done !== true && Date.now() < deadline) {
        result = await iterator.next();
      }
    } catch {
      // Um adapter que rejeita depois do kill é esperado; o desfecho já foi
      // decidido.
    }
  };

  await Promise.race([consume(), timer.promise]);
  timer.cancel();
  try {
    await iterator.return?.(undefined);
  } catch {
    // Idem.
  }
}

// ---------------------------------------------------------------- auxiliares

interface PermissionNote {
  readonly level: "INFO" | "WARN";
  readonly message: string;
}

interface ResolvedPermissionWithNotes {
  readonly permission: ResolvedPermission;
  readonly notes: readonly PermissionNote[];
}

/**
 * Traduz a política do perfil para o que o adapter recebe.
 *
 * A regra dura: `BYPASS` fora de um ambiente com isolamento imposto é
 * rebaixado, e o rebaixamento aparece como `Diagnostic`. Só passa com
 * `SANDBOX_ENFORCED` (hoje, `DOCKER`) ou com `allowBypassWithoutSandbox`
 * explícito na política — que é o opt-in visível que o planejamento exige
 * (Fase 3C: "`bypass` é visível e opt-in; nunca default").
 */
export function resolvePermission(
  profile: ExecutionProfileSnapshot,
  adapter: HarnessAdapter,
): ResolvedPermissionWithNotes {
  const policy = profile.permissionPolicy;
  const notes: PermissionNote[] = [];
  const sandboxEnforced = profile.mode === "DOCKER";
  const requested = policy?.mode ?? "DEFAULT";

  let mode = requested;
  if (mode === "BYPASS" && !sandboxEnforced && policy?.allowBypassWithoutSandbox !== true) {
    mode = "DEFAULT";
    notes.push({
      level: "WARN",
      message:
        "A política pediu BYPASS sem isolamento imposto e sem opt-in explícito; foi rebaixada para o modo padrão da CLI.",
    });
  } else if (mode === "BYPASS") {
    notes.push({
      level: "WARN",
      message: sandboxEnforced
        ? "Permissões em BYPASS dentro de um ambiente isolado."
        : "Permissões em BYPASS sem isolamento, por opt-in explícito da política. O agente roda com as permissões do usuário.",
    });
  }

  // `CONFIGURED` sem `harnessMode` **e** sem `grant` não configura nada: não há
  // modo nativo a pedir nem concessão a traduzir, e o que sobraria seria o
  // padrão da CLI com outro nome. Com um dos dois, o adapter tem o que montar.
  if (mode === "CONFIGURED" && policy?.harnessMode === undefined && policy?.grant === undefined) {
    mode = "DEFAULT";
    notes.push({
      level: "WARN",
      message:
        "A política pediu CONFIGURED sem `harnessMode` e sem concessão; sem nenhum dos dois, vale o padrão da CLI.",
    });
  }

  const enforcement: EnforcementLevel = sandboxEnforced
    ? "SANDBOX_ENFORCED"
    : mode !== "BYPASS" && adapter.capabilities.nativePermissions
      ? "HARNESS_NATIVE"
      : "ADVISORY";

  return {
    permission: {
      mode,
      ...(mode === "CONFIGURED" && policy?.harnessMode !== undefined
        ? { harnessMode: policy.harnessMode }
        : {}),
      ...(mode === "CONFIGURED" && policy?.grant !== undefined ? { grant: policy.grant } : {}),
      enforcement,
    },
    notes,
  };
}

function resolveTimeouts(
  fromRequest: Partial<ExecutionTimeouts> | undefined,
  fromOptions: Partial<ExecutionTimeouts> | undefined,
): Required<ExecutionTimeouts> {
  const merged = { ...DEFAULT_EXECUTION_TIMEOUTS, ...fromOptions, ...fromRequest };
  for (const key of ["idleMs", "completionMs", "killGraceMs", "killConfirmMs"] as const) {
    const value = merged[key];
    if (!Number.isFinite(value) || value <= 0) {
      throw new RuntimeRequestError(
        `${key} precisa ser um número finito positivo; recebi ${JSON.stringify(value)}.`,
        { code: "INVALID_TIMEOUT" },
      );
    }
  }
  return merged;
}

/**
 * O desfecho do adapter é falha?
 *
 * Código de saída diferente de zero é falha; morte por sinal também, e essa é
 * retentável porque quase sempre veio de fora (o SO matou, o usuário derrubou
 * o terminal). Um erro que o próprio adapter observou traz o `retryable` dele.
 */
function describeHarnessFailure(
  finished: HarnessFinishedEvent,
):
  { error: { message: string; code?: string; exitCode?: number }; retryable: boolean } | undefined {
  if (finished.error !== undefined) {
    return {
      error: {
        message: finished.error.message,
        code: "HARNESS_ERROR",
        ...(finished.exitCode === null ? {} : { exitCode: finished.exitCode }),
      },
      retryable: finished.error.retryable,
    };
  }
  if (finished.signal !== null) {
    return {
      error: { message: `O processo do harness foi morto por ${finished.signal}.`, code: "KILLED" },
      retryable: true,
    };
  }
  if (finished.exitCode !== 0) {
    const tail = finished.stderrTail.trim();
    return {
      error: {
        message:
          tail.length > 0
            ? `O harness saiu com código ${String(finished.exitCode)}: ${truncate(tail, 500)}`
            : `O harness saiu com código ${String(finished.exitCode)}.`,
        code: "NON_ZERO_EXIT",
        ...(finished.exitCode === null ? {} : { exitCode: finished.exitCode }),
      },
      retryable: true,
    };
  }
  return undefined;
}

function adapterEnvKeys(adapter: HarnessAdapter): readonly string[] {
  return adapter.environmentKeys ?? [];
}

function lastNonEmptyText(text: string): string {
  return text.trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function describeError(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

/**
 * Consome o fluxo e devolve o desfecho como objeto.
 *
 * Conveniência para quem só quer o resultado — o worker, que persiste evento a
 * evento, continua usando o `AsyncIterable`.
 */
export async function collectExecutionResult<T>(
  events: AsyncIterable<ExecutionEvent>,
  context: { harness: ExecutionRequest["harness"]; harnessVersion?: string },
): Promise<ExecutionResult<T>> {
  let status: ExecutionStatus = "FAILED";
  let harnessVersion = context.harnessVersion ?? "desconhecida";
  let workspacePath: string | undefined;
  let sessionId: string | undefined;
  let usage: UsageSummary | undefined;
  let output: T | undefined;
  let summary: string | undefined;
  let error: ExecutionResult["error"];
  let durationMs = 0;

  for await (const event of events) {
    switch (event.type) {
      case "RunStarted":
        harnessVersion = event.harnessVersion;
        workspacePath = event.workspacePath;
        break;
      case "SessionCaptured":
        sessionId = event.harnessSessionId;
        break;
      case "Usage":
        usage = event.usage;
        break;
      case "RunCompleted":
        status = "SUCCEEDED";
        summary = event.summary;
        output = event.output as T | undefined;
        if (event.usage !== undefined) usage = event.usage;
        if (event.harnessSessionId !== undefined) sessionId = event.harnessSessionId;
        durationMs = event.durationMs;
        break;
      case "RunFailed":
        status = "FAILED";
        error = {
          message: event.error.message,
          ...(event.error.code === undefined ? {} : { code: event.error.code }),
          retryable: event.retryable,
        };
        if (event.harnessSessionId !== undefined) sessionId = event.harnessSessionId;
        durationMs = event.durationMs;
        break;
      case "RunTimedOut":
        status = "TIMED_OUT";
        error = {
          message: `Timeout ${event.kind} após ${String(event.elapsedMs)} ms.`,
          code: "TIMEOUT",
          retryable: true,
        };
        if (event.harnessSessionId !== undefined) sessionId = event.harnessSessionId;
        durationMs = event.elapsedMs;
        break;
      case "RunCancelled":
        status = "CANCELLED";
        durationMs = event.elapsedMs;
        break;
      default:
        break;
    }
  }

  return {
    status,
    harness: context.harness,
    harnessVersion,
    ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
    ...(usage === undefined ? {} : { usage }),
    ...(output === undefined ? {} : { output }),
    ...(summary === undefined ? {} : { summary }),
    ...(error === undefined ? {} : { error }),
    ...(workspacePath === undefined ? {} : { workspacePath }),
    durationMs,
  };
}

export type { StructuredOutputSpec };
