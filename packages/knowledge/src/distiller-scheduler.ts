// Adapted from TencentDB Agent Memory — MemoryCore/src/utils/pipeline-manager.ts@3efcd31
// (gatilhos de L1 e L2) e MemoryCore/src/utils/managed-timer.ts@3efcd31 (`tryAdvanceTo`)
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: só a lógica de lote, ociosidade e timer descendente veio; o
// `setTimeout`, o `ManagedTimer`, as filas seriais e o checkpoint em disco não.
// A sessão de chat virou o Project; o "timer de ociosidade reiniciável" do L1
// virou a espera depois do último candidato, e o "timer só para baixo" do L2
// virou o intervalo máximo entre lotes, que uma chegada nunca adia e um pedido
// explícito adianta para agora. O scheduler não tem relógio próprio: quem o
// tem é o laço do Worker, que pergunta `due(now)` a cada tique — é o que o
// torna testável sem esperar. Mensagens em português.

import type { DistillationTrigger } from "@dungeon-master/contracts";

export interface DistillerSchedulerOptions {
  /** Espera depois do último candidato antes de destilar. Debounce reiniciável. */
  readonly idleMs: number;
  /** Intervalo máximo entre a chegada de um candidato e o lote. Só anda para baixo. */
  readonly everyMs: number;
}

interface ProjectSchedule {
  /** Reiniciado a cada candidato: `now + idleMs`. */
  idleDueAt: number | null;
  /** Armado na primeira chegada: `now + everyMs`. Nunca é adiado. */
  periodicDueAt: number | null;
  /** Um pedido explícito: vence qualquer timer. */
  requestedAt: number | null;
  running: boolean;
  /** Chegou candidato enquanto o lote rodava: reagendar ao terminar. */
  arrivedWhileRunning: boolean;
}

export interface DueProject {
  readonly projectId: string;
  readonly trigger: DistillationTrigger;
}

export interface ProjectScheduleSnapshot {
  readonly projectId: string;
  readonly idleDueAt: number | null;
  readonly periodicDueAt: number | null;
  readonly requestedAt: number | null;
  readonly running: boolean;
}

/**
 * Decide **quando** cada Project é destilado. Não decide o quê: isso é do
 * Distiller.
 *
 * Três gatilhos por Project, e o primeiro a vencer dispara o lote:
 *
 * - **Ociosidade** (`IDLE`): `idleMs` depois do último candidato. Cada
 *   chegada reinicia a contagem, então uma Expedição que grava três
 *   candidatos em sequência produz um lote, e não três.
 * - **Timer** (`TIMER`): `everyMs` depois da primeira chegada. Só anda para
 *   baixo — uma chegada nova nunca o adia —, e é o que garante que um Project
 *   com candidatos chegando sem parar ainda é destilado.
 * - **Pedido** (`MANUAL`/`NOTIFY`): a API, a CLI ou o canal do banco pedem
 *   agora. Vence os dois timers.
 *
 * Um Project em lote não é agendado de novo até terminar; o que chegar
 * durante o lote reinicia a ociosidade quando ele acabar. Um lote que bateu
 * no teto e deixou candidatos volta para a fila na hora.
 */
export class DistillerScheduler {
  private readonly projects = new Map<string, ProjectSchedule>();
  private idleMs: number;
  private everyMs: number;

  constructor(options: DistillerSchedulerOptions) {
    this.idleMs = validarIntervalo("idleMs", options.idleMs);
    this.everyMs = validarIntervalo("everyMs", options.everyMs);
  }

  /**
   * Troca o intervalo máximo. Só para baixo nos timers já armados: um
   * intervalo menor adianta o que estava marcado; um maior vale só para o
   * próximo Project que chegar, porque adiar um lote prometido seria a
   * mesma coisa que perdê-lo por um tique.
   */
  setEveryMs(everyMs: number, now: number): void {
    this.everyMs = validarIntervalo("everyMs", everyMs);
    for (const state of this.projects.values()) {
      if (state.periodicDueAt !== null) {
        state.periodicDueAt = Math.min(state.periodicDueAt, now + this.everyMs);
      }
    }
  }

  setIdleMs(idleMs: number): void {
    this.idleMs = validarIntervalo("idleMs", idleMs);
  }

