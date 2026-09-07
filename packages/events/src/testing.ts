import type { SequencedEvent, SseWriter } from "./sse-transport.js";

/**
 * Evento mínimo e writer em memória, usados pelos testes deste pacote.
 *
 * Fica em `src/` e não em `*.test.ts` porque três arquivos de teste precisam
 * dele. Não é exportado no barril: é ferramenta de teste, não API do pacote.
 */
export interface FakeEvent extends SequencedEvent {
  readonly sequence: number;
  readonly type: string;
}

export function evento(sequence: number, type = "system.ping"): FakeEvent {
  return { sequence, type };
}

export interface WrittenFrame {
  readonly id: string;
  readonly data: string;
}

export class FakeWriter implements SseWriter {
  readonly frames: WrittenFrame[] = [];
  readonly comments: string[] = [];
  closed = false;
  /** Quando definido, a próxima escrita lança este erro. */
  failNextWrite: Error | null = null;

  async writeEvent(event: { id: string; data: string }): Promise<void> {
    if (this.failNextWrite !== null) {
      const error = this.failNextWrite;
      this.failNextWrite = null;
      throw error;
    }
    if (this.closed) throw new Error("writer fechado");
    this.frames.push({ id: event.id, data: event.data });
  }

  async writeComment(text: string): Promise<void> {
    if (this.closed) throw new Error("writer fechado");
    this.comments.push(text);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** As `sequence` entregues, na ordem em que o cliente as viu. */
  get sequences(): number[] {
    return this.frames.map((frame) => Number(frame.id));
  }
}
