// Adapted from Archon — packages/server/src/adapters/web/transport.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: a chave deixou de ser `conversationId` e passou a ser uma assinatura
// por conexão, porque o nosso stream é um só por usuário e várias abas podem
// abri-lo ao mesmo tempo; o buffer passou a ser indexado por `sequence`, o que
// troca "reenviar tudo que estava guardado" por "reenviar o que vem depois do
// cursor" e elimina duplicata na reconexão; `Bun.serve` saiu e o writer virou
// uma interface (a API entrega o `streamSSE` do Hono); o logger do Archon virou
// um contrato opcional; entrou heartbeat, que no Archon é do servidor HTTP; o
// invariante `EVENT_BUFFER_TTL_MS >= RECONNECT_GRACE_MS` foi mantido, e agora
// também vale para os valores passados ao construtor.

import type { EventsLogger } from "./logger.js";

/** Qualquer evento que o transporte saiba ordenar e deduplicar. */
export interface SequencedEvent {
  readonly sequence: number;
}

/**
 * O mínimo que o transporte precisa de uma conexão SSE.
 *
 * Existe para o pacote não depender de Hono: a API implementa esta interface
 * sobre o `streamSSE`, e os testes implementam sobre um array.
 */
export interface SseWriter {
  writeEvent(event: { id: string; data: string; event?: string }): Promise<void>;
  /** Comentário SSE (`: texto`). É o heartbeat: não vira `message` no browser. */
  writeComment(text: string): Promise<void>;
  close(): Promise<void>;
  readonly closed: boolean;
}

/** Espera (ms) por uma reconexão antes de considerar o stream ocioso. */
export const RECONNECT_GRACE_MS = 5_000;

/**
 * Tempo máximo (ms) que um evento fica no buffer de replay.
 *
 * Precisa ser >= RECONNECT_GRACE_MS. Se for menor, um evento emitido durante a
 * janela de reconexão é descartado **antes** de o cliente ter tido chance de
 * voltar, e a tela fica com um estado que nunca mais é corrigido. 60 s cobre o
 * atraso típico de reconexão automática do `EventSource` em rede ruim (celular,
 * VPN, notebook que dormiu) sem custo de memória relevante: são strings curtas,
 * e o teto abaixo limita o pior caso.
 */
export const EVENT_BUFFER_TTL_MS = 60_000;

/** Máximo de eventos guardados no buffer de replay antes de descartar os mais antigos. */
export const EVENT_BUFFER_MAX = 500;

/** Intervalo mínimo (ms) entre avisos de descarte por estouro de buffer. */
export const EVICTION_WARN_THROTTLE_MS = 5_000;

/** Intervalo padrão (ms) do heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Invariante que falha cedo: o buffer precisa sobreviver à janela de reconexão.
 *
 * É função exportada, e não um `if` solto, para valer nos dois lugares em que
 * os dois números podem divergir: nas constantes do módulo (checadas no
 * carregamento, logo abaixo) e nos valores passados ao construtor.
 */
export function assertReplayBufferInvariant(bufferTtlMs: number, graceMs: number): void {
  if (bufferTtlMs < graceMs) {
    throw new Error(
      `EVENT_BUFFER_TTL_MS (${bufferTtlMs}) precisa ser >= RECONNECT_GRACE_MS (${graceMs}): ` +
        "um evento emitido durante a reconexão sumiria antes de o cliente voltar.",
    );
  }
}

// Checado no carregamento do módulo: editar as constantes para um par inválido
// quebra o import, não um caso de borda em produção.
assertReplayBufferInvariant(EVENT_BUFFER_TTL_MS, RECONNECT_GRACE_MS);

interface BufferedEvent<TEvent extends SequencedEvent> {
  readonly event: TEvent;
  readonly timestamp: number;
}

export interface SseTransportOptions<TEvent extends SequencedEvent> {
  /** Converte o evento no corpo `data:` do SSE. */
  serialize: (event: TEvent) => string;
  /** Espera por reconexão antes de `onIdle`. Padrão: `RECONNECT_GRACE_MS`. */
  graceMs?: number;
  /** TTL do buffer de replay. Padrão: `EVENT_BUFFER_TTL_MS`. */
  bufferTtlMs?: number;
  /** Teto do buffer de replay. Padrão: `EVENT_BUFFER_MAX`. */
  bufferMax?: number;
  /** Intervalo do heartbeat. `0` desliga. Padrão: `HEARTBEAT_INTERVAL_MS`. */
  heartbeatIntervalMs?: number;
  /** Chamado quando a janela de graça acaba sem ninguém reconectar. */
  onIdle?: () => void;
  logger?: EventsLogger;
  /** Relógio injetável, para teste. */
  now?: () => number;
}

