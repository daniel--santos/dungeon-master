import type {
  ExecutionEvent,
  HarnessKey,
  RunResult,
  UsageSummary,
} from "@dungeon-master/contracts";
import {
  getRun,
  getWorkflowVersionDetail,
  releaseWorkspaceLock,
  transitionRun,
  type ClaimedRun,
} from "@dungeon-master/database";
import { AGENT_GIT_ENV_KEYS, buildExecutionEnv } from "@dungeon-master/runtime";
import {
  createFileSystemArtifactProbe,
  createGitCheckoutSnapshotter,
  createProcessCommandExecutor,
  createRefusingCommandExecutor,
  runWorkflow,
  type CommandExecutor,
  type WorkflowOutcome,
} from "@dungeon-master/workflow";

import type { ExecuteRunDeps } from "./execute-run.js";
import { buildRunMcpServers } from "./mcp-servers.js";
import { prepareRun, type PreparedRun } from "./prepare-run.js";
import { resolveRunContext } from "./run-context.js";
import { toRunEventInput, workerDiagnostic } from "./run-events.js";
import { createRunOutcomeWriter } from "./run-writers.js";
import { createDatabaseWorkflowStore, createStepAgentRuntime } from "./workflow-ports.js";
import { comumDoDesfecho, settleWorkspace } from "./workspace-outcome.js";

/**
 * A execução de um Run com Workflow: a mesma preparação do Run simples, e
 * depois o motor de `@dungeon-master/workflow` no comando.
 *
 * O que este arquivo decide, e o motor não:
 *
 * - **`PREPARING → RUNNING` antes do primeiro passo.** Não há `RunStarted` de
 *   harness aqui — cada step de agente sobe o seu processo —, então a
 *   transição sai com um `Diagnostic` dizendo qual versão do Workflow vai
 *   rodar e de onde ela retoma. O gate exige o Run em `RUNNING` para abrir.
 * - **Pausar é soltar.** Um `paused` devolve o Run ao Worker com o gate
 *   aberto; a trava de workspace sai no `finally`, a capacidade sai quando
 *   esta função retorna, e o worktree fica de pé para a retomada. O Worker
 *   que reclamar o Run depois — este ou outro — reabre o mesmo diretório.
 * - **O desfecho do Run tem o formato de sempre.** `RunCompleted`,
 *   `RunFailed` ou `RunCancelled` sintéticos fecham o log, e o status terminal
 *   sai na mesma transação, com a Task acoplada pelas regras de sempre.
 */
