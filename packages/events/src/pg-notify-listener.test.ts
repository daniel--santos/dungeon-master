import { describe, expect, it, vi } from "vitest";

import { type Notifier, PgNotifyListener, type Unlisten } from "./pg-notify-listener.js";

const CANAL = "dm_dashboard_event";

class NotificadorFalso implements Notifier {
  tentativas = 0;
  desassinaturas = 0;
  falharProximas = 0;
  private notificar: ((payload: string) => void) | null = null;
  private falhar: ((error: Error) => void) | null = null;

  async listen(
    channel: string,
    onNotify: (payload: string) => void,
    onError: (error: Error) => void,
  ): Promise<Unlisten> {
    this.tentativas += 1;
    if (this.falharProximas > 0) {
      this.falharProximas -= 1;
      throw new Error(`sem conexão para ${channel}`);
    }
    this.notificar = onNotify;
    this.falhar = onError;
    return () => {
      this.desassinaturas += 1;
      this.notificar = null;
    };
  }

  /** Simula um `NOTIFY` chegando do PostgreSQL, sempre sem payload. */
  emitir(): void {
    this.notificar?.("");
  }

  /** Simula a conexão dedicada morrendo. */
  derrubar(): void {
    this.falhar?.(new Error("conexão caiu"));
  }
}

function montar(options: { initialBackoffMs?: number } = {}) {
  const notifier = new NotificadorFalso();
  const drainNow = vi.fn(async () => undefined);
  const listener = new PgNotifyListener({
    notifier,
    drainable: { drainNow },
    channel: CANAL,
    initialBackoffMs: options.initialBackoffMs ?? 10,
  });
  return { notifier, drainNow, listener };
}

describe("PgNotifyListener", () => {
  it("uma notificação só chama o drain; ela não carrega evento", async () => {
    const { notifier, drainNow, listener } = montar();

    await listener.start();
    expect(listener.listening).toBe(true);

    notifier.emitir();
    notifier.emitir();

    expect(drainNow).toHaveBeenCalledTimes(2);
    listener.stop();
  });

  it("dobra a espera a cada falha seguida", async () => {
    vi.useFakeTimers();
    try {
      const { notifier, listener } = montar({ initialBackoffMs: 100 });
      notifier.falharProximas = 2;

      await listener.start();
      expect(notifier.tentativas).toBe(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(notifier.tentativas).toBe(2);

      // A segunda falha seguida espera 200 ms, não 100.
      await vi.advanceTimersByTimeAsync(100);
      expect(notifier.tentativas).toBe(2);
      await vi.advanceTimersByTimeAsync(100);
      expect(notifier.tentativas).toBe(3);
      expect(listener.listening).toBe(true);

      listener.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uma conexão bem-sucedida zera o backoff", async () => {
    vi.useFakeTimers();
    try {
      const { notifier, listener } = montar({ initialBackoffMs: 100 });

      await listener.start();
      notifier.derrubar();
      await vi.advanceTimersByTimeAsync(100);
      expect(notifier.tentativas).toBe(2);

      // Reconectou; a próxima queda espera de novo os 100 ms iniciais, e não
      // 200: cada reconexão bem-sucedida devolve o backoff ao valor inicial.
      notifier.derrubar();
      await vi.advanceTimersByTimeAsync(100);
      expect(notifier.tentativas).toBe(3);

      listener.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tenta de novo quando o próprio LISTEN falha", async () => {
    vi.useFakeTimers();
    try {
      const { notifier, listener } = montar({ initialBackoffMs: 50 });
      notifier.falharProximas = 1;

      await listener.start();
      expect(listener.listening).toBe(false);

      await vi.advanceTimersByTimeAsync(50);
      expect(listener.listening).toBe(true);

      listener.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop desassina e não deixa reconexão pendente", async () => {
    vi.useFakeTimers();
    try {
      const { notifier, drainNow, listener } = montar({ initialBackoffMs: 50 });

      await listener.start();
      listener.stop();

      expect(notifier.desassinaturas).toBe(1);
      expect(listener.listening).toBe(false);

      notifier.derrubar();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(notifier.tentativas).toBe(1);
      expect(drainNow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop durante um listen em voo não deixa assinatura viva", async () => {
    let liberar: ((unlisten: Unlisten) => void) | undefined;
    let desassinou = false;

    const notifier: Notifier = {
      listen: async () =>
        new Promise<Unlisten>((resolve) => {
          liberar = resolve;
        }),
    };
    const listener = new PgNotifyListener({
      notifier,
      drainable: { drainNow: async () => undefined },
      channel: CANAL,
    });

    const emVoo = listener.start();
    listener.stop();
    liberar?.(() => {
      desassinou = true;
    });
    await emVoo;

    expect(desassinou).toBe(true);
    expect(listener.listening).toBe(false);
  });
});
