import type {
  ExecutionEvent,
  HarnessKey,
  RunResult,
  TaskExecutionResult,
  UsageSummary,
} from "@dungeon-master/contracts";
import {
  TaskExecutionResultSchema,
  TASK_EXECUTION_RESULT_INSTRUCTION,
} from "@dungeon-master/contracts";
import {
  acquireWorkspaceLock,
  appendRunEvent,
  getActiveRunByPath,
  getRun,
  recordDomainEvent,
  releaseWorkspaceLock,
  transitionRun,
  updateRunExecutionFields,
  writeRunTerminalStatus,
  type ClaimedRun,
  type Database,
  type RunEventInput,
} from "@dungeon-master/database";
import { isTerminalStatusWriteError } from "@dungeon-master/events";
import { normalizeAbsolutePath } from "@dungeon-master/platform";
import type {
  AgentRuntime,
  CommitRef,
  ExecutionRequest,
  WorkspaceManager,
  WorktreeHandle,
} from "@dungeon-master/runtime";

import type { Logger } from "./logger.js";
import { resolveRunPolicies } from "./policy.js";
import { toRunEventInput, workerDiagnostic, workerRunFailed } from "./run-events.js";

/** Os quatro eventos que fecham o fluxo. Um deles sempre chega, e é o último. */
type TerminalExecutionEvent = Extract<
  ExecutionEvent,
  { type: "RunCompleted" | "RunFailed" | "RunTimedOut" | "RunCancelled" }
>;

/**
 * A execução de um Run, do claim ao desfecho gravado.
 *
 * É aqui que a 2A e a 2B se encontram: o modelo (fila, trava, log append-only,
 * escrita terminal transacional) de um lado, o runtime (worktree, timeouts,
 * kill de árvore, resultado estruturado) do outro. Esta função é a única que
 * conhece os dois.
 *
 * A ordem não é arbitrária, e cada passo existe por um acidente conhecido:
 *
 * 1. **Trava de workspace antes de qualquer processo.** Dois `run()` do
 *    Sandcastle com a mesma branch nomeada recebem o mesmo diretório e
 *    corrompem em silêncio (documento técnico, seção 16); a trava é nossa e
 *    mora no PostgreSQL.
 * 2. **Worktree depois da trava.** Criar primeiro deixaria diretório órfão
 *    quando a trava fosse recusada.
 * 3. **Confirmação de posse imediatamente antes de subir o processo.** Entre
 *    dois Runs que ainda não começaram, a trava vai para o de `id` menor; é o
 *    desempate determinístico da 2A, e a única janela em que um Run perde uma
 *    trava que pegou.
 * 4. **`RunStarted` é quem move `PREPARING → RUNNING`.** O estado do banco segue
 *    o processo, não a intenção.
 * 5. **O evento terminal e o status terminal saem na mesma transação.** Um Run
 *    `SUCCEEDED` cujo `RunCompleted` não foi gravado contaria a história pela
 *    metade.
 */

export interface ExecuteRunDeps {
  readonly db: Database;
  readonly userId: string;
  readonly runtime: AgentRuntime;
  readonly workspace: WorkspaceManager;
  readonly logger?: Logger;
  readonly timeouts: { readonly idleMs: number; readonly completionMs: number };
  /**
   * Motivo do cancelamento, quando quem pediu foi o próprio Worker.
   *
   * O desligamento gracioso cancela os Runs em voo, e o desfecho precisa dizer
   * que foi o Worker saindo — `retryable`, portanto — e não o usuário
   * desistindo. O mapa é preenchido antes de `runtime.cancel`.
   */
  readonly cancelReasons?: Map<string, string>;
}

/** O que a preparação decidiu, antes de o primeiro processo subir. */
interface Preparation {
  readonly repoPath: string;
  readonly checkoutPath: string;
  readonly worktree: WorktreeHandle | undefined;
}

