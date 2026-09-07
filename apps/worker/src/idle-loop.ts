export interface IdleLoopOptions {
  intervalMs: number;
  /** Executado a cada tick. Um erro aqui não derruba o laço. */
  onTick: (tick: number) => Promise<void> | void;
  onError?: (error: unknown, tick: number) => void;
}

export interface IdleLoop {
  /** Sinaliza parada e resolve quando o tick em andamento termina. */
  stop: () => Promise<void>;
  /** Promessa que resolve quando o laço realmente parou. */
  readonly finished: Promise<void>;
}

/**
 * Laço ocioso do Worker.
 *
 * Na Fase 0 só registra que o processo está vivo. Na Fase 2 vira o polling
 * transacional da fila (`SELECT ... FOR UPDATE SKIP LOCKED`).
 *
 * A espera entre ticks é interrompível: o shutdown não precisa aguardar o
 * intervalo inteiro para acontecer.
 */
export function startIdleLoop(options: IdleLoopOptions): IdleLoop {
  let stopping = false;
  let wake: (() => void) | undefined;

  async function sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined;
        resolve();
      }, ms);

      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
    });
  }

  const finished = (async () => {
    let tick = 0;

    while (!stopping) {
      tick += 1;
      try {
        await options.onTick(tick);
      } catch (error) {
        options.onError?.(error, tick);
      }

      if (stopping) break;
      await sleep(options.intervalMs);
    }
  })();

  return {
    finished,
    stop: async () => {
      stopping = true;
      wake?.();
      await finished;
    },
  };
}
