import { EVENTS_STREAM_PATH } from "@dungeon-master/api-client";
import type { DashboardEvent } from "@dungeon-master/contracts";
import { create } from "zustand";

/**
 * Estado do stream de eventos, alimentado por um `EventSource`.
 *
 * O cursor é a `sequence` do último evento recebido. Ele existe aqui, e não na
 * URL, porque é o que a store devolve à API ao reconectar — o mesmo número que
 * o browser reenvia sozinho no header `Last-Event-ID` numa reconexão
 * automática (documento técnico, seção 10.1).
 */

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

/** Um ouvinte de evento. Devolve a função que cancela a inscrição. */
export type EventListener = (event: DashboardEvent) => void;

/** Espera antes de recriar o `EventSource`, quando ele desiste sozinho. */
const RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

interface EventsState {
  status: ConnectionStatus;
  /** Último `sequence` recebido. `0` significa "ainda não vi nada". */
  lastSequence: number;
  lastEvent: DashboardEvent | null;
  /** Quantos eventos chegaram nesta sessão da página. */
  received: number;
  connect: () => void;
  disconnect: () => void;
  /** Inscreve um ouvinte. Devolve a função que cancela. */
  addListener: (listener: EventListener) => () => void;
}

/**
 * Estado vivo do `EventSource`, fora da store.
 *
 * A store guarda o que a interface renderiza; a conexão em si não é dado de
 * render e mudá-la não deve provocar redesenho.
 */
let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = RECONNECT_DELAY_MS;
const listeners = new Set<EventListener>();

function clearReconnectTimer(): void {
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

export const useEventsStore = create<EventsState>((set, get) => {
  function open(): void {
    closeSource();
    clearReconnectTimer();

    const { lastSequence } = get();
    set({ status: lastSequence > 0 ? "reconnecting" : "connecting" });

    // O `since` cobre a primeira conexão e a reconexão que a store faz por
    // conta própria. Numa reconexão automática do browser a URL é esta mesma,
    // já velha, mas o `Last-Event-ID` vai junto e a API dá precedência a ele.
    const next = new EventSource(`${EVENTS_STREAM_PATH}?since=${String(lastSequence)}`);
    source = next;

    next.onopen = () => {
      reconnectDelayMs = RECONNECT_DELAY_MS;
      set({ status: "open" });
    };

    next.onmessage = (message: MessageEvent<string>) => {
      let event: DashboardEvent;
      try {
        event = JSON.parse(message.data) as DashboardEvent;
      } catch {
        // Quadro corrompido não pode derrubar o stream inteiro; o próximo drain
        // reenvia o que importa, e o cursor não avança sobre o que não foi lido.
        console.error("[events] quadro SSE ilegível", message.data);
        return;
      }

      // O cursor nunca anda para trás: um replay repetido não desfaz progresso.
      set((state) => ({
        lastSequence: Math.max(state.lastSequence, event.sequence),
        lastEvent: event,
        received: state.received + 1,
      }));

      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("[events] ouvinte falhou", error);
        }
      }
    };

    next.onerror = () => {
      if (source !== next) return;

      set({ status: "reconnecting" });

      // `CONNECTING` é o browser já tentando de novo sozinho, com o
      // `Last-Event-ID`. Só quando ele desiste (`CLOSED`) é que a store recria
      // o `EventSource`, aí sim com o `since` atualizado na URL.
      if (next.readyState === EventSource.CLOSED) {
        closeSource();
        clearReconnectTimer();
        const delay = reconnectDelayMs;
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        reconnectTimer = setTimeout(open, delay);
      }
    };
  }

  return {
    status: "connecting",
    lastSequence: 0,
    lastEvent: null,
    received: 0,

    connect: () => {
      if (source !== null) return;
      open();
    },

    disconnect: () => {
      clearReconnectTimer();
      closeSource();
      set({ status: "connecting" });
    },

    addListener: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});