export async function executeRun(deps: ExecuteRunDeps, claimed: ClaimedRun): Promise<void> {
  const { db, userId, logger } = deps;
  const { run, project, task } = claimed;
  const harness: HarnessKey = run.harnessKey;
  const iniciadoEm = Date.now();

  let preparation: Preparation | undefined;
  let lockAcquired = false;
  let terminalWritten = false;
  let sessionId: string | null = run.harnessSessionId;
  let harnessVersion: string | null = run.harnessVersion;
  let usage: UsageSummary | undefined;

  const append = async (event: ExecutionEvent): Promise<void> => {
    await appendRunEvent(db, {
      userId,
      runId: run.id,
      event: toRunEventInput(event),
      ...(logger === undefined ? {} : { logger }),
    });
  };

  const diagnostic = async (
    level: "INFO" | "WARN" | "ERROR",
    message: string,
    detail?: string,
  ): Promise<void> => {
    await append(
      workerDiagnostic({
        harness,
        level,
        message,
        ...(detail === undefined ? {} : { detail }),
      }),
    );
  };

  /**
   * Fecha o Run sem que nenhum processo tenha subido.
   *
   * `PREPARING → FAILED` existe justamente para isto: preflight, worktree e
   * trava são trabalho que pode dar errado antes do agente, e uma falha ali não
   * é um Run que rodou mal — é um Run que não chegou a rodar.
   */
  const failPreparation = async (input: {
    code: string;
    message: string;
    retryable: boolean;
    detail?: string;
    extra?: Record<string, unknown>;
  }): Promise<void> => {
    await diagnostic("ERROR", input.message, input.detail);
    const evento = workerRunFailed({
      harness,
      code: input.code,
      message: input.message,
      retryable: input.retryable,
      durationMs: Date.now() - iniciadoEm,
    });
    await writeTerminal({
      status: "FAILED",
      error: {
        code: input.code,
        message: input.message,
        retryable: input.retryable,
        ...(input.extra ?? {}),
      },
      events: [toRunEventInput(evento)],
    });
  };

  const writeTerminal = async (input: {
    status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
    result?: RunResult;
    error?: Record<string, unknown> & { message: string };
    events: readonly RunEventInput[];
  }): Promise<void> => {
    try {
      await writeRunTerminalStatus(db, {
        userId,
        runId: run.id,
        status: input.status,
        ...(input.result === undefined ? {} : { result: input.result }),
        ...(input.error === undefined ? {} : { error: input.error }),
        ...(harnessVersion === null ? {} : { harnessVersion }),
        ...(sessionId === null ? {} : { harnessSessionId: sessionId }),
        events: input.events,
        ...(logger === undefined ? {} : { logger }),
      });
      terminalWritten = true;
    } catch (error) {
      // Nenhum resultado comum pode ser reportado pelo canal que acabou de
      // falhar (CLAUDE.md, seção 9). O log é o que sobra, e a reconciliação da
      // próxima partida fecha o Run.
      const nivel = isTerminalStatusWriteError(error) ? "fatal" : "error";
      logger?.[nivel](
        { err: error, runId: run.id, status: input.status },
        "falha ao gravar o status terminal do Run; sem escrita compensatória",
      );
    }
  };

  try {
    // ------------------------------------------------------------ workspace
    if (project.workspacePath === null || project.workspacePath.trim() === "") {
      await failPreparation({
        code: "PROJECT_WITHOUT_WORKSPACE",
        message:
          "O Project não tem um caminho de workspace, e um agente sem diretório de trabalho " +
          "não é um Run que roda pior: é um Run que não pode começar.",
        retryable: false,
      });
      return;
    }

    const repoPath = normalizeAbsolutePath(project.workspacePath);
    const strategy = run.executionProfileSnapshot.workspaceStrategy;

    if (strategy === "COPY") {
      await failPreparation({
        code: "WORKSPACE_STRATEGY_UNSUPPORTED",
        message:
          "A estratégia de workspace COPY ainda não existe. Use CURRENT ou GIT_WORKTREE no " +
          "ExecutionProfile.",
        retryable: false,
      });
      return;
    }

    const checkoutPath =
      strategy === "GIT_WORKTREE" ? deps.workspace.worktreePathFor(repoPath, run.id) : repoPath;

    // (a) A trava vem antes de tudo: ela é o que garante um Run ativo por par
    // (repositório, caminho de checkout), inclusive entre processos diferentes.
    const lock = await acquireWorkspaceLock(db, {
      userId,
      repoPath,
      checkoutPath,
      runId: run.id,
    });

    if (!lock.acquired) {
      await failPreparation({
        code: "WORKSPACE_LOCKED",
        message:
          `O caminho ${checkoutPath} já está reservado pelo Run ${lock.heldBy}. ` +
          "Um Run ativo por caminho de checkout é a regra que impede dois agentes de " +
          "escreverem no mesmo diretório.",
        // Retentável: a trava sai sozinha quando o outro Run terminar.
        retryable: true,
        detail: `Motivo: ${lock.reason}. Reservado desde ${lock.heldSince}.`,
        extra: { heldByRunId: lock.heldBy, checkoutPath },
      });
      return;
    }
    lockAcquired = true;

    if (lock.reclaimed) {
      await diagnostic(
        "WARN",
        "A trava do workspace estava presa por um Run que já não existe e foi recuperada.",
        `Caminho: ${checkoutPath}.`,
      );
    }

    // (b) O worktree. O runtime recebe `checkoutPath` preenchido e, por
    // contrato, não cria nem remove nada — quem preparou desfaz.
    let worktree: WorktreeHandle | undefined;
    if (strategy === "GIT_WORKTREE") {
      try {
        worktree = await deps.workspace.create({ repoPath, runId: run.id });
      } catch (error) {
        await failPreparation({
          code: "WORKTREE_CREATE_FAILED",
          message: `Não consegui criar o worktree do Run em ${checkoutPath}.`,
          retryable: true,
          detail: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    preparation = { repoPath, checkoutPath, worktree };

    await updateRunExecutionFields(db, { userId, runId: run.id, workspacePath: checkoutPath });

    // (c) Confirmação de posse imediatamente antes de subir o processo. É a
    // leitura barata que fecha a janela do desempate por `id` menor.
    const dono = await getActiveRunByPath(db, { userId, repoPath, checkoutPath });
    if (dono === null || dono.id !== run.id) {
      await failPreparation({
        code: "WORKSPACE_LOCK_LOST",
        message:
          `A trava de ${checkoutPath} passou para o Run ${dono?.id ?? "(nenhum)"} entre a ` +
          "aquisição e a subida do processo. Nada foi executado.",
        retryable: true,
        extra: { checkoutPath },
      });
      return;
    }

    // (d) Políticas. A tradução é regra de domínio e mora em `policy.ts`.
    const politicas = resolveRunPolicies({
      profile: run.executionProfileSnapshot,
      harnessKey: harness,
      capabilities: run.loadoutSnapshot.harness.capabilities,
    });

    for (const nota of politicas.notes) {
      await diagnostic(nota.level === "DEBUG" ? "INFO" : nota.level, nota.message, nota.detail);
    }

    if (politicas.bypassWithoutSandbox) {
      // O diário do Project sobrevive à tela de histórico do Run, e é onde a
      // pergunta "por que esse agente teve permissão para tudo?" será feita.
      await db.transaction(async (tx) => {
        await recordDomainEvent(tx, {
          userId,
          projectId: project.id,
          taskId: task.id,
          taskTitle: task.title,
          type: "run.permission_bypassed",
          payload: {
            runId: run.id,
            taskId: task.id,
            projectId: project.id,
            executionMode: run.executionMode,
            enforcement: run.executionProfileSnapshot.enforcement,
            executionProfileName: run.executionProfileSnapshot.name,
          },
        });
      });
    }

    // (e) Retomada de sessão, quando o Run nasceu de um "retomar a Expedição".
    let resume: ExecutionRequest["resume"];
    if (run.resumedFromRunId !== null) {
      const origem = await getRun(db, { userId, runId: run.resumedFromRunId });
      const sessaoOrigem = origem?.harnessSessionId ?? null;
      if (sessaoOrigem === null) {
        await failPreparation({
          code: "RESUME_SOURCE_WITHOUT_SESSION",
          message:
            `O Run ${run.resumedFromRunId}, de onde este deveria retomar, não tem id de ` +
            "sessão do harness. Não há conversa a continuar.",
          retryable: false,
        });
        return;
      }
      resume = { harnessSessionId: sessaoOrigem };
    }

    const model = run.loadoutSnapshot.model;

    // O schema só é pedido a quem sabe produzi-lo: o `AgentRuntime` recusa o
    // pedido inteiro quando o adapter não declara `structuredOutput`, e recusar
    // um Run por causa de uma capability seria pior que aceitar o texto final e
    // sintetizar o desfecho a partir dele. A matriz lida é a do snapshot, que o
    // preflight de partida atualiza com a do adapter.
    const querSchema = run.loadoutSnapshot.harness.capabilities.structuredOutput;
    if (!querSchema) {
      await diagnostic(
        "WARN",
        `${harness} não produz resultado estruturado; o desfecho será sintetizado a partir ` +
          "do texto final do agente.",
      );
    }

    const request: ExecutionRequest<TaskExecutionResult> = {
      runId: run.id,
      taskId: run.taskId,
      workspace: { repoPath, checkoutPath },
      harness: { key: harness, id: run.loadoutSnapshot.harness.id },
      ...(model === null ? {} : { model: { id: model.key, name: model.name } }),
      loadout: {
        id: run.loadoutSnapshot.loadoutId,
        name: run.loadoutSnapshot.name,
        harness: { key: harness, id: run.loadoutSnapshot.harness.id },
        ...(model === null ? {} : { model: { id: model.key, name: model.name } }),
        systemPromptAppend: run.loadoutSnapshot.agent.instructions,
      },
      executionProfile: {
        id: run.executionProfileSnapshot.executionProfileId,
        name: run.executionProfileSnapshot.name,
        mode: run.executionProfileSnapshot.mode,
        workspaceStrategy: strategy,
        permissionPolicy: politicas.permission,
        environmentPolicy: politicas.environment,
      },
      prompt: buildPrompt(run.loadoutSnapshot.agent.instructions, run.prompt),
      ...(querSchema
        ? {
            outputSchema: {
              schema: TaskExecutionResultSchema,
              instruction: TASK_EXECUTION_RESULT_INSTRUCTION,
            },
          }
        : {}),
      timeouts: { idleMs: deps.timeouts.idleMs, completionMs: deps.timeouts.completionMs },
      ...(resume === undefined ? {} : { resume }),
    };

    // -------------------------------------------------------------- execução
    for await (const event of deps.runtime.execute(request)) {
      switch (event.type) {
        case "RunStarted": {
          harnessVersion = event.harnessVersion;
          const movido = await transitionRun(db, {
            userId,
            runId: run.id,
            to: "RUNNING",
            patch: { harnessVersion: event.harnessVersion, workspacePath: event.workspacePath },
            events: [toRunEventInput(event)],
          });
          // A transição carrega o evento na mesma transação. Quando ela é
          // recusada — um cancelamento que já levou o Run a terminal, por
          // exemplo —, o evento ainda precisa entrar no log.
          if (movido === null || !movido.ok) {
            logger?.warn(
              { runId: run.id, failure: movido === null ? "RUN_NOT_FOUND" : movido.failure },
              "não consegui mover o Run para RUNNING",
            );
            await append(event);
          }
          break;
        }

        case "SessionCaptured": {
          sessionId = event.harnessSessionId;
          await append(event);
          // Fora da transação da transição de propósito: o id de sessão chega
          // com o Run já em `RUNNING`, e não existe aresta `RUNNING → RUNNING`.
          await updateRunExecutionFields(db, {
            userId,
            runId: run.id,
            harnessSessionId: event.harnessSessionId,
          });
          break;
        }

        case "Usage":
          usage = event.usage;
          await append(event);
          break;

        case "RunCompleted":
        case "RunFailed":
        case "RunTimedOut":
        case "RunCancelled":
          await finalize(event);
          break;

        default:
          await append(event);
      }
    }

    if (!terminalWritten) {
      // O `AgentRuntime` promete um evento terminal em qualquer caminho. Chegar
      // aqui é defeito, e o Run não pode ficar `RUNNING` por causa dele.
      await failPreparation({
        code: "NO_TERMINAL_EVENT",
        message:
          "O runtime encerrou o fluxo de eventos sem um evento terminal. O desfecho real " +
          "deste Run é desconhecido.",
        retryable: true,
      });
    }
  } catch (error) {
    logger?.error({ err: error, runId: run.id }, "erro inesperado ao executar o Run");
    if (!terminalWritten) {
      await failPreparation({
        code: "WORKER_ERROR",
        message: "O Worker falhou ao conduzir este Run.",
        retryable: true,
        detail: error instanceof Error ? error.message : String(error),
        ...(preparation?.checkoutPath === undefined
          ? {}
          : { extra: { preservedWorktreePath: preparation.checkoutPath } }),
      });
    }
  } finally {
    // A trava sai sempre. `writeRunTerminalStatus` já a solta na transação do
    // desfecho; esta chamada cobre os caminhos em que o desfecho não foi
    // escrito, e é idempotente.
    if (lockAcquired) {
      await releaseWorkspaceLock(db, { userId, runId: run.id }).catch((error: unknown) => {
        logger?.error({ err: error, runId: run.id }, "falha ao liberar a trava de workspace");
      });
    }
  }

  // ------------------------------------------------------------------ fim
  /**
   * Traduz o evento terminal do runtime no desfecho gravado.
   *
   * Tudo o que precisa aparecer **antes** do evento terminal no log — os
   * commits coletados, o aviso de worktree preservado — é gravado aqui, antes
   * da escrita transacional. Depois de um evento terminal nada mais é emitido
   * (contrato do `ExecutionEvent`).
   */
  async function finalize(event: TerminalExecutionEvent): Promise<void> {
    const sucesso = event.type === "RunCompleted";
    const worktree = preparation?.worktree;

    let commits: readonly CommitRef[] = [];
    if (worktree !== undefined) {
      try {
        commits = await deps.workspace.collectCommits(worktree.path, worktree.baseCommit);
      } catch (error) {
        logger?.warn({ err: error, runId: run.id }, "não consegui coletar os commits do worktree");
      }
    }

    // O worktree é removido só num sucesso limpo. Falha, timeout, cancelamento
    // e mudança não commitada preservam: é onde está a prova do que aconteceu.
    let preservedPath: string | undefined = worktree === undefined ? undefined : worktree.path;

    if (worktree !== undefined && sucesso) {
      try {
        const removido = await deps.workspace.remove(worktree.path, { keepIfDirty: true });
        if (removido.removed) preservedPath = undefined;
      } catch (error) {
        logger?.warn({ err: error, runId: run.id }, "falha ao remover o worktree do Run");
      }
    }

    if (preservedPath !== undefined && worktree !== undefined) {
      await diagnostic(
        sucesso ? "WARN" : "INFO",
        sucesso
          ? "O worktree foi preservado porque sobrou mudança não commitada."
          : "O worktree foi preservado para você inspecionar o que aconteceu.",
        recoveryMessage({ worktree, commits }),
      );
    }

    if (event.type === "RunCompleted") {
      let estruturado = event.output as TaskExecutionResult | undefined;

      if (estruturado === undefined) {
        // A regra do domínio é "SUCCEEDED sem resultado estruturado leva a Task
        // a FAILED". Ela é rede de segurança, não o caminho normal: um agente
        // que fez o trabalho e esqueceu o bloco `<result>` não deveria custar a
        // Task. Sintetizamos o desfecho a partir do texto final e dizemos, alto,
        // que foi sintetizado.
        estruturado = {
          status: "completed",
          summary: event.summary.trim().length > 0 ? event.summary : "(sem resumo do agente)",
        };
        await diagnostic(
          "WARN",
          "O agente terminou sem o bloco <result>; o resultado foi sintetizado a partir do " +
            "texto final e o veredito assumido como `completed`.",
          "Confira o resumo antes de tratar a Task como concluída.",
        );
      }

      const result: RunResult = {
        ...estruturado,
        ...(usage === undefined ? {} : { usage }),
        ...(commits.length === 0 ? {} : { commits }),
        ...(preservedPath === undefined ? {} : { preservedWorktreePath: preservedPath }),
      };

      await writeTerminal({ status: "SUCCEEDED", result, events: [toRunEventInput(event)] });
      return;
    }

    const comum = {
      ...(preservedPath === undefined ? {} : { preservedWorktreePath: preservedPath }),
      ...(commits.length === 0 ? {} : { commits }),
    };

    if (event.type === "RunFailed") {
      await writeTerminal({
        status: "FAILED",
        error: {
          ...(event.error.code === undefined ? {} : { code: event.error.code }),
          message: event.error.message,
          retryable: event.retryable,
          ...comum,
        },
        events: [toRunEventInput(event)],
      });
      return;
    }

    if (event.type === "RunTimedOut") {
      await writeTerminal({
        status: "TIMED_OUT",
        error: {
          code: `TIMEOUT_${event.kind}`,
          message:
            event.kind === "IDLE"
              ? `O agente ficou ${String(event.limitMs)} ms sem emitir nada e o Run foi encerrado.`
              : `O Run passou do teto de ${String(event.limitMs)} ms e foi encerrado.`,
          retryable: true,
          processTreeTerminated: event.processTreeTerminated,
          elapsedMs: event.elapsedMs,
          ...comum,
        },
        events: [toRunEventInput(event)],
      });
      return;
    }

    // RunCancelled. O desfecho só é escrito aqui, depois de o runtime ter
    // matado a árvore e confirmado — ou não — o desaparecimento dela.
    const motivo = deps.cancelReasons?.get(run.id);
    const desligando = motivo === "worker_shutdown";

    await writeTerminal({
      status: "CANCELLED",
      error: {
        code: desligando ? "WORKER_SHUTDOWN" : "CANCELLED",
        message: desligando
          ? "O Worker foi desligado e cancelou este Run em voo."
          : "O Run foi cancelado a pedido.",
        reason: motivo ?? event.reason ?? "user_request",
        // Um Run cancelado pelo desligamento do Worker é trabalho interrompido,
        // não desistência: a Task volta a `READY` e a retentativa faz sentido.
        retryable: desligando,
        processTreeTerminated: event.processTreeTerminated,
        ...(event.terminationMethod === undefined
          ? {}
          : { terminationMethod: event.terminationMethod }),
        ...comum,
      },
      events: [toRunEventInput(event)],
    });
  }
}

/**
 * O prompt que chega ao agente.
 *
 * As instruções do Agent vão na frente do pedido da Task, e não em
 * `systemPromptAppend` sozinhas: nem toda CLI aceita acrescentar ao prompt de
 * sistema, e o papel do agente não pode depender de uma capability opcional.
 */
export function buildPrompt(instructions: string, prompt: string): string {
  const papel = instructions.trim();
  return papel.length === 0 ? prompt : `${papel}\n\n---\n\n${prompt}`;
}

/**
 * A mensagem de recuperação, com comandos copiáveis.
 *
 * No espírito do `RecoveryMessage` do Sandcastle: quando algo é preservado, o
 * diagnóstico precisa dizer onde está e o que fazer com aquilo. Um caminho sem
 * comando obriga quem lê a lembrar a sintaxe de `git worktree remove`, e é
 * nessa hora que alguém apaga o diretório errado.
 */
export function recoveryMessage(input: {
  worktree: WorktreeHandle;
  commits: readonly CommitRef[];
}): string {
  const { worktree, commits } = input;
  const linhas = [
    `Worktree preservado em: ${worktree.path}`,
    `Branch: ${worktree.branch} (a partir de ${worktree.baseCommit.slice(0, 12)})`,
    "",
    "Para inspecionar:",
    `  cd "${worktree.path}"`,
    "  git status",
    `  git log --oneline ${worktree.baseCommit.slice(0, 12)}..HEAD`,
    "",
    "Para trazer o trabalho para o repositório principal:",
    `  git -C "${worktree.repoPath}" merge ${worktree.branch}`,
    "",
    "Para descartar:",
    `  git -C "${worktree.repoPath}" worktree remove --force "${worktree.path}"`,
    `  git -C "${worktree.repoPath}" branch -D ${worktree.branch}`,
  ];

  if (commits.length > 0) {
    linhas.push("", `Commits neste worktree (${String(commits.length)}):`);
    for (const commit of commits) {
      linhas.push(`  ${commit.sha.slice(0, 12)} ${commit.subject}`);
    }
  }

  return linhas.join("\n");
}
