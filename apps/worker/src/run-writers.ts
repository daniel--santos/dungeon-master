import type { HarnessKey, Run, RunEventPayload, RunResult } from "@dungeon-master/contracts";
import {
  appendRunEvent,
  writeRunTerminalStatus,
  type Database,
  type RunEventInput,
} from "@dungeon-master/database";
import { isTerminalStatusWriteError } from "@dungeon-master/events";

import type { Logger } from "./logger.js";
import { toRunEventInput, workerDiagnostic, workerRunFailed } from "./run-events.js";

/**
 * As escritas de um Run que os dois caminhos de execução — o Run simples e o
 * Run com Workflow — fazem do mesmo jeito.
 *
 * `append` é o contrato que **nunca lança** (observabilidade); `writeTerminal`
 * é o que **propaga** por dentro e converte a falha em log por fora, porque
 * nenhum resultado comum pode ser reportado pelo canal que acabou de falhar
 * (CLAUDE.md, seção 9). `sessionId` e `harnessVersion` são mutáveis de
 * propósito: chegam no meio da execução e precisam estar na escrita terminal.
 */
export interface RunOutcomeWriter {
  append(event: RunEventPayload): Promise<void>;
  diagnostic(level: "INFO" | "WARN" | "ERROR", message: string, detail?: string): Promise<void>;
  /**
   * Fecha o Run sem que nenhum processo tenha subido: `PREPARING → FAILED`.
   *
   * Preflight, worktree e trava são trabalho que pode dar errado antes do
   * agente, e uma falha ali não é um Run que rodou mal — é um Run que não
   * chegou a rodar.
   */
  failPreparation(input: {
    code: string;
    message: string;
    retryable: boolean;
    detail?: string;
    extra?: Record<string, unknown>;
  }): Promise<void>;
  writeTerminal(input: {
    status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
    result?: RunResult;
    error?: Record<string, unknown> & { message: string };
    events: readonly RunEventInput[];
  }): Promise<void>;
  readonly terminalWritten: boolean;
  sessionId: string | null;
  harnessVersion: string | null;
}

export function createRunOutcomeWriter(input: {
  readonly db: Database;
  readonly userId: string;
  readonly run: Run;
  readonly logger: Logger | undefined;
  readonly startedAt: number;
}): RunOutcomeWriter {
  const { db, userId, run, logger } = input;
  const harness: HarnessKey = run.harnessKey;
  let terminalWritten = false;

  const writer: RunOutcomeWriter = {
    sessionId: run.harnessSessionId,
    harnessVersion: run.harnessVersion,

    get terminalWritten() {
      return terminalWritten;
    },

    append: async (event) => {
      await appendRunEvent(db, {
        userId,
        runId: run.id,
        event: toRunEventInput(event),
        ...(logger === undefined ? {} : { logger }),
      });
    },

    diagnostic: async (level, message, detail) => {
      await writer.append(
        workerDiagnostic({
          harness,
          level,
          message,
          ...(detail === undefined ? {} : { detail }),
        }),
      );
    },

    failPreparation: async (falha) => {
      await writer.diagnostic("ERROR", falha.message, falha.detail);
      const evento = workerRunFailed({
        harness,
        code: falha.code,
        message: falha.message,
        retryable: falha.retryable,
        durationMs: Date.now() - input.startedAt,
      });
      await writer.writeTerminal({
        status: "FAILED",
        error: {
          code: falha.code,
          message: falha.message,
          retryable: falha.retryable,
          ...(falha.extra ?? {}),
        },
        events: [toRunEventInput(evento)],
      });
    },

    writeTerminal: async (terminal) => {
      try {
        await writeRunTerminalStatus(db, {
          userId,
          runId: run.id,
          status: terminal.status,
          ...(terminal.result === undefined ? {} : { result: terminal.result }),
          ...(terminal.error === undefined ? {} : { error: terminal.error }),
          ...(writer.harnessVersion === null ? {} : { harnessVersion: writer.harnessVersion }),
          ...(writer.sessionId === null ? {} : { harnessSessionId: writer.sessionId }),
          events: terminal.events,
          ...(logger === undefined ? {} : { logger }),
        });
        terminalWritten = true;
      } catch (error) {
        // Nenhum resultado comum pode ser reportado pelo canal que acabou de
        // falhar (CLAUDE.md, seção 9). O log é o que sobra, e a reconciliação
        // da próxima partida fecha o Run.
        const nivel = isTerminalStatusWriteError(error) ? "fatal" : "error";
        logger?.[nivel](
          { err: error, runId: run.id, status: terminal.status },
          "falha ao gravar o status terminal do Run; sem escrita compensatória",
        );
      }
    },
  };

  return writer;
}
