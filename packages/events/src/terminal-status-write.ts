// Adapted from Archon — packages/workflows/src/terminal-status-write.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: `workflowRunId` virou `runId`, porque aqui o terminal é de Run e não
// de workflow run; o logger do Archon (`@archon/paths`) virou o contrato
// opcional `EventsLogger` deste pacote, para ele continuar sem infraestrutura;
// `cause` passou a usar a propriedade nativa de `Error`, que existe no Node 24;
// entrou `isTerminalStatusWriteError`, para o worker distinguir o erro sem
// depender de `instanceof` atravessando fronteiras de módulo. Mensagens em
// português.

import type { EventsLogger } from "./logger.js";

/**
 * O status terminal de um Run não pôde ser gravado.
 *
 * É um tipo próprio porque a fronteira de recuperação precisa distinguir este
 * caso de um Run que apenas falhou: o processo terminou, mas a linha ainda diz
 * `RUNNING`. Nenhum resultado comum pode ser reportado por esse mesmo canal, e
 * nenhuma escrita compensatória deve ser tentada por ele — quem tenta escrever
 * "falhou ao gravar que falhou" pelo caminho que acabou de falhar escreve nada
 * e perde o rastro.
 */
export class TerminalStatusWriteError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      `Falha ao persistir o status terminal do Run: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "TerminalStatusWriteError";
    this.cause = cause;
  }
}

/**
 * Reconhece o erro sem `instanceof`.
 *
 * Duas cópias do pacote no `node_modules` dariam duas classes diferentes, e o
 * `instanceof` falharia exatamente no caminho que não pode falhar.
 */
export function isTerminalStatusWriteError(error: unknown): error is TerminalStatusWriteError {
  return error instanceof Error && error.name === "TerminalStatusWriteError";
}

/** Identifica qual escrita terminal falhou, para o log de diagnóstico. */
export interface TerminalStatusWriteContext {
  runId: string;
  /** Marcador procurável do ponto de chamada, por exemplo `worker.run_failed`. */
  site: string;
  logger?: EventsLogger;
}

/**
 * Espera a escrita do status terminal e converte a rejeição no marcador tipado.
 *
 * O erro original do banco é logado aqui, para nenhum ponto de chamada precisar
 * lembrar de fazê-lo. `site` carrega o que os `.catch()` espalhados que este
 * embrulho substituiu carregavam: qual das escritas terminais foi a que falhou.
 */
export async function requireTerminalStatusWrite<T>(
  write: Promise<T>,
  context: TerminalStatusWriteContext,
): Promise<T> {
  try {
    return await write;
  } catch (error) {
    context.logger?.error?.(
      { err: error, runId: context.runId, site: context.site },
      "run_terminal_status_write_failed",
    );
    throw new TerminalStatusWriteError(error);
  }
}
