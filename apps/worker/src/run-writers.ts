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
        // post-mortem #3 (08/09/2026): o retorno de `writeRunTerminalStatus`
        // era descartado e `terminalWritten` virava `true` mesmo quando a
        // máquina de estados **recusava** a escrita. A recusa vem como valor
        // (`null` ou `ok: false`), e não como exceção, então o `catch` abaixo
        // nunca a via: o Run ficava preso em `PREPARING`/`RUNNING`, o `result`
        // com as `ProposedTask` e os `KnowledgeCandidate` se perdia sem uma
        // linha de log, e as duas guardas de "sem evento terminal"
        // (`execute-run.ts` e `execute-workflow-run.ts`) ficavam desarmadas.
        // Agora só a escrita aceita conta como escrita.
        const escrito = await writeRunTerminalStatus(db, {
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

        if (escrito === null || !escrito.ok) {
          // Nada foi gravado — nem o status, nem os eventos, nem o `result`.
          // Insistir seria forçar um estado que o domínio não aceita; o log é
          // o que sobra, e a guarda de "sem evento terminal" continua armada.
          logger?.error(
            {
              runId: run.id,
              status: terminal.status,
              failure: escrito === null ? "RUN_NOT_FOUND" : escrito.failure,
            },
            "o domínio recusou o status terminal do Run; nada foi gravado",
          );
          return;
        }

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
