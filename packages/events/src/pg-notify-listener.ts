// Adapted from Archon — packages/server/src/adapters/web/pg-notify-listener.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: o `DbNotificationListener` do Archon virou a interface `Notifier`
// declarada aqui, para o pacote não importar `pg` nem o pacote de banco; o
// logger virou contrato opcional; o canal entra por parâmetro em vez de vir de
// uma constante do core; o resto — reconexão com backoff exponencial, teto de
// 30 s, `stop()` durante um `listen()` em voo e o `unref` do timer — é do
// original.

import type { EventsLogger } from "./logger.js";

/** Cancela a assinatura. Idempotente. */
export type Unlisten = () => void;

/** O que `@dungeon-master/database` entrega, sem que este pacote conheça `pg`. */
export interface Notifier {
  listen(
    channel: string,
    onNotify: (payload: string) => void,
    onError: (error: Error) => void,
  ): Promise<Unlisten>;
}

/** O que o listener acorda. Na prática, o `DashboardEventPoller`. */
export interface Drainable {
  drainNow(): Promise<void>;
}

export const MAX_BACKOFF_MS = 30_000;

export interface PgNotifyListenerOptions {
  notifier: Notifier;
  drainable: Drainable;
  channel: string;
  /** Primeira espera antes de reconectar. Dobra até `MAX_BACKOFF_MS`. */
  initialBackoffMs?: number;
  logger?: EventsLogger;
}

/**
 * Ponte de tempo real do PostgreSQL: `LISTEN` num canal e acorda o drain.
 *
 * A notificação não traz nada para emitir; ela só chama `drainNow()`. É o que
 * mantém cursor, leitura e dedup num lugar só (o poller), de modo que uma
 * notificação perdida ou coalescida nunca dessincroniza o estado — o drain por
 * cursor é a autoridade, e o tique de segurança do poller reconcilia o que
 * escapar durante uma reconexão do `LISTEN`.
 *
 * Um por processo: a conexão é dedicada e não volta para o pool.
 */
export class PgNotifyListener {
  private readonly notifier: Notifier;
  private readonly drainable: Drainable;
  private readonly channel: string;
  private readonly initialBackoffMs: number;
  private readonly logger: EventsLogger | undefined;

  private unlisten: Unlisten | null = null;
  private stopped = false;
  private backoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: PgNotifyListenerOptions) {
    this.notifier = options.notifier;
    this.drainable = options.drainable;
    this.channel = options.channel;
    this.initialBackoffMs = options.initialBackoffMs ?? 1_000;
    this.backoffMs = this.initialBackoffMs;
    this.logger = options.logger;
  }

  get listening(): boolean {
    return this.unlisten !== null;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.unlisten !== null) {
      this.safeUnlisten(this.unlisten);
      this.unlisten = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    try {
      const unlisten = await this.notifier.listen(
        this.channel,
        () => {
          void this.drainable.drainNow();
        },
        () => {
          this.scheduleReconnect();
        },
      );

      // `stop()` pode ter rodado enquanto o `listen()` estava em voo. Deixar a
      // assinatura viva faria o drain continuar depois do shutdown.
      if (this.stopped) {
        this.safeUnlisten(unlisten);
        return;
      }

      this.unlisten = unlisten;
      this.backoffMs = this.initialBackoffMs;
      this.logger?.info?.({ channel: this.channel }, "pg_notify_listening");
    } catch (error) {
      this.logger?.warn?.({ err: error, channel: this.channel }, "pg_notify_connect_failed");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;

    if (this.unlisten !== null) {
      this.safeUnlisten(this.unlisten);
      this.unlisten = null;
    }

    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);

    this.logger?.warn?.({ delayMs: delay, channel: this.channel }, "pg_notify_reconnect_scheduled");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private safeUnlisten(unlisten: Unlisten): void {
    try {
      unlisten();
    } catch (error) {
      this.logger?.debug?.({ err: error, channel: this.channel }, "pg_notify_unlisten_error");
    }
  }
}