export interface SubscribeOptions {
  writer: SseWriter;
  /** Último `sequence` que o cliente já tem. `0` significa "não tenho nada". */
  since: number;
}

/**
 * Uma conexão SSE viva.
 *
 * O ciclo é sempre o mesmo: nasce em `replaying`, recebe o histórico por
 * `deliver`, e só então vai para `live` com `goLive`. Enquanto está em
 * `replaying`, o que chega por `broadcast` fica numa fila própria, o que garante
 * que o cliente veja tudo em ordem crescente de `sequence` e sem repetição,
 * mesmo que um evento novo apareça no meio do replay.
 */
export class SseSubscription<TEvent extends SequencedEvent> {
  private state: "replaying" | "live" | "closed" = "replaying";
  private pending: BufferedEvent<TEvent>[] = [];
  private lastEvictionWarnAt = 0;
  private cursorValue: number;

  constructor(
    private readonly transport: SseTransport<TEvent>,
    private readonly writer: SseWriter,
    since: number,
    private readonly options: {
      serialize: (event: TEvent) => string;
      bufferTtlMs: number;
      bufferMax: number;
      logger: EventsLogger | undefined;
      now: () => number;
    },
  ) {
    this.cursorValue = since;
  }

  /** Último `sequence` entregue a este cliente. */
  get cursor(): number {
    return this.cursorValue;
  }

  get closed(): boolean {
    return this.state === "closed" || this.writer.closed;
  }

  get live(): boolean {
    return this.state === "live";
  }

  /**
   * Escreve um evento agora, pulando a fila. É o caminho do replay.
   *
   * Ignora em silêncio o que já foi entregue: `sequence <= cursor` é a única
   * regra de deduplicação do sistema, e vale igual para replay e para vivo.
   */
  async deliver(event: TEvent): Promise<void> {
    if (this.state === "closed") return;
    if (event.sequence <= this.cursorValue) return;

    try {
      await this.writer.writeEvent({
        id: String(event.sequence),
        data: this.options.serialize(event),
      });
      this.cursorValue = event.sequence;
    } catch (error) {
      this.options.logger?.warn?.({ err: error, sequence: event.sequence }, "sse_write_failed");
      // Fecha para o `EventSource` do browser perceber a queda e reconectar
      // com o cursor, em vez de ficar preso num socket morto.
      await this.closeQuietly();
    }
  }

  /** Entrega vários em ordem. Para no primeiro fechamento. */
  async deliverAll(events: readonly TEvent[]): Promise<void> {
    for (const event of events) {
      if (this.closed) return;
      await this.deliver(event);
    }
  }

  /** @internal Usado pelo transporte quando um evento chega durante o replay. */
  enqueue(event: TEvent): void {
    if (this.state !== "replaying") return;
    if (event.sequence <= this.cursorValue) return;

    this.pending.push({ event, timestamp: this.options.now() });

    if (this.pending.length > this.options.bufferMax) {
      this.pending.shift();
      // Um produtor descontrolado estouraria o buffer centenas de vezes num
      // laço e afogaria o log. Um aviso por janela basta para notar.
      const now = this.options.now();
      if (now - this.lastEvictionWarnAt >= EVICTION_WARN_THROTTLE_MS) {
        this.lastEvictionWarnAt = now;
        this.options.logger?.warn?.(
          { bufferMax: this.options.bufferMax },
          "sse_pending_buffer_evicted_oldest",
        );
      }
    }
  }

