import type { components } from "@dungeon-master/api-client";
import { useCallback, useSyncExternalStore } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";

import { runEventsPath, runEventsStreamPath } from "@/lib/runs";

export type RunEvent = components["schemas"]["RunEvent"];
type RunEventList = components["schemas"]["RunEventList"];

/**
 * O Diário de uma Expedição: replay pelo cursor, depois ao vivo pelo stream.
 *
 * A ordem importa e é sempre a mesma (documento técnico, seção 10.1). Primeiro
 * o log é lido por páginas a partir de `after`, até acabar; então o
 * `EventSource` abre com `since` no último `sequence` que já entrou. Numa queda,
 * o cliente devolve o mesmo cursor e o servidor reenvia dali — o `NOTIFY` não
 * carrega evento, então nunca existe um segundo lugar decidindo "o que o
 * cliente perdeu".
 *
 * A deduplicação é o cursor, e só ele: um evento com `sequence` menor ou igual
 * ao que já entrou é replay repetido e é descartado. É isso que faz reconexão
 * ser barata — reenviar demais não custa nada, e reenviar de menos seria um
 * buraco no log.
 *
 * Uma store por Run, com contagem de referências: duas partes da tela olhando o
 * mesmo Run compartilham uma conexão, e a última a sair a fecha.
 */

export type RunStreamStatus = "replaying" | "open" | "reconnecting" | "closed";

export interface RunEventsState {
  readonly status: RunStreamStatus;
  /** Em ordem crescente de `sequence`, sem repetição e sem buraco reintroduzido. */
  readonly events: readonly RunEvent[];
  /** O cursor: maior `sequence` já aceito. `0` significa "ainda não vi nada". */
  readonly lastSequence: number;
  /** Quantos eventos entraram nesta sessão da página, replay incluído. */
  readonly received: number;
  /** Instante do último evento aceito, para o rodapé dizer "há N s". */
  readonly lastEventAt: number | null;
  /** O replay ainda não terminou de percorrer as páginas. */
  readonly replayDone: boolean;
  readonly error: string | null;
}

export type RunEventsStore = StoreApi<RunEventsState>;

/** O mínimo do `EventSource` de que a store depende, para o teste poder fingir. */
export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  readonly readyState: number;
  close: () => void;
}

export interface RunEventsTransport {
  /** Uma página do log a partir do cursor. */
  readonly fetchPage: (runId: string, after: number) => Promise<RunEventList>;
  readonly openStream: (runId: string, since: number) => EventSourceLike;
}

/** `CLOSED` do `EventSource`: o browser desistiu e não vai tentar de novo sozinho. */
const CLOSED = 2;

const REPLAY_PAGE_SIZE = 500;
const RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

/** Os quatro eventos que fecham o fluxo. Depois de um deles nada mais é emitido. */
const TERMINAL_TYPES: readonly string[] = [
  "RunCompleted",
  "RunFailed",
  "RunTimedOut",
  "RunCancelled",
];

export function isTerminalEvent(event: RunEvent): boolean {
  return TERMINAL_TYPES.includes(event.type);
}

const DEFAULT_TRANSPORT: RunEventsTransport = {
  fetchPage: async (runId, after) => {
    const response = await fetch(runEventsPath(runId, after, REPLAY_PAGE_SIZE), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`O log respondeu ${String(response.status)}.`);
    return (await response.json()) as RunEventList;
  },
  openStream: (runId, since) => new EventSource(runEventsStreamPath(runId, since)),
};

export interface RunEventsConnection {
  readonly store: RunEventsStore;
  /** Encerra o replay e o stream. Idempotente. */
  readonly stop: () => void;
}

/**
 * Abre a conexão de um Run e devolve a store que a tela lê.
 *
 * Exportada para o teste: ele injeta um transporte falso e conduz replay,
 * eventos ao vivo e reconexão sem browser nenhum.
 */
