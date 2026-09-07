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

/**
 * Quanto a marca d'água espera por um evento que falta antes de desistir dele.
 *
 * Uma lacuna de `sequence` tem duas causas possíveis, e elas pedem respostas
 * opostas. A primeira é temporária: duas transações concorrentes pegaram
 * `sequence` 7 e 8, e a 8 commitou primeiro — a 7 chega em milissegundos, e
 * entregar a 8 antes faria o cursor pular a 7 para sempre. A segunda é
 * permanente: a transação da 7 sofreu `ROLLBACK` e aquele número nunca vai
 * existir, porque `bigserial` não volta atrás.
 *
 * Não dá para distinguir as duas olhando a lacuna; dá para distinguir
 * esperando. Este é o prazo, e ele é curto porque o custo de errar para cada
 * lado é assimétrico: segurar um evento por um segundo é latência, e pular um
 * evento é perda.
 *
 * `run_event` não precisa disto — a `sequence` de lá é `MAX+1` com a linha do
 * Run travada, e uma transação abortada não deixa buraco. A espera é o preço
 * de o mesmo poller servir os dois.
 */
export const GAP_GRACE_MS = 1_000;

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
  /** Quanto a marca d'água segura um evento por causa de uma lacuna. */
  gapGraceMs?: number;
  /** Relógio injetável, para o teste da marca d'água não depender de espera real. */
  now?: () => number;
}

/**
 * Faz o drain de `dashboard_event` por cursor e empurra para o transporte.
 *
 * É o outro lado do NOTIFY sem payload (documento técnico, seção 10.1): a
 * notificação não traz nada, só chama `drainNow()`. Cursor, leitura e dedup
 * ficam aqui, então uma notificação perdida ou coalescida não dessincroniza
 * nada — o tique de segurança do `start()` reconcilia no pior caso.
 *
 * ## A marca d'água
 *
 * `sequence` é atribuída na inserção, não no commit. Duas transações
 * concorrentes podem commitar fora de ordem, e um drain no meio dessa janela
 * veria a 8 sem a 7. Adiantar o cursor ali pularia a 7 para sempre, porque o
 * drain seguinte só pede o que vem **depois** do cursor.
 *
 * Por isso o cursor **só avança até a primeira lacuna**: o que chega acima dela
 * fica retido, e é entregue quando o buraco fecha. Uma lacuna que não fecha em
 * {@link GAP_GRACE_MS} é tratada como permanente — `bigserial` não devolve o
 * número de uma transação abortada — e o retido é liberado em ordem.
 *
 * A paginação é feita por um cursor **local** de leitura, e não pelo cursor de
 * entrega: sem essa separação, um drain que retém tudo releria a mesma página
 * para sempre.
 */
export class DashboardEventPoller<TEvent extends SequencedEvent> {
  private readonly source: DashboardEventSource<TEvent>;
  private readonly transport: PollerTransport<TEvent>;
  private readonly limit: number;
  private readonly logger: EventsLogger | undefined;

  private readonly gapGraceMs: number;
  private readonly now: () => number;

  private cursorValue: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private redrainRequested = false;
  private consecutiveFailures = 0;
  /** Eventos lidos acima da primeira lacuna, esperando o buraco fechar. */
  private readonly held = new Map<number, TEvent>();
  /** Quando a lacuna atual apareceu. `null` quando não há nada retido. */
  private gapSince: number | null = null;

  constructor(options: DashboardEventPollerOptions<TEvent>) {
    this.source = options.source;
    this.transport = options.transport;
    this.limit = options.limit ?? DRAIN_LIMIT;
    this.logger = options.logger;
    this.cursorValue = options.startCursor ?? 0;
    this.gapGraceMs = options.gapGraceMs ?? GAP_GRACE_MS;
    this.now = options.now ?? Date.now;
  }

  /** Último `sequence` já empurrado para o transporte. */
  get cursor(): number {
    return this.cursorValue;
  }

  /** Quantos eventos estão retidos por uma lacuna. Zero é o caso normal. */
  get heldCount(): number {
    return this.held.size;
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
    // O cursor de leitura é local, e não o de entrega: com a marca d'água o
    // cursor de entrega pode não avançar, e paginar por ele releria a mesma
    // página até o fim dos tempos.
    let readCursor = this.cursorValue;

    // Pagina até esvaziar: um cliente que ficou fora por muito tempo pode ter
    // mais eventos atrasados do que o limite de uma leitura.
    for (;;) {
      const rows = await this.source.listSince(readCursor, this.limit);
      if (rows.length === 0) break;

      for (const event of rows) {
        // Dedup: o cursor é a única memória necessária. Uma linha repetida numa
        // leitura sobreposta não passa daqui.
        if (event.sequence <= this.cursorValue) continue;
        this.held.set(event.sequence, event);
        if (event.sequence > readCursor) readCursor = event.sequence;
      }

      // Entregar página a página, e não só no fim, mantém a latência do caminho
      // normal (sem lacuna nenhuma) igual à de antes da marca d'água.
      this.release();

      if (rows.length < this.limit) break;
      // Um backlog longo com uma lacuna no começo prenderia a tabela inteira na
      // memória. Uma página de retidos é teto suficiente: quando a lacuna
      // fechar, o drain seguinte continua de onde este parou.
      if (this.held.size >= this.limit) break;
    }

    // Uma lacuna que já passou do prazo precisa ser abandonada mesmo num drain
    // que não leu nada novo: é o tique de segurança que desatola o stream
    // quando o número que falta nunca vai existir.
    if (this.held.size > 0) this.release();
  }

  /**
   * Entrega o que está contíguo ao cursor e decide o que fazer com o resto.
   *
   * Enquanto o próximo número existir entre os retidos, ele sai e o cursor
   * avança. O que sobra é o que está acima de uma lacuna: fica onde está até o
   * buraco fechar, ou até o prazo dizer que ele nunca vai fechar.
   */
  private release(): void {
    for (;;) {
      const next = this.cursorValue + 1;
      const event = this.held.get(next);
      if (event === undefined) break;
      this.held.delete(next);
      this.transport.broadcast(event);
      this.cursorValue = next;
    }

    if (this.held.size === 0) {
      this.gapSince = null;
      return;
    }

    const agora = this.now();
    if (this.gapSince === null) {
      this.gapSince = agora;
      return;
    }
    if (agora - this.gapSince < this.gapGraceMs) return;

    // A lacuna não fechou no prazo: ela é permanente. Um `ROLLBACK` numa
    // sequência do PostgreSQL queima o número, e continuar esperando por ele
    // deixaria o stream parado para sempre.
    const presos = [...this.held.keys()].sort((esquerda, direita) => esquerda - direita);
    this.logger?.warn?.(
      { from: this.cursorValue + 1, to: presos[presos.length - 1], held: presos.length },
      "dashboard_poller_gap_abandoned",
    );

    for (const sequence of presos) {
      const event = this.held.get(sequence);
      /* c8 ignore next -- a chave veio do próprio mapa. */
      if (event === undefined) continue;
      this.held.delete(sequence);
      this.transport.broadcast(event);
      this.cursorValue = sequence;
    }
    this.gapSince = null;
  }
}
