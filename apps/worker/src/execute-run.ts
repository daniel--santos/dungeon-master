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
  getRun,
  releaseWorkspaceLock,
  transitionRun,
  updateRunExecutionFields,
  type ClaimedRun,
  type Database,
} from "@dungeon-master/database";
import type { AgentRuntime, ExecutionRequest, WorkspaceManager } from "@dungeon-master/runtime";
import { PERMISSION_DENIED_DIAGNOSTIC_CODE } from "@dungeon-master/runtime";

import { executeWorkflowRun } from "./execute-workflow-run.js";
import type { Logger } from "./logger.js";
import { buildRunMcpServers } from "./mcp-servers.js";
import { prepareRun, type PreparedRun } from "./prepare-run.js";
import { resolveRunContext } from "./run-context.js";
import { toRunEventInput } from "./run-events.js";
import { createRunOutcomeWriter } from "./run-writers.js";
import {
  comumDoDesfecho,
  normalizeArtifactPath,
  recoveryMessage,
  settleWorkspace,
  toArtifactEvent,
} from "./workspace-outcome.js";

export { normalizeArtifactPath, recoveryMessage, toArtifactEvent };

/** Os quatro eventos que fecham o fluxo. Um deles sempre chega, e é o último. */
type TerminalExecutionEvent = Extract<
  ExecutionEvent,
  { type: "RunCompleted" | "RunFailed" | "RunTimedOut" | "RunCancelled" }
>;

/**
 * A execução de um Run, do claim ao desfecho gravado.
 *
 * Dois caminhos, escolhidos pelo que o Run é:
 *
 * - **Run simples** (`workflowVersionId` nulo): uma execução de agente, aqui
 *   mesmo. É onde a 2A e a 2B se encontram — o modelo (fila, trava, log
 *   append-only, escrita terminal transacional) de um lado, o runtime
 *   (worktree, timeouts, kill de árvore, resultado estruturado) do outro.
 * - **Run com Workflow**: a preparação é a mesma, e depois o motor de
 *   `@dungeon-master/workflow` conduz os passos (`execute-workflow-run.ts`).
 *
 * Duas regras valem nos dois: `RunStarted` é quem move `PREPARING → RUNNING`
 * — o estado do banco segue o processo, não a intenção — e o evento terminal
 * e o status terminal saem na mesma transação, porque um Run `SUCCEEDED` cujo
 * `RunCompleted` não foi gravado contaria a história pela metade.
 */

export interface ExecuteRunDeps {
  readonly db: Database;
  readonly userId: string;
  readonly runtime: AgentRuntime;
  readonly workspace: WorkspaceManager;
  readonly logger?: Logger;
  readonly timeouts: { readonly idleMs: number; readonly completionMs: number };
  /**
   * A URL do banco deste Worker, entregue ao servidor MCP do Grimório pelo
   * ambiente do harness. Ausente, o Grimório não é oferecido ao agente e o
   * diário diz isso.
   */
  readonly databaseUrl?: string;
  /**
   * Motivo do cancelamento, quando quem pediu foi o próprio Worker.
   *
   * O desligamento gracioso cancela os Runs em voo, e o desfecho precisa dizer
   * que foi o Worker saindo — `retryable`, portanto — e não o usuário
   * desistindo. O mapa é preenchido antes de `runtime.cancel`.
   */
  readonly cancelReasons?: Map<string, string>;
  /**
   * Cancelamento deste Run, disparado pelo Worker.
   *
   * O Run simples é cancelado por `runtime.cancel(runId)`; o Run com Workflow
   * precisa do sinal também, porque entre dois passos e durante um step de
   * comando não há execução de agente para o runtime cancelar.
   */
  readonly signal?: AbortSignal;
}

export async function executeRun(deps: ExecuteRunDeps, claimed: ClaimedRun): Promise<void> {
  if (claimed.run.workflowVersionId !== null) {
    await executeWorkflowRun(deps, claimed);
    return;
  }
  await executeSimpleRun(deps, claimed);
}

