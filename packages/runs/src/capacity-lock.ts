// Adapted from Archon — packages/core/src/utils/conversation-lock.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: `conversationId` virou `key`, uma chave de recurso qualquer (na
// prática o caminho do workspace), e a fila por conversa virou fila por chave;
// o logger de `@archon/paths` virou um contrato opcional; `acquireLock` deixou
// de ser fire-and-forget puro e passou a devolver também a promessa da
// execução, para o worker conseguir esperar o próprio trabalho sem espiar o
// estado interno; entrou `drain()`, pelo mesmo motivo, no desligamento;
// entraram o teto de fila e o descarte explícito, para uma rajada não crescer a
// fila sem limite. Mensagens e comentários em português.

import type { RunsLogger } from "./logger.js";

/**
 * Teto de execuções concorrentes, com ordenação por chave de recurso.
 *
 * Duas garantias, e nada mais:
 *
 * 1. **Nunca mais de `maxConcurrent` execuções ao mesmo tempo.** É o teto de
 *    capacidade da Fase 2B: cada Run é um processo de agente de verdade, com
 *    CPU e memória de verdade, e sem teto uma fila cheia derruba a máquina.
 * 2. **Nunca duas execuções da mesma chave ao mesmo tempo.** A chave é o
 *    recurso disputado — na prática o caminho do checkout —, e a trava
 *    sequencial por chave é o par em memória da trava por caminho que vive no
 *    PostgreSQL. As duas coexistem de propósito: a do banco sobrevive a um
 *    restart e coordena processos diferentes; esta ordena o que já está dentro
 *    de um worker sem custar uma ida ao banco por tentativa.
 *
 * **Não bloqueia.** `acquireLock` responde na hora dizendo se a execução
 * começou ou entrou na fila, e por quê. O trabalho corre em segundo plano; quem
 * quiser esperar tem a promessa `completion`.
 */

/** Por que a execução não começou agora. */
export type LockStatus = "started" | "queued-key" | "queued-capacity" | "rejected-queue-full";

export interface LockAcquisitionResult {
  readonly status: LockStatus;
  /**
   * Resolve quando **esta** execução terminar.
   *
   * Existe para o worker conseguir esperar o próprio trabalho sem espiar o
   * estado interno da trava. Nunca rejeita: um erro do handler é logado e
   * absorvido, porque derrubar quem chamou não desfaria o trabalho já feito.
   * Em `rejected-queue-full` resolve na hora.
   */
  readonly completion: Promise<void>;
}

interface QueuedWork {
  readonly handler: () => Promise<void>;
  readonly queuedAt: number;
  readonly settle: () => void;
}

export interface CapacityLockOptions {
  /** Máximo de execuções simultâneas. Padrão: 2. */
  readonly maxConcurrent?: number;
  /**
   * Máximo de trabalhos esperando na fila, somando todas as chaves.
   *
   * O original não tem teto: uma rajada faz a fila crescer até a memória
   * acabar. Aqui o excedente é recusado na hora, com `rejected-queue-full`, e
   * quem chamou decide o que fazer — no worker, deixar o Run em `QUEUED` no
   * banco, que é onde ele já está e de onde outro ciclo o reclama.
   */
  readonly maxQueued?: number;
  readonly logger?: RunsLogger;
  /** Relógio injetável, para teste. */
  readonly now?: () => number;
}

/** Padrão conservador: duas execuções de agente ao mesmo tempo. */
export const DEFAULT_MAX_CONCURRENT = 2;

export const DEFAULT_MAX_QUEUED = 100;

export interface CapacityLockStats {
  readonly active: number;
  readonly queuedTotal: number;
  readonly queuedByKey: ReadonlyArray<{ readonly key: string; readonly queued: number }>;
  readonly maxConcurrent: number;
  readonly activeKeys: readonly string[];
}

export class CapacityLock {
  private readonly active = new Map<string, Promise<void>>();
  private readonly queues = new Map<string, QueuedWork[]>();
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly logger: RunsLogger | undefined;
  private readonly now: () => number;

  constructor(options: CapacityLockOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;

    if (this.maxConcurrent < 1) {
      throw new Error(`maxConcurrent precisa ser >= 1; recebi ${String(this.maxConcurrent)}.`);
    }

    this.logger?.info?.(
      { maxConcurrent: this.maxConcurrent, maxQueued: this.maxQueued },
      "capacity_lock_initialized",
    );
  }

