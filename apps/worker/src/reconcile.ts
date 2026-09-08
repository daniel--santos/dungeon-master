import {
  listOrphanRunRows,
  settleOrphanRunSteps,
  writeRunTerminalStatus,
  type Database,
} from "@dungeon-master/database";
import { isTerminalStatusWriteError } from "@dungeon-master/events";

import type { Logger } from "./logger.js";
import { toRunEventInput, workerDiagnostic, workerRunFailed } from "./run-events.js";

/**
 * Reconciliação de partida: fechar o que o Worker anterior deixou aberto.
 *
 * `PREPARING` e `RUNNING` são estados que só existem enquanto um processo os
 * sustenta. Se o Worker morreu — `kill -9`, queda de energia, `Ctrl+C` que não
 * chegou a completar —, os processos de agente morreram junto e ninguém vai
 * escrever o desfecho daqueles Runs. Sem esta passagem, eles ficariam
 * `RUNNING` para sempre, a Task presa em `RUNNING` junto, e a trava de
 * workspace segurando o repositório por um processo que não existe.
 *
 * O desfecho é `FAILED` com `retryable = true`, e não `CANCELLED`: ninguém
 * pediu para cancelar, e a diferença importa porque `CANCELLED` devolve a Task
 * a `READY` como se fosse decisão do usuário, enquanto `FAILED` a deixa
 * retentável dizendo que algo deu errado. O `Diagnostic` conta o que foi.
 *
 * **Não é resume automático.** Um Run interrompido no meio pode ter deixado o
 * worktree sujo e o repositório em estado desconhecido; decidir tentar de novo
 * é do usuário, e é um Run novo com `attempt` maior (documento técnico, 5.1).
 * O worktree é preservado — nada aqui apaga diretório.
 */

export interface ReconcileOrphanRunsInput {
  readonly db: Database;
  readonly userId: string;
  readonly workerId: string;
  readonly logger?: Logger;
}

export interface ReconciledRun {
  readonly runId: string;
  readonly previousStatus: string;
  readonly claimedBy: string | null;
  readonly workspacePath: string | null;
}

export async function reconcileOrphanRuns(
  input: ReconcileOrphanRunsInput,
): Promise<readonly ReconciledRun[]> {
  const { db, userId, workerId, logger } = input;

  const orphans = await listOrphanRunRows(db, { userId, workerId });
  if (orphans.length === 0) return [];

  logger?.warn(
    { count: orphans.length, workerId },
    "runs em execução sem worker vivo; reconciliando",
  );

  const reconciled: ReconciledRun[] = [];

  for (const run of orphans) {
    const preservado =
      run.workspacePath === null
        ? ""
        : ` O workspace foi preservado em ${run.workspacePath}: nada foi apagado.`;

    const diagnostico = workerDiagnostic({
      harness: run.harnessKey,
      level: "ERROR",
      message:
        `O Worker que executava este Run terminou sem escrever o desfecho: o Run estava em ` +
        `${run.status} e nenhum processo o sustenta.${preservado}`,
      detail:
        `Reclamado por: ${run.claimedBy ?? "(nenhum worker)"}. ` +
        `Reconciliado por: ${workerId}. ` +
        "Uma retentativa é um Run novo, criado pela interface; nada aqui retoma sozinho.",
    });

    const falha = workerRunFailed({
      harness: run.harnessKey,
      code: "WORKER_LOST",
      message: "O Worker terminou antes de escrever o desfecho deste Run.",
      retryable: true,
    });

    try {
      if (run.workflowVersionId !== null) {
        // Os RunSteps abertos assentam antes do Run: o passo que estava
        // rodando vira FAILED com WORKER_LOST e os que nunca rodaram, CANCELLED.
        // Sem isso a tela por passos mostraria um passo "em execução" dentro
        // de um Run já fechado.
        const steps = await settleOrphanRunSteps(db, { userId, runId: run.id, workerId });
        logger?.warn(
          { runId: run.id, failed: steps.failed, cancelled: steps.cancelled },
          "run steps do run órfão assentados",
        );
      }

      const escrito = await writeRunTerminalStatus(db, {
        userId,
        runId: run.id,
        status: "FAILED",
        error: {
          code: "WORKER_LOST",
          message: "O Worker terminou antes de escrever o desfecho deste Run.",
          // `retryable` fica no corpo do erro, e não numa coluna: `RunError` é
          // aberto, e é ele que a interface lê para decidir se oferece "tentar
          // de novo".
          retryable: true,
          reconciledBy: workerId,
          ...(run.claimedBy === null ? {} : { lostWorkerId: run.claimedBy }),
          ...(run.workspacePath === null ? {} : { preservedWorktreePath: run.workspacePath }),
        },
        events: [toRunEventInput(diagnostico), toRunEventInput(falha)],
        ...(logger === undefined ? {} : { logger }),
      });

      if (escrito === null || !escrito.ok) {
        // A máquina de estados recusou o fechamento — uma Task cuja vizinhança
        // mudou, por exemplo. Nada foi escrito, e insistir aqui seria forçar um
        // estado que o domínio não aceita; o log é o que sobra.
        logger?.error(
          {
            runId: run.id,
            failure: escrito === null ? "RUN_NOT_FOUND" : escrito.failure,
          },
          "o domínio recusou fechar o run órfão; ele continua aberto",
        );
        continue;
      }

      reconciled.push({
        runId: run.id,
        previousStatus: run.status,
        claimedBy: run.claimedBy,
        workspacePath: run.workspacePath,
      });
    } catch (error) {
      // Nenhuma escrita compensatória pelo mesmo canal que acabou de falhar
      // (CLAUDE.md, seção 9). O Run continua órfão e a próxima partida tenta de
      // novo — que é exatamente o que esta função é.
      const nivel = isTerminalStatusWriteError(error) ? "fatal" : "error";
      logger?.[nivel](
        { err: error, runId: run.id },
        "falha ao reconciliar run órfão; ficará para a próxima partida",
      );
    }
  }

  return reconciled;
}
