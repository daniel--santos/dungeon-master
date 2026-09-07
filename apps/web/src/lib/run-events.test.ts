import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectRunEvents,
  type EventSourceLike,
  type RunEvent,
  type RunEventsTransport,
} from "@/lib/run-events";

/**
 * O contrato do Diário: replay pelo cursor, vivo pelo stream, e reconexão que
 * não duplica nem perde.
 *
 * O transporte é falso de propósito. O que está sob prova é a regra do cursor
 * — a mesma que a seção 10.1 do documento técnico descreve — e não o
 * `EventSource` do browser.
 */

const RUN_ID = "0199cccc-0000-7000-8000-000000000001";

function event(sequence: number, type = "TextDelta", payload: unknown = { text: "x" }): RunEvent {
  return {
    id: `0199dddd-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    runId: RUN_ID,
    sequence,
    type,
    timestamp: "2026-09-07T14:02:11.000Z",
    payload,
  };
}

/** Um `EventSource` de mentira, dirigido pelo teste. */
class FakeSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  closed = false;

  constructor(readonly since: number) {}

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emit(runEvent: RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(runEvent) } as MessageEvent<string>);
  }

  /** O browser desistiu: é quando a store recria a conexão, com o cursor novo. */
  die(): void {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }
}

interface Harness {
  readonly transport: RunEventsTransport;
  readonly sources: FakeSource[];
  readonly pageCalls: number[];
}

function harness(pages: readonly RunEvent[][]): Harness {
  const sources: FakeSource[] = [];
  const pageCalls: number[] = [];
  let served = 0;

  return {
    sources,
    pageCalls,
    transport: {
      fetchPage: (_runId, after) => {
        pageCalls.push(after);
        const items = pages[served] ?? [];
        served += 1;
        return Promise.resolve({
          items,
          hasMore: served < pages.length,
          lastSequence: items.at(-1)?.sequence ?? after,
        });
      },
      openStream: (_runId, since) => {
        const source = new FakeSource(since);
        sources.push(source);
        return source;
      },
    },
  };
}

/** Deixa as promessas pendentes do replay resolverem. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("store do Diário", () => {
  it("faz o replay por páginas e abre o stream no cursor final", async () => {
    const { transport, sources, pageCalls } = harness([[event(1), event(2)], [event(3)]]);

    const { store, stop } = connectRunEvents(RUN_ID, transport);
    await settle();

    expect(pageCalls).toEqual([0, 2]);
    expect(store.getState().events.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(store.getState().replayDone).toBe(true);
    expect(store.getState().lastSequence).toBe(3);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.since).toBe(3);

    stop();
  });

  it("aceita eventos ao vivo depois do replay", async () => {
    const { transport, sources } = harness([[event(1)]]);

    const { store, stop } = connectRunEvents(RUN_ID, transport);
    await settle();

    const source = sources[0];
    expect(source).toBeDefined();
    source?.onopen?.(new Event("open"));
    expect(store.getState().status).toBe("open");

    source?.emit(event(2));
    source?.emit(event(3));

    expect(store.getState().events.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(store.getState().received).toBe(3);

    stop();
  });

  it("reconecta pelo cursor e descarta o replay repetido", async () => {
    const { transport, sources } = harness([[event(1)]]);

    const { store, stop } = connectRunEvents(RUN_ID, transport);
    await settle();

    const first = sources[0];
    first?.emit(event(2));
    first?.emit(event(3));
    expect(store.getState().lastSequence).toBe(3);

    first?.die();
    expect(store.getState().status).toBe("reconnecting");
    expect(first?.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);

    // A conexão nova pede a partir do que já entrou, e não do zero.
    expect(sources).toHaveLength(2);
    expect(sources[1]?.since).toBe(3);

    // O servidor reenvia 2 e 3 antes do que faltava: os dois são descartados.
    const second = sources[1];
    second?.emit(event(2));
    second?.emit(event(3));
    second?.emit(event(4));

    expect(store.getState().events.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
    expect(store.getState().received).toBe(4);

    stop();
  });

  it("fecha o stream quando o evento terminal chega", async () => {
    const { transport, sources } = harness([[event(1)]]);

    const { store, stop } = connectRunEvents(RUN_ID, transport);
    await settle();

    const source = sources[0];
    source?.emit(event(2, "RunCancelled", { processTreeTerminated: true, elapsedMs: 41_000 }));

    expect(store.getState().status).toBe("closed");
    expect(source?.closed).toBe(true);

    stop();
  });

  it("não abre stream para um Run que já terminou", async () => {
    const { transport, sources } = harness([
      [event(1), event(2, "RunCompleted", { summary: "pronto", durationMs: 1_000 })],
    ]);

    const { store, stop } = connectRunEvents(RUN_ID, transport);
    await settle();

    expect(sources).toHaveLength(0);
    expect(store.getState().status).toBe("closed");
    expect(store.getState().events).toHaveLength(2);

    stop();
  });

  it("um quadro ilegível não derruba o stream nem move o cursor", async () => {
    const { transport, sources } = harness([[event(1)]]);
    const noise = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { store, stop } = connectRunEvents(RUN_ID, transport);
    await settle();

    const source = sources[0];
    source?.onmessage?.({ data: "{isso não é json" } as MessageEvent<string>);
    expect(store.getState().lastSequence).toBe(1);

    source?.emit(event(2));
    expect(store.getState().lastSequence).toBe(2);

    noise.mockRestore();
    stop();
  });
});