  /**
   * Termina o replay: descarrega a fila e passa a escrever direto.
   *
   * O que ficou tempo demais na fila é descartado com aviso, e não em silêncio:
   * se isso aparecer no log, o replay está demorando mais que o TTL e a tela do
   * usuário perdeu evento.
   */
  async goLive(): Promise<void> {
    if (this.state !== "replaying") return;

    const now = this.options.now();
    const valid = this.pending.filter((item) => now - item.timestamp < this.options.bufferTtlMs);
    const expired = this.pending.length - valid.length;
    this.pending = [];

    if (expired > 0) {
      this.options.logger?.warn?.(
        { expired, ttlMs: this.options.bufferTtlMs },
        "sse_pending_buffer_ttl_expired",
      );
    }

    // A fila pode ter chegado fora de ordem se dois drains se cruzarem; o
    // cliente precisa ver `sequence` crescente para o cursor dele fazer sentido.
    valid.sort((a, b) => a.event.sequence - b.event.sequence);

    for (const item of valid) {
      if (this.closed) break;
      await this.deliver(item.event);
    }

    if (this.state === "replaying") {
      this.state = "live";
    }
  }

  /** Fecha o writer e desregistra do transporte. Idempotente. */
  async close(): Promise<void> {
    await this.closeQuietly();
  }

  private async closeQuietly(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    this.pending = [];
    this.transport.forget(this);

    if (!this.writer.closed) {
      try {
        await this.writer.close();
      } catch (error) {
        this.options.logger?.debug?.({ err: error }, "sse_close_failed");
      }
    }
  }

  /** @internal Heartbeat. Devolve `false` quando a conexão morreu. */
  async heartbeat(): Promise<boolean> {
    if (this.closed) return false;
    try {
      await this.writer.writeComment("heartbeat");
      return true;
    } catch (error) {
      this.options.logger?.debug?.({ err: error }, "sse_heartbeat_failed");
      await this.closeQuietly();
      return false;
    }
  }
}

/**
 * Registro das conexões SSE vivas, com buffer de replay por `sequence`.
 *
 * O transporte não conhece HTTP nem banco: recebe eventos por `broadcast`,
 * entrega a quem está conectado e guarda os recentes para quem reconectar logo
 * em seguida. Quem preenche uma lacuna que o buffer não cobre é a API, lendo do
 * banco — o buffer é atalho, nunca fonte da verdade.
 */
export class SseTransport<TEvent extends SequencedEvent> {
  private readonly subscriptions = new Set<SseSubscription<TEvent>>();
  private readonly buffer: BufferedEvent<TEvent>[] = [];
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEvictionWarnAt = 0;
  private started = false;

  private readonly serialize: (event: TEvent) => string;
  private readonly graceMs: number;
  private readonly bufferTtlMs: number;
  private readonly bufferMax: number;
  private readonly heartbeatIntervalMs: number;
  private readonly onIdle: (() => void) | undefined;
  private readonly logger: EventsLogger | undefined;
  private readonly now: () => number;

  constructor(options: SseTransportOptions<TEvent>) {
    this.serialize = options.serialize;
    this.graceMs = options.graceMs ?? RECONNECT_GRACE_MS;
    this.bufferTtlMs = options.bufferTtlMs ?? EVENT_BUFFER_TTL_MS;
    this.bufferMax = options.bufferMax ?? EVENT_BUFFER_MAX;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.onIdle = options.onIdle;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;

    // O invariante também vale para o que o chamador escolheu, senão dava para
    // burlá-lo pelo construtor e o `throw` no carregamento não protegeria nada.
    assertReplayBufferInvariant(this.bufferTtlMs, this.graceMs);
  }

  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Verdadeiro enquanto vale a pena drenar.
   *
   * Inclui a janela de graça de propósito: durante uma reconexão não há
   * assinante, e é justamente aí que o poller não pode adiantar o cursor sem
   * emitir, ou os eventos da janela sumiriam.
   */
  hasSubscribers(): boolean {
    if (this.subscriptions.size > 0) return true;
    return this.graceTimer !== null;
  }

  /** Liga o heartbeat, que também é o coletor de conexões mortas. */
  start(): void {
    if (this.started) return;
    this.started = true;

    if (this.heartbeatIntervalMs > 0) {
      this.heartbeatHandle = setInterval(() => {
        void this.tick();
      }, this.heartbeatIntervalMs);
      this.heartbeatHandle.unref?.();
    }

    this.logger?.info?.({ heartbeatIntervalMs: this.heartbeatIntervalMs }, "sse_transport_started");
  }

  /** Fecha tudo. Usado no shutdown do processo. */
  async stop(): Promise<void> {
    this.started = false;

    if (this.heartbeatHandle !== null) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }

