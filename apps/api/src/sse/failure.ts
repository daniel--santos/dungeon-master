import type { Logger } from "../logger.js";

/**
 * O que este módulo precisa do stream do Hono.
 *
 * Estrutural, e não `SSEStreamingApi`, pelo mesmo motivo do `SseWriter` de
 * `@dungeon-master/events`: escrever um quadro é a única capacidade usada, e um
 * duplo de teste que implemente isto já basta.
 */
export interface SseErrorStream {
  writeSSE(message: { data: string; event?: string; id?: string }): Promise<void>;
}

/** O corpo do quadro `event: error`. Nunca carrega mensagem interna. */
export interface SseFailureFrame {
  readonly error: "stream_failed";
  readonly detail: string;
  readonly requestId?: string;
}

export const SSE_FAILURE_DETAIL =
  "O stream falhou no servidor e foi encerrado. " +
  "O `requestId` liga esta resposta ao log; reconectar com o mesmo cursor é seguro.";

/**
 * Fecha um stream SSE que quebrou no meio, pelo canal certo.
 *
 * post-mortem #9 (08/09/2026): as duas rotas SSE chamavam `streamSSE` sem o
 * terceiro argumento. Uma falha de banco durante o replay caía no `else` do
 * `run()` do Hono — `console.error(e)` e `stream.close()` —, então o cliente
 * ficava com um `200` e um stream sem um único quadro, o `EventSource` da web
 * religava a cada 15 s para sempre com o mesmo cursor, e nada chegava ao pino
 * com o `requestId`. Pior: o que ia para o `stderr` era a mensagem do Drizzle,
 * com o SQL e os parâmetros.
 *
 * O tratamento fica **dentro** do callback, e não no `onError` do Hono, porque
 * o `onError` do Hono escreve `data: e.message` no quadro de erro: seria a
 * mesma mensagem interna, agora entregue ao cliente. A regra da seção 9 do
 * `CLAUDE.md` vale aqui igual: o detalhe vai para o log, o `requestId` vai para
 * a resposta.
 */
export async function reportStreamFailure(input: {
  stream: SseErrorStream;
  error: unknown;
  message: string;
  logger?: Logger;
  requestId?: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  input.logger?.error(
    { ...input.context, requestId: input.requestId, err: input.error },
    input.message,
  );

  const frame: SseFailureFrame = {
    error: "stream_failed",
    detail: SSE_FAILURE_DETAIL,
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
  };

  try {
    await input.stream.writeSSE({ event: "error", data: JSON.stringify(frame) });
  } catch {
    // O socket já morreu: não há a quem contar, e o log acima é o registro.
    // Deixar esta escrita estourar trocaria um stream quebrado por uma exceção
    // não tratada no `finally` de quem chama.
  }
}