export async function executeWorkflowRun(deps: ExecuteRunDeps, claimed: ClaimedRun): Promise<void> {
  const { db, userId, logger } = deps;
  const { run } = claimed;
  const harness: HarnessKey = run.harnessKey;
  const iniciadoEm = Date.now();
  const workflowVersionId = run.workflowVersionId;

  const writer = createRunOutcomeWriter({ db, userId, run, logger, startedAt: iniciadoEm });

  let preparation: PreparedRun | undefined;
  let lockAcquired = false;
  const artefatosDoHarness = new Set<string>();

  try {
    if (workflowVersionId === null) {
      throw new Error(`O Run ${run.id} não tem workflowVersionId; use o caminho simples.`);
    }

    const prep = await prepareRun({ deps, claimed, writer, reuseExistingWorktree: true });
    lockAcquired = prep.lockAcquired;
    if (!prep.ok) return;
    preparation = prep.prepared;
    const { repoPath, checkoutPath, strategy, policies } = prep.prepared;

    // A definição vem da versão congelada, nunca do Workflow vigente: editar
    // o Workflow depois não alcança este Run (documento técnico, 19.1).
    const version = await getWorkflowVersionDetail(db, { userId, workflowVersionId });
    if (version === null) {
      await writer.failPreparation({
        code: "WORKFLOW_VERSION_NOT_FOUND",
        message: `A versão ${workflowVersionId} do Workflow deste Run não existe mais.`,
        retryable: false,
      });
      return;
    }

    const retomada = prep.prepared.reopened ? " Worktree reaberto: retomada de onde parou." : "";
    const inicio = workerDiagnostic({
      harness,
      level: "INFO",
      message:
        `Workflow "${version.definition.name}" v${String(version.version)} com ` +
        `${String(version.steps.length)} passo(s) em ${checkoutPath}.${retomada}`,
    });
    const movido = await transitionRun(db, {
      userId,
      runId: run.id,
      to: "RUNNING",
      patch: { workspacePath: checkoutPath },
      events: [toRunEventInput(inicio)],
    });
    if (movido === null || !movido.ok) {
      await writer.failPreparation({
        code: "RUN_TRANSITION_REJECTED",
        message: "O Run não pôde entrar em RUNNING para executar o Workflow.",
        retryable: true,
        detail: JSON.stringify(movido === null ? "RUN_NOT_FOUND" : movido.failure),
      });
      return;
    }

    // O contexto, montado uma vez e gravado antes do primeiro passo de agente
    // (Fase 7). Numa retomada, o registro é relido: todo passo recebe o mesmo
    // texto, antes e depois do gate. Vazio quando o Run segue sem ele.
    const contextText = await resolveRunContext({ db, userId, claimed, writer, logger });

    // ------------------------------------------------------------- portas
    const store = createDatabaseWorkflowStore({
      db,
      userId,
      run,
      logger,
      onHarnessSession: (id) => {
        writer.sessionId = id;
      },
    });

    // Os servidores MCP são os mesmos em todo passo de agente: montados uma
    // vez, com os avisos no diário antes do primeiro passo.
    const mcp = buildRunMcpServers({
      loadout: run.loadoutSnapshot,
      projectId: claimed.project.id,
      userId,
      databaseUrl: deps.databaseUrl,
    });
    for (const nota of mcp.notes) {
      await writer.diagnostic(nota.level === "DEBUG" ? "INFO" : nota.level, nota.message);
    }

    const agent = createStepAgentRuntime({
      runtime: deps.runtime,
      run,
      repoPath,
      checkoutPath,
      policies,
      defaultTimeouts: deps.timeouts,
      onHarnessVersion: (version) => {
        writer.harnessVersion = version;
      },
      knownArtifacts: artefatosDoHarness,
      mcpServers: mcp.servers,
      contextText,
    });

    const commands = commandExecutorFor(run.executionMode, policies);

    const outcome = await runWorkflow({
      run: {
        runId: run.id,
        harnessKey: harness,
        prompt: run.prompt,
        checkoutPath,
        workspaceStrategy: strategy,
        executionMode: run.executionMode,
      },
      definition: {
        name: version.definition.name,
        steps: version.steps.map((step) => step.definition),
      },
      store,
      agent,
      commands,
      snapshots: createGitCheckoutSnapshotter({ checkoutPath, runId: run.id }),
      artifactExists: createFileSystemArtifactProbe(checkoutPath),
      defaultStepTimeoutMs: deps.timeouts.completionMs,
      ...(logger === undefined ? {} : { logger }),
      ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    });

    await finalize(outcome);
  } catch (error) {
    logger?.error({ err: error, runId: run.id }, "erro inesperado ao executar o Workflow");
    if (!writer.terminalWritten) {
      await writer.failPreparation({
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
    // A trava sai sempre — inclusive na pausa: um Run parado num gate não
    // segura o repositório, e é outro claim que a pega de novo.
    if (lockAcquired) {
      await releaseWorkspaceLock(db, { userId, runId: run.id }).catch((error: unknown) => {
        logger?.error({ err: error, runId: run.id }, "falha ao liberar a trava de workspace");
      });
    }
  }

  // ------------------------------------------------------------------ fim
  async function finalize(outcome: WorkflowOutcome): Promise<void> {
    if (outcome.kind === "paused") {
      // A criação do gate já levou o Run a WAITING_APPROVAL. Um gate
      // reencontrado (Run retomado com o gate ainda pendente) não leva, e o Run
      // precisa ir para lá agora: em RUNNING ninguém poderia resolvê-lo.
      const atual = await getRun(db, { userId, runId: run.id });
      if (atual?.status === "RUNNING") {
        const pausado = await transitionRun(db, { userId, runId: run.id, to: "WAITING_APPROVAL" });
        if (pausado === null || !pausado.ok) {
          logger?.error(
            { runId: run.id, failure: pausado === null ? "RUN_NOT_FOUND" : pausado.failure },
            "não consegui levar o Run a WAITING_APPROVAL pelo gate reencontrado",
          );
        }
      }
      logger?.info(
        { runId: run.id, stepKey: outcome.stepKey, gateId: outcome.gate.id },
        "run pausado em gate de aprovação; trava e capacidade liberadas",
      );
      return;
    }

    const sucesso = outcome.kind === "settled" && outcome.status === "SUCCEEDED";
    const { commits, preservedPath } = await settleWorkspace({
      workspace: deps.workspace,
      writer,
      logger,
      runId: run.id,
      harness,
      worktree: preparation?.worktree,
      success: sucesso,
      knownArtifacts: artefatosDoHarness,
    });
    const comum = comumDoDesfecho(preservedPath, commits);
    const durationMs = Math.max(0, Date.now() - iniciadoEm);

    if (outcome.kind === "cancelled") {
      const motivo = deps.cancelReasons?.get(run.id);
      const desligando = motivo === "worker_shutdown";
      const evento: ExecutionEvent = {
        type: "RunCancelled",
        timestamp: new Date().toISOString(),
        harness,
        reason: motivo ?? outcome.reason ?? "user_request",
        processTreeTerminated: outcome.processTreeTerminated,
        ...(outcome.terminationMethod === undefined
          ? {}
          : { terminationMethod: outcome.terminationMethod }),
        elapsedMs: durationMs,
      };
      await writer.writeTerminal({
        status: "CANCELLED",
        error: {
          code: desligando ? "WORKER_SHUTDOWN" : "CANCELLED",
          message: desligando
            ? "O Worker foi desligado e cancelou este Run em voo."
            : "O Run foi cancelado a pedido.",
          reason: motivo ?? outcome.reason ?? "user_request",
          retryable: desligando,
          processTreeTerminated: outcome.processTreeTerminated,
          ...(outcome.terminationMethod === undefined
            ? {}
            : { terminationMethod: outcome.terminationMethod }),
          ...comum,
        },
        events: [toRunEventInput(evento)],
      });
      return;
    }

    if (outcome.harnessSessionId !== undefined) writer.sessionId = outcome.harnessSessionId;

    const result: RunResult = {
      ...outcome.result,
      ...(commits.length === 0 ? {} : { commits }),
      ...(preservedPath === undefined ? {} : { preservedWorktreePath: preservedPath }),
    };

    if (outcome.status === "SUCCEEDED") {
      const evento: ExecutionEvent = {
        type: "RunCompleted",
        timestamp: new Date().toISOString(),
        harness,
        summary: result.summary ?? "",
        output: result,
        // O agregado soma `UsageSummary` completos; o contrato de `RunResult` é
        // mais frouxo (campos opcionais) e por isso o estreitamento.
        ...(outcome.result.usage === undefined
          ? {}
          : { usage: outcome.result.usage as UsageSummary }),
        ...(writer.sessionId === null ? {} : { harnessSessionId: writer.sessionId }),
        durationMs,
      };
      await writer.writeTerminal({
        status: "SUCCEEDED",
        result,
        events: [toRunEventInput(evento)],
      });
      return;
    }

    const erro = outcome.error ?? { code: "WORKFLOW_FAILED", message: "O Workflow falhou." };
    const evento: ExecutionEvent = {
      type: "RunFailed",
      timestamp: new Date().toISOString(),
      harness,
      error: {
        message: erro.message,
        ...(erro.code === undefined ? {} : { code: erro.code }),
      },
      retryable: erro["retryable"] === true,
      ...(writer.sessionId === null ? {} : { harnessSessionId: writer.sessionId }),
      durationMs,
    };
    await writer.writeTerminal({
      status: "FAILED",
      result,
      error: { ...erro, message: erro.message, ...comum },
      events: [toRunEventInput(evento)],
    });
  }
}

/**
 * O executor de processo dos steps `command`/`validation`, pelo modo do Run.
 *
 * No `HOST`, um processo filho com o ambiente da `environmentPolicy` do perfil
 * mais as chaves que o `git` do agente precisa — a mesma allow-list do runtime.
 * No `DOCKER`, **fail-closed**: rodar no host um comando que o perfil mandou
 * isolar seria executar fora do lugar que o usuário escolheu. O step falha com
 * erro claro, e a execução em container efêmero com os mounts do agente fica
 * registrada como pendência desta fase.
 */
function commandExecutorFor(
  mode: ClaimedRun["run"]["executionMode"],
  policies: PreparedRun["policies"],
): CommandExecutor {
  if (mode === "DOCKER") {
    return createRefusingCommandExecutor({
      code: "COMMAND_STEP_DOCKER_UNSUPPORTED",
      message:
        "Steps de comando e validação ainda não rodam em modo DOCKER: o comando não foi " +
        "executado no host de propósito. Use um perfil HOST para este Workflow, ou remova " +
        "os steps de comando.",
    });
  }
  return createProcessCommandExecutor({
    env: buildExecutionEnv({ policy: policies.environment, adapterKeys: AGENT_GIT_ENV_KEYS }),
  });
}