    const open = [...this.subscriptions];
    this.subscriptions.clear();
    this.buffer.length = 0;

    await Promise.all(open.map((subscription) => subscription.close()));

    this.logger?.info?.({ closed: open.length }, "sse_transport_stopped");
  }

  /** Abre uma assinatura em estado de replay. Quem chama termina com `goLive`. */
  subscribe(options: SubscribeOptions): SseSubscription<TEvent> {
    const subscription = new SseSubscription<TEvent>(this, options.writer, options.since, {
      serialize: this.serialize,
      bufferTtlMs: this.bufferTtlMs,
      bufferMax: this.bufferMax,
      logger: this.logger,
      now: this.now,
    });

    this.subscriptions.add(subscription);

    // Alguém voltou: a janela de graça não precisa mais correr.
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }

    this.logger?.debug?.(
      { since: options.since, total: this.subscriptions.size },
      "sse_subscribed",
    );

    return subscription;
  }

  /**
   * O que o buffer consegue reenviar a partir de um cursor.
   *
   * Devolve `null` quando não dá para **provar** que o buffer cobre a faixa —
   * buffer vazio, ou o mais antigo guardado já é posterior a `since + 1`. Nesse
   * caso quem chama lê do banco. A dúvida sempre resolve para o banco: um
   * replay a mais custa uma consulta, um replay a menos custa um evento perdido.
   */
  replaySince(since: number): TEvent[] | null {
    this.evictExpired();

    const oldest = this.buffer[0];
    if (oldest === undefined) return null;
    if (oldest.event.sequence > since + 1) return null;

    return this.buffer
      .filter((item) => item.event.sequence > since)
      .map((item) => item.event)
      .sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Entrega um evento a todo mundo e guarda no buffer de replay.
   *
   * Fire-and-forget de propósito: quem chama é o poller, que já tem cursor
   * próprio e vai reconciliar no próximo drain. Uma escrita lenta em um cliente
   * não pode segurar o drain dos outros.
   */
  broadcast(event: TEvent): void {
    this.bufferEvent(event);

    for (const subscription of this.subscriptions) {
      if (subscription.closed) {
        this.forget(subscription);
        continue;
      }

      if (subscription.live) {
        void subscription.deliver(event);
      } else {
        subscription.enqueue(event);
      }
    }
  }

  /** @internal Chamado pela assinatura ao fechar. */
  forget(subscription: SseSubscription<TEvent>): void {
    if (!this.subscriptions.delete(subscription)) return;

    this.logger?.debug?.({ total: this.subscriptions.size }, "sse_unsubscribed");

    if (this.subscriptions.size > 0) return;
    if (this.graceTimer !== null) return;

    // Ninguém conectado: espera a janela de graça antes de avisar que ficou
    // ocioso, porque um F5 no browser passa por aqui e volta em milissegundos.
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.subscriptions.size > 0) return;
      try {
        this.onIdle?.();
      } catch (error) {
        this.logger?.warn?.({ err: error }, "sse_idle_callback_failed");
      }
    }, this.graceMs);
    this.graceTimer.unref?.();
  }

  private bufferEvent(event: TEvent): void {
    this.buffer.push({ event, timestamp: this.now() });
    this.evictExpired();

    if (this.buffer.length > this.bufferMax) {
      this.buffer.splice(0, this.buffer.length - this.bufferMax);
      const now = this.now();
      if (now - this.lastEvictionWarnAt >= EVICTION_WARN_THROTTLE_MS) {
        this.lastEvictionWarnAt = now;
        this.logger?.warn?.({ bufferMax: this.bufferMax }, "sse_replay_buffer_evicted_oldest");
      }
    }
  }

  private evictExpired(): void {
    const limit = this.now() - this.bufferTtlMs;
    let cut = 0;
    while (cut < this.buffer.length && this.buffer[cut]!.timestamp <= limit) {
      cut += 1;
    }
    if (cut > 0) this.buffer.splice(0, cut);
  }

  /** Heartbeat mais coleta de conexões mortas, no mesmo tique. */
  private async tick(): Promise<void> {
    this.evictExpired();

    for (const subscription of [...this.subscriptions]) {
      if (subscription.closed) {
        this.forget(subscription);
        continue;
      }
      if (!subscription.live) continue;
      await subscription.heartbeat();
    }
  }
}