async function executeSimpleRun(deps: ExecuteRunDeps, claimed: ClaimedRun): Promise<void> {
  const { db, userId, logger } = deps;
  const { run } = claimed;
  const harness: HarnessKey = run.harnessKey;
  const iniciadoEm = Date.now();

  const writer = createRunOutcomeWriter({ db, userId, run, logger, startedAt: iniciadoEm });

  let preparation: PreparedRun | undefined;
  let lockAcquired = false;
  let usage: UsageSummary | undefined;
  /**
   * Caminhos que o harness já anunciou como `Artifact` no stream.
   *
   * Só o Codex os emite hoje. O que o diff do worktree encontrar e já estiver
   * aqui não vira evento de novo: dois espólios do mesmo arquivo na timeline
   * seriam ruído, e o do harness costuma trazer mais contexto que o nosso.
   */
  const artefatosDoHarness = new Set<string>();
  /**
   * Ferramentas que o harness recusou durante o Run.
   *
   * Uma negação sozinha não reprova nada: medido contra a CLI real, o agente
   * tenta `PowerShell`, é negado, refaz com `Bash` e termina a tarefa. O que
   * decide é o **conjunto**: negação mais trabalho inacabado é falta de
   * permissão, e a interface precisa dizer isso em vez de mostrar um Run
   * bem-sucedido com a Task bloqueada.
   */
  const ferramentasNegadas = new Set<string>();

  try {
    const prep = await prepareRun({ deps, claimed, writer, reuseExistingWorktree: false });
    lockAcquired = prep.lockAcquired;
    if (!prep.ok) return;
    preparation = prep.prepared;
    const { repoPath, checkoutPath, strategy, policies } = prep.prepared;

    // (e) Retomada de sessão, quando o Run nasceu de um "retomar a Expedição".
    let resume: ExecutionRequest["resume"];
    if (run.resumedFromRunId !== null) {
      const origem = await getRun(db, { userId, runId: run.resumedFromRunId });
      const sessaoOrigem = origem?.harnessSessionId ?? null;
      if (sessaoOrigem === null) {
        await writer.failPreparation({
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

    // (f) O contexto, montado uma vez e gravado antes da primeira chamada ao
    // agente (Fase 7). Vazio quando o Run segue sem ele.
    const contextText = await resolveRunContext({ db, userId, claimed, writer, logger });

    const model = run.loadoutSnapshot.model;

    // Os servidores MCP: o Grimório deste Project e os do Loadout. A lista vai
    // no pedido; quem decide se a CLI os sobe é a capability do adapter, e o
    // runtime avisa no diário quando não.
    const mcp = buildRunMcpServers({
      loadout: run.loadoutSnapshot,
      projectId: claimed.project.id,
      userId,
      databaseUrl: deps.databaseUrl,
    });
    for (const nota of mcp.notes) {
      await writer.diagnostic(nota.level === "DEBUG" ? "INFO" : nota.level, nota.message);
    }

    // O schema só é pedido a quem sabe produzi-lo: o `AgentRuntime` recusa o
    // pedido inteiro quando o adapter não declara `structuredOutput`, e recusar
    // um Run por causa de uma capability seria pior que aceitar o texto final e
    // sintetizar o desfecho a partir dele. A matriz lida é a do snapshot, que o
    // preflight de partida atualiza com a do adapter.
    const querSchema = run.loadoutSnapshot.harness.capabilities.structuredOutput;
    if (!querSchema) {
      await writer.diagnostic(
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
        permissionPolicy: policies.permission,
        environmentPolicy: policies.environment,
      },
      prompt: buildPrompt(run.loadoutSnapshot.agent.instructions, run.prompt, contextText),
      ...(querSchema
        ? {
            outputSchema: {
              schema: TaskExecutionResultSchema,
              instruction: TASK_EXECUTION_RESULT_INSTRUCTION,
            },
          }
        : {}),
      timeouts: { idleMs: deps.timeouts.idleMs, completionMs: deps.timeouts.completionMs },
      ...(mcp.servers.length === 0 ? {} : { mcpServers: mcp.servers }),
      ...(resume === undefined ? {} : { resume }),
    };

    // -------------------------------------------------------------- execução
    for await (const event of deps.runtime.execute(request)) {
      switch (event.type) {
        case "RunStarted": {
          writer.harnessVersion = event.harnessVersion;
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
            await writer.append(event);
          }
          break;
        }

        case "SessionCaptured": {
          writer.sessionId = event.harnessSessionId;
          await writer.append(event);
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
          await writer.append(event);
          break;

        case "Artifact":
          artefatosDoHarness.add(normalizeArtifactPath(event.path));
          await writer.append(event);
          break;

        case "Diagnostic":
          if (event.code === PERMISSION_DENIED_DIAGNOSTIC_CODE) {
            ferramentasNegadas.add(describeDeniedTool(event.message));
          }
          await writer.append(event);
          break;

        case "RunCompleted":
        case "RunFailed":
        case "RunTimedOut":
        case "RunCancelled":
          await finalize(event);
          break;

        default:
          await writer.append(event);
      }
    }

    if (!writer.terminalWritten) {
      // O `AgentRuntime` promete um evento terminal em qualquer caminho. Chegar
      // aqui é defeito, e o Run não pode ficar `RUNNING` por causa dele.
      await writer.failPreparation({
        code: "NO_TERMINAL_EVENT",
        message:
          "O runtime encerrou o fluxo de eventos sem um evento terminal. O desfecho real " +
          "deste Run é desconhecido.",
        retryable: true,
      });
    }
  } catch (error) {
    logger?.error({ err: error, runId: run.id }, "erro inesperado ao executar o Run");
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
        await writer.diagnostic(
          "WARN",
          "O agente terminou sem o bloco <result>; o resultado foi sintetizado a partir do " +
            "texto final e o veredito assumido como `completed`.",
          "Confira o resumo antes de tratar a Task como concluída.",
        );
      }

      // Negação de permissão mais trabalho inacabado é falta de permissão, e
      // não um Run bem-sucedido cuja Task ficou bloqueada. O primeiro Run desta
      // fase terminou assim: `SUCCEEDED` na tela, Task `BLOCKED`, e o motivo —
      // a CLI recusou `git add` — só aparecia se alguém lesse a prosa do
      // agente. `FAILED` com o que faltou na allow-list é acionável e
      // retentável; a correção é uma edição no perfil.
      if (estruturado.status !== "completed" && ferramentasNegadas.size > 0) {
        const negadas = [...ferramentasNegadas].sort().join(", ");
        await writer.writeTerminal({
          status: "FAILED",
          error: {
            code: "PERMISSION_DENIED",
            message:
              `O agente não concluiu a tarefa e teve permissão negada para: ${negadas}. ` +
              (estruturado.summary ?? "Sem resumo do agente."),
            retryable: true,
            deniedTools: [...ferramentasNegadas].sort(),
            agentStatus: estruturado.status,
            ...comumDoDesfecho(preservedPath, commits),
          },
          events: [toRunEventInput(event)],
        });
        return;
      }

      const result: RunResult = {
        ...estruturado,
        ...(usage === undefined ? {} : { usage }),
        ...(commits.length === 0 ? {} : { commits }),
        ...(preservedPath === undefined ? {} : { preservedWorktreePath: preservedPath }),
      };

      await writer.writeTerminal({ status: "SUCCEEDED", result, events: [toRunEventInput(event)] });
      return;
    }

    const comum = comumDoDesfecho(preservedPath, commits);

    if (event.type === "RunFailed") {
      await writer.writeTerminal({
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
      await writer.writeTerminal({
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

    await writer.writeTerminal({
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
 * O nome da ferramenta dentro da mensagem de negação.
 *
 * A mensagem é montada pelo adapter e começa com "Permissão negada para X:".
 * Ler o nome dali é feio, e a alternativa — mais um campo no evento só para
 * isto — seria pior: o `code` já diz o que aconteceu, e o nome é detalhe de
 * apresentação. Quando o formato não casa, o texto inteiro vale como nome.
 */
export function describeDeniedTool(message: string): string {
  return /^Permissão negada para (.+?):/u.exec(message)?.[1] ?? message;
}

/**
 * O prompt que chega ao agente: instruções do Agent, bloco de contexto, pedido.
 *
 * As instruções do Agent vão na frente do pedido da Task, e não em
 * `systemPromptAppend` sozinhas: nem toda CLI aceita acrescentar ao prompt de
 * sistema, e o papel do agente não pode depender de uma capability opcional.
 *
 * O bloco de contexto (Fase 7) entra entre os dois, e é o mesmo texto em todo
 * passo do Run: instruções mais contexto formam o prefixo estável que o cache
 * de prompt do provedor reaproveita; o que muda por passo vem depois. Num
 * Run com Workflow o pedido começa em "# Tarefa", e o bloco fica antes dele.
 */
export function buildPrompt(instructions: string, prompt: string, context = ""): string {
  const prefixo = [instructions.trim(), context.trim()].filter((parte) => parte.length > 0);
  return prefixo.length === 0 ? prompt : `${prefixo.join("\n\n---\n\n")}\n\n---\n\n${prompt}`;
}
