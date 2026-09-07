// Adapted from Archon — packages/server/src/adapters/web/dashboard-event-poller.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: o cursor deixou de ser `created_at` e passou a ser a `sequence` do
// `bigserial`, o que dispensa o truque de `>= cursor` mais `seenAtBoundary` que
// o Archon precisa por causa da resolução de 1 segundo do SQLite; a fonte de
// dados entra por injeção em vez de importar o repositório; o `__dashboard__`
// (uma conversa entre várias) virou "todo mundo conectado", porque o sistema é
// single-user; a coalescência de drains, a paginação até esvaziar e a escalada
// de log depois de N falhas seguidas são do original.

import type { EventsLogger } from "./logger.js";
import type { SequencedEvent } from "./sse-transport.js";

/** Teto de linhas por página de drain. */
export const DRAIN_LIMIT = 500;

/** Depois de tantas falhas seguidas, o log sobe de `warn` para `error`. */
export const FAILURE_ESCALATION_THRESHOLD = 5;

/** Tique de segurança, para o caso de uma notificação se perder. */
export const FALLBACK_INTERVAL_MS = 5_000;

/** De onde o drain lê. Na API é `listDashboardEventsSince` sobre o PostgreSQL. */
export interface DashboardEventSource<TEvent extends SequencedEvent> {
  listSince(afterSequence: number, limit: number): Promise<TEvent[]>;
}

/** A fatia do transporte que o poller usa. */
export interface PollerTransport<TEvent extends SequencedEvent> {
  hasSubscribers(): boolean;
  broadcast(event: TEvent): void;
}

export interface DashboardEventPollerOptions<TEvent extends SequencedEvent> {
  source: DashboardEventSource<TEvent>;
  transport: PollerTransport<TEvent>;
  /** Cursor inicial. Padrão `0`, que reenvia tudo ao primeiro assinante. */
  startCursor?: number;
  limit?: number;
  logger?: EventsLogger;
}

/**
 * Faz o drain de `dashboard_event` por cursor e empurra para o transporte.
 *
 * É o outro lado do NOTIFY sem payload (documento técnico, seção 10.1): a
 * notificação não traz nada, só chama `drainNow()`. Cursor, leitura e dedup
 * ficam aqui, então uma notificação perdida ou coalescida não dessincroniza
 * nada — o tique de segurança do `start()` reconcilia no pior caso.
 *
 * Limite conhecido: `sequence` é atribuída na inserção, não no commit. Duas
 * transações concorrentes podem commitar fora de ordem, e um drain no meio
 * dessa janela adianta o cursor por cima da menor. Na Fase 0 os dois únicos
 * produtores são o PUT de configuração e o ping manual, ambos de uma inserção
 * só, então a janela não existe na prática. Quando houver escrita concorrente
 * de verdade (Worker gravando `run_event`), isto vira uma marca d'água que
 * segura o cursor na primeira lacuna por um tempo curto.
 */
export class DashboardEventPoller<TEvent extends SequencedEvent> {
  private readonly source: DashboardEventSource<TEvent>;
  private readonly transport: PollerTransport<TEvent>;
  private readonly limit: number;
  private readonly logger: EventsLogger | undefined;

  private cursorValue: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private redrainRequested = false;
  private consecutiveFailures = 0;

  constructor(options: DashboardEventPollerOptions<TEvent>) {
    this.source = options.source;
    this.transport = options.transport;
    this.limit = options.limit ?? DRAIN_LIMIT;
    this.logger = options.logger;
    this.cursorValue = options.startCursor ?? 0;
  }

  /** Último `sequence` já empurrado para o transporte. */
  get cursor(): number {
    return this.cursorValue;
  }

  /** Liga o tique de segurança. O caminho rápido é o NOTIFY chamando `drainNow`. */
  start(intervalMs: number = FALLBACK_INTERVAL_MS): void {
    if (this.intervalHandle !== null) return;
    if (intervalMs <= 0) return;

    this.intervalHandle = setInterval(() => {
      void this.drain();
    }, intervalMs);
    // O tique não pode segurar o processo vivo; quem faz isso é o servidor HTTP.
    this.intervalHandle.unref?.();

    this.logger?.info?.({ intervalMs }, "dashboard_poller_started");
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Drena agora. É o que o `PgNotifyListener` chama a cada notificação. */
  drainNow(): Promise<void> {
    return this.drain();
  }

  private async drain(): Promise<void> {
    // Um drain já rodando absorve o pedido e faz uma passada a mais no fim, de
    // modo que uma rajada de NOTIFYs vira um único drain final.
    if (this.draining) {
      this.redrainRequested = true;
      return;
    }

    // Sem ninguém conectado o drain é desperdício. O cursor **não** avança:
    // quem chegar depois pede o replay a partir do que já tem, e a API lê do
    // banco. Adiantar aqui esconderia eventos de quem ainda vai conectar.
    if (!this.transport.hasSubscribers()) return;

    this.draining = true;
    try {
      do {
        this.redrainRequested = false;
        await this.drainOnce();
      } while (this.redrainRequested);
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures += 1;
      // Banco fora por muito tempo é diferente de uma falha isolada, e precisa
      // aparecer como erro em vez de virar um warn indistinguível a cada tique.
      if (this.consecutiveFailures >= FAILURE_ESCALATION_THRESHOLD) {
        this.logger?.error?.(
          { err: error, consecutiveFailures: this.consecutiveFailures },
          "dashboard_poller_drain_failing_persistently",
        );
      } else {
        this.logger?.warn?.({ err: error }, "dashboard_poller_drain_failed");
      }
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(): Promise<void> {
    // Pagina até esvaziar: um cliente que ficou fora por muito tempo pode ter
    // mais eventos atrasados do que o limite de uma leitura.
    for (;;) {
      const rows = await this.source.listSince(this.cursorValue, this.limit);
      if (rows.length === 0) return;

      for (const event of rows) {
        // Dedup: o cursor é a única memória necessária. Uma linha repetida numa
        // leitura sobreposta não passa daqui.
        if (event.sequence <= this.cursorValue) continue;
        this.transport.broadcast(event);
        this.cursorValue = event.sequence;
      }

      if (rows.length < this.limit) return;
    }
  }
}