export function connectRunEvents(
  runId: string,
  transport: RunEventsTransport = DEFAULT_TRANSPORT,
): RunEventsConnection {
  const store = createStore<RunEventsState>(() => ({
    status: "replaying",
    events: [],
    lastSequence: 0,
    received: 0,
    lastEventAt: null,
    replayDone: false,
    error: null,
  }));

  let source: EventSourceLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelayMs = RECONNECT_DELAY_MS;
  let stopped = false;

  function clearTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function closeSource(): void {
    if (source !== null) {
      source.close();
      source = null;
    }
  }

  /**
   * Aceita um evento, ou o descarta por já ter entrado.
   *
   * Devolve `true` quando o evento era novo, porque quem chama precisa saber se
   * um terminal chegou pela primeira vez.
   */
  function accept(event: RunEvent): boolean {
    let accepted = false;

    store.setState((state) => {
      if (event.sequence <= state.lastSequence) return state;
      accepted = true;
      return {
        ...state,
        events: [...state.events, event],
        lastSequence: event.sequence,
        received: state.received + 1,
        lastEventAt: Date.now(),
      };
    });

    return accepted;
  }

  function acceptMany(events: readonly RunEvent[]): void {
    for (const event of events) accept(event);
  }

  function openStream(): void {
    if (stopped) return;
    closeSource();
    clearTimer();

    const since = store.getState().lastSequence;
    const next = transport.openStream(runId, since);
    source = next;

    next.onopen = () => {
      reconnectDelayMs = RECONNECT_DELAY_MS;
      store.setState((state) => ({ ...state, status: "open", error: null }));
    };

    next.onmessage = (message: MessageEvent<string>) => {
      let event: RunEvent;
      try {
        event = JSON.parse(message.data) as RunEvent;
      } catch {
        // Um quadro corrompido não pode derrubar o stream: o cursor não avança
        // sobre o que não foi lido, e o próximo replay o traz de volta.
        console.error("[run-events] quadro SSE ilegível", message.data);
        return;
      }

      const novo = accept(event);
      if (novo && isTerminalEvent(event)) {
        // Depois do terminal não vem mais nada. Segurar a conexão aberta só
        // gastaria um slot de HTTP por aba esquecida.
        stopped = true;
        closeSource();
        clearTimer();
        store.setState((state) => ({ ...state, status: "closed" }));
      }
    };

    next.onerror = () => {
      if (source !== next || stopped) return;

      store.setState((state) => ({ ...state, status: "reconnecting" }));

      // `CONNECTING` é o browser já tentando sozinho, com o `Last-Event-ID`. Só
      // quando ele desiste (`CLOSED`) a store recria a conexão, aí com o cursor
      // atualizado na URL.
      if (next.readyState === CLOSED) {
        closeSource();
        clearTimer();
        const delay = reconnectDelayMs;
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        reconnectTimer = setTimeout(openStream, delay);
      }
    };
  }

  async function replay(): Promise<void> {
    try {
      for (;;) {
        if (stopped) return;
        const page = await transport.fetchPage(runId, store.getState().lastSequence);
        acceptMany(page.items);
        if (!page.hasMore) break;
        // Uma página vazia com `hasMore` seria um laço infinito: o cursor não
        // andou, então não há o que buscar de novo.
        if (page.items.length === 0) break;
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        error: error instanceof Error ? error.message : String(error),
      }));
    }

    if (stopped) return;
    store.setState((state) => ({ ...state, replayDone: true }));

    // Um Run já encerrado não precisa de stream: o último evento do replay é o
    // terminal, e abrir a conexão só para vê-la fechar é ruído.
    const { events } = store.getState();
    const last = events.at(-1);
    if (last !== undefined && isTerminalEvent(last)) {
      stopped = true;
      store.setState((state) => ({ ...state, status: "closed" }));
      return;
    }

    openStream();
  }

  void replay();

  return {
    store,
    stop: () => {
      stopped = true;
      clearTimer();
      closeSource();
    },
  };
}

/* ------------------------------------------------- contagem de referências */

interface Entry {
  readonly connection: RunEventsConnection;
  refs: number;
}

const open = new Map<string, Entry>();

function acquire(runId: string): RunEventsStore {
  const existing = open.get(runId);
  if (existing !== undefined) {
    existing.refs += 1;
    return existing.connection.store;
  }

  const connection = connectRunEvents(runId);
  open.set(runId, { connection, refs: 1 });
  return connection.store;
}

function release(runId: string): void {
  const entry = open.get(runId);
  if (entry === undefined) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  entry.connection.stop();
  open.delete(runId);
}

const EMPTY: RunEventsState = Object.freeze({
  status: "replaying",
  events: Object.freeze([]),
  lastSequence: 0,
  received: 0,
  lastEventAt: null,
  replayDone: false,
  error: null,
});

/**
 * O Diário de um Run dentro de um componente.
 *
 * A inscrição é quem abre e fecha a conexão: `useSyncExternalStore` chama
 * `subscribe` na montagem e a limpeza na desmontagem, então a contagem de
 * referências é feita pelo próprio React. Duas partes da tela olhando o mesmo
 * Run somam duas referências e uma só conexão, e o StrictMode — que monta,
 * desmonta e monta de novo — cai no caminho normal em vez de num caso especial.
 *
 * O snapshot é o estado inteiro, e não uma fatia: a store devolve um objeto
 * novo só quando algo mudou, e o cockpit redesenha a cada evento de qualquer
 * jeito, porque a lista é o conteúdo principal da tela.
 */
export function useRunEvents(runId: string): RunEventsState {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const store = acquire(runId);
      const unsubscribe = store.subscribe(onChange);
      // Um evento pode ter entrado entre o `acquire` e o `subscribe`.
      onChange();
      return () => {
        unsubscribe();
        release(runId);
      };
    },
    [runId],
  );

  const snapshot = useCallback(
    () => open.get(runId)?.connection.store.getState() ?? EMPTY,
    [runId],
  );

  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}