  /** Um candidato chegou (ou já existia, na partida do Worker). */
  notifyCandidate(projectId: string, now: number): void {
    const state = this.estadoDe(projectId);
    if (state.running) {
      state.arrivedWhileRunning = true;
      return;
    }
    state.idleDueAt = now + this.idleMs;
    state.periodicDueAt =
      state.periodicDueAt === null
        ? now + this.everyMs
        : Math.min(state.periodicDueAt, now + this.everyMs);
  }

  /** Um pedido explícito: destilar agora. */
  requestNow(projectId: string, now: number): void {
    const state = this.estadoDe(projectId);
    if (state.running) {
      state.arrivedWhileRunning = true;
      return;
    }
    state.requestedAt = now;
  }

  /** Os Projects cujo lote venceu, com o gatilho que venceu. Nada de efeito colateral. */
  due(now: number): DueProject[] {
    const vencidos: DueProject[] = [];
    for (const [projectId, state] of this.projects) {
      if (state.running) continue;
      const trigger = this.gatilhoVencido(state, now);
      if (trigger !== null) vencidos.push({ projectId, trigger });
    }
    return vencidos;
  }

  /** O lote começou: os timers do Project saem de cena até ele terminar. */
  markStarted(projectId: string): void {
    const state = this.estadoDe(projectId);
    state.running = true;
    state.idleDueAt = null;
    state.periodicDueAt = null;
    state.requestedAt = null;
    state.arrivedWhileRunning = false;
  }

  /**
   * O lote terminou.
   *
   * `pendingLeft` é o lote que bateu no teto: o resto volta para a fila
   * agora, sem esperar a ociosidade. O que chegou durante o lote reinicia a
   * espera normal. Sem nada dos dois, o Project sai da agenda.
   */
  markFinished(projectId: string, input: { pendingLeft: boolean }, now: number): void {
    const state = this.estadoDe(projectId);
    state.running = false;
    if (input.pendingLeft) {
      state.requestedAt = now;
      state.arrivedWhileRunning = false;
      return;
    }
    if (state.arrivedWhileRunning) {
      state.arrivedWhileRunning = false;
      this.notifyCandidate(projectId, now);
      return;
    }
    this.projects.delete(projectId);
  }

  /** O próximo instante em que algo vence, para o laço dormir até lá. `null` sem agenda. */
  nextDueAt(): number | null {
    let proximo: number | null = null;
    for (const state of this.projects.values()) {
      if (state.running) continue;
      for (const at of [state.idleDueAt, state.periodicDueAt, state.requestedAt]) {
        if (at !== null && (proximo === null || at < proximo)) proximo = at;
      }
    }
    return proximo;
  }

  snapshot(): ProjectScheduleSnapshot[] {
    return [...this.projects.entries()].map(([projectId, state]) => ({
      projectId,
      idleDueAt: state.idleDueAt,
      periodicDueAt: state.periodicDueAt,
      requestedAt: state.requestedAt,
      running: state.running,
    }));
  }

  private gatilhoVencido(state: ProjectSchedule, now: number): DistillationTrigger | null {
    if (state.requestedAt !== null && state.requestedAt <= now) return "MANUAL";
    // Entre os dois timers vence o que marcou o instante mais cedo: é ele que
    // explica por que o lote saiu agora.
    const idle = state.idleDueAt !== null && state.idleDueAt <= now ? state.idleDueAt : null;
    const periodic =
      state.periodicDueAt !== null && state.periodicDueAt <= now ? state.periodicDueAt : null;
    if (idle === null && periodic === null) return null;
    if (idle !== null && (periodic === null || idle <= periodic)) return "IDLE";
    return "TIMER";
  }

  private estadoDe(projectId: string): ProjectSchedule {
    let state = this.projects.get(projectId);
    if (state === undefined) {
      state = {
        idleDueAt: null,
        periodicDueAt: null,
        requestedAt: null,
        running: false,
        arrivedWhileRunning: false,
      };
      this.projects.set(projectId, state);
    }
    return state;
  }
}

function validarIntervalo(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} precisa ser um número finito não negativo; recebi ${String(value)}.`);
  }
  return value;
}
