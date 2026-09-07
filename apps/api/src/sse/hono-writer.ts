import type { SseWriter } from "@dungeon-master/events";
import type { SSEStreamingApi } from "hono/streaming";

/**
 * Liga o `streamSSE` do Hono ao `SseWriter` de `@dungeon-master/events`.
 *
 * É a única peça que conhece os dois lados: o pacote de eventos não importa
 * Hono, e o Hono não sabe nada de cursor. Toda a lógica de replay e dedup mora
 * no transporte; aqui só se traduz "escrever" e "fechar".
 */
export class HonoSseWriter implements SseWriter {
  private readonly closedGate: Promise<void>;
  private readonly markClosed: () => void;

  constructor(private readonly stream: SSEStreamingApi) {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.closedGate = promise;
    this.markClosed = resolve;

    // O cliente fechou a aba, ou a conexão caiu. O handler está esperando neste
    // portão para poder devolver e liberar a requisição.
    stream.onAbort(() => {
      this.markClosed();
    });
  }

  /** Resolve quando a conexão termina, por abort do cliente ou por `close()`. */
  get whenClosed(): Promise<void> {
    return this.closedGate;
  }

  get closed(): boolean {
    return this.stream.closed || this.stream.aborted;
  }

  async writeEvent(event: { id: string; data: string; event?: string }): Promise<void> {
    await this.stream.writeSSE({
      id: event.id,
      data: event.data,
      ...(event.event === undefined ? {} : { event: event.event }),
    });
  }

  /**
   * Comentário SSE.
   *
   * Vai por `write` e não por `writeSSE` porque um comentário não é um evento:
   * o `EventSource` do browser não dispara `message` para ele. Serve para
   * manter a conexão viva atravessando proxies e para o servidor perceber cedo
   * que o socket morreu.
   */
  async writeComment(text: string): Promise<void> {
    await this.stream.write(`: ${text}\n\n`);
  }

  async close(): Promise<void> {
    this.markClosed();
    if (!this.stream.closed && !this.stream.aborted) {
      await this.stream.close();
    }
  }
}