  /**
   * Pede a vez para a chave e executa quando puder.
   *
   * Devolve na hora. `status` diz o que aconteceu com o pedido, e é isso que
   * a interface mostra: "em execução" e "na fila porque o repositório está
   * ocupado" são coisas diferentes de "na fila porque o teto foi atingido".
   */
  acquireLock(key: string, handler: () => Promise<void>): LockAcquisitionResult {
    if (this.active.has(key)) {
      return this.enqueue(key, handler, "queued-key");
    }

    if (this.active.size >= this.maxConcurrent) {
      this.logger?.info?.(
        { key, maxConcurrent: this.maxConcurrent },
        "capacity_lock_queued_at_capacity",
      );
      return this.enqueue(key, handler, "queued-capacity");
    }

    return { status: "started", completion: this.start(key, handler) };
  }

  /** Execuções em curso agora. */
  get activeCount(): number {
    return this.active.size;
  }

  /** Trabalhos esperando, somando todas as chaves. */
  get queuedCount(): number {
    let total = 0;
    for (const queue of this.queues.values()) total += queue.length;
    return total;
  }

  /** O estado completo, para log e para a tela de diagnóstico. */
  getStats(): CapacityLockStats {
    return {
      active: this.active.size,
      queuedTotal: this.queuedCount,
      queuedByKey: [...this.queues.entries()].map(([key, queue]) => ({
        key,
        queued: queue.length,
      })),
      maxConcurrent: this.maxConcurrent,
      activeKeys: [...this.active.keys()],
    };
  }

  /**
   * Espera tudo que está em curso **e** na fila terminar.
   *
   * É o desligamento limpo do worker: sem isto, o processo sairia no meio de
   * execuções que já começaram, e o Run ficaria `RUNNING` no banco sem ninguém
   * para escrever o status terminal.
   */
  async drain(): Promise<void> {
    while (this.active.size > 0 || this.queuedCount > 0) {
      await Promise.all([...this.active.values()]);
    }
  }

  private enqueue(
    key: string,
    handler: () => Promise<void>,
    status: "queued-key" | "queued-capacity",
  ): LockAcquisitionResult {
    if (this.queuedCount >= this.maxQueued) {
      this.logger?.warn?.({ key, maxQueued: this.maxQueued }, "capacity_lock_queue_full");
      return { status: "rejected-queue-full", completion: Promise.resolve() };
    }

    const queue = this.queues.get(key) ?? [];
    if (!this.queues.has(key)) this.queues.set(key, queue);

    let settle!: () => void;
    const completion = new Promise<void>((resolve) => {
      settle = resolve;
    });

    queue.push({ handler, queuedAt: this.now(), settle });

    this.logger?.debug?.({ key, queueLength: queue.length }, "capacity_lock_queued");

    return { status, completion };
  }

  private start(key: string, handler: () => Promise<void>, settle?: () => void): Promise<void> {
    this.logger?.debug?.(
      { key, active: this.active.size + 1, queued: this.queuedCount },
      "capacity_lock_started",
    );

    // A promessa entra no mapa **antes** de qualquer `await`, senão duas
    // chamadas no mesmo turno veriam a chave livre e as duas começariam.
    const promise = handler()
      .catch((error: unknown) => {
        // Um handler que estoura não pode derrubar quem chamou nem travar a
        // chave: o erro é do trabalho, e quem o trata é o próprio worker, pelo
        // status do Run.
        this.logger?.error?.({ err: error, key }, "capacity_lock_handler_error");
      })
      .finally(() => {
        this.active.delete(key);
        settle?.();

        this.logger?.debug?.(
          { key, active: this.active.size, queued: this.queuedCount },
          "capacity_lock_completed",
        );

        // Primeiro a fila da própria chave, que precisa manter a ordem; depois
        // qualquer outra, porque a capacidade que acabou de sobrar serve para
        // todo mundo.
        this.pumpKey(key);
        this.pumpAny();
      });

    this.active.set(key, promise);
    return promise;
  }

  /** Começa o próximo trabalho desta chave, se houver e se a chave estiver livre. */
  private pumpKey(key: string): void {
    if (this.active.has(key)) return;
    if (this.active.size >= this.maxConcurrent) return;

    const queue = this.queues.get(key);
    if (queue === undefined || queue.length === 0) {
      this.queues.delete(key);
      return;
    }

    const next = queue.shift();
    if (next === undefined) return;
    if (queue.length === 0) this.queues.delete(key);

    this.logger?.debug?.({ key, waitMs: this.now() - next.queuedAt }, "capacity_lock_dequeued");

    this.start(key, next.handler, next.settle);
  }

  /** Aproveita a capacidade que sobrou para uma chave qualquer que esteja esperando. */
  private pumpAny(): void {
    for (const [key, queue] of this.queues) {
      if (this.active.size >= this.maxConcurrent) return;
      if (queue.length === 0 || this.active.has(key)) continue;
      this.pumpKey(key);
    }
  }
}
