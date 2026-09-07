import { describe, expect, it, vi } from "vitest";

import {
  DashboardEventPoller,
  type DashboardEventSource,
  type PollerTransport,
} from "./dashboard-event-poller.js";
import { evento, type FakeEvent } from "./testing.js";

/** Fonte em memória, com a mesma semântica de `listDashboardEventsSince`. */
class FonteEmMemoria implements DashboardEventSource<FakeEvent> {
  readonly eventos: FakeEvent[] = [];
  chamadas = 0;
  falharProximas = 0;

  adicionar(...sequences: number[]): void {
    for (const sequence of sequences) this.eventos.push(evento(sequence));
  }

  async listSince(afterSequence: number, limit: number): Promise<FakeEvent[]> {
    this.chamadas += 1;
    if (this.falharProximas > 0) {
      this.falharProximas -= 1;
      throw new Error("banco fora");
    }
    return this.eventos
      .filter((event) => event.sequence > afterSequence)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit);
  }
}

class TransporteFalso implements PollerTransport<FakeEvent> {
  readonly emitidos: FakeEvent[] = [];
  comAssinantes = true;

  hasSubscribers(): boolean {
    return this.comAssinantes;
  }

  broadcast(event: FakeEvent): void {
    this.emitidos.push(event);
  }
}

function montar(limit = 500) {
  const source = new FonteEmMemoria();
  const transport = new TransporteFalso();
  const poller = new DashboardEventPoller<FakeEvent>({ source, transport, limit });
  return { source, transport, poller };
}

describe("drain por cursor", () => {
  it("emite o que existe e para o cursor no último", async () => {
    const { source, transport, poller } = montar();
    source.adicionar(1, 2, 3);

    await poller.drainNow();

    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(poller.cursor).toBe(3);
  });

  it("não repete o que já emitiu", async () => {
    const { source, transport, poller } = montar();
    source.adicionar(1, 2);

    await poller.drainNow();
    await poller.drainNow();
    source.adicionar(3);
    await poller.drainNow();

    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("deduplica linha repetida numa leitura sobreposta", async () => {
    const source: DashboardEventSource<FakeEvent> = {
      // Uma fonte mal comportada devolve o cursor de novo. O poller filtra.
      listSince: async (afterSequence) =>
        [evento(afterSequence), evento(afterSequence + 1)].filter(
          (event) => event.sequence <= 2 && event.sequence > 0,
        ),
    };
    const transport = new TransporteFalso();
    const poller = new DashboardEventPoller<FakeEvent>({ source, transport });

    await poller.drainNow();
    await poller.drainNow();

    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("pagina até esvaziar quando há mais atraso do que o limite", async () => {
    const { source, transport, poller } = montar(2);
    source.adicionar(1, 2, 3, 4, 5);

    await poller.drainNow();

    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(poller.cursor).toBe(5);
  });

  it("não drena, nem adianta o cursor, sem ninguém conectado", async () => {
    const { source, transport, poller } = montar();
    transport.comAssinantes = false;
    source.adicionar(1, 2);

    await poller.drainNow();

    expect(source.chamadas).toBe(0);
    expect(poller.cursor).toBe(0);

    // Quem conectar depois recebe tudo: o cursor não pulou os eventos da janela.
    transport.comAssinantes = true;
    await poller.drainNow();
    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("uma rajada de notificações vira um drain final só", async () => {
    const { source, transport, poller } = montar();
    source.adicionar(1);

    const emVoo = poller.drainNow();
    source.adicionar(2, 3);
    // Estes três chegam com um drain já rodando: são absorvidos por ele.
    await Promise.all([emVoo, poller.drainNow(), poller.drainNow(), poller.drainNow()]);

    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("sobrevive a uma falha e continua do cursor", async () => {
    const { source, transport, poller } = montar();
    const logger = { warn: vi.fn(), error: vi.fn() };
    const comLog = new DashboardEventPoller<FakeEvent>({ source, transport, logger });

    source.adicionar(1);
    source.falharProximas = 1;
    await comLog.drainNow();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(comLog.cursor).toBe(0);

    await comLog.drainNow();
    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1]);
    expect(poller.cursor).toBe(0);
  });

  it("sobe de warn para error depois de cinco falhas seguidas", async () => {
    const { source, transport } = montar();
    const logger = { warn: vi.fn(), error: vi.fn() };
    const poller = new DashboardEventPoller<FakeEvent>({ source, transport, logger });

    source.falharProximas = 5;
    for (let i = 0; i < 5; i += 1) await poller.drainNow();

    expect(logger.warn).toHaveBeenCalledTimes(4);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("começa do cursor inicial quando o processo já sobe com histórico", async () => {
    const source = new FonteEmMemoria();
    const transport = new TransporteFalso();
    source.adicionar(1, 2, 3);

    const poller = new DashboardEventPoller<FakeEvent>({ source, transport, startCursor: 2 });
    await poller.drainNow();

    expect(transport.emitidos.map((event) => event.sequence)).toEqual([3]);
  });
});

describe("marca d'água", () => {
  function montarComRelogio(gapGraceMs = 1_000) {
    const source = new FonteEmMemoria();
    const transport = new TransporteFalso();
    let agora = 0;
    const poller = new DashboardEventPoller<FakeEvent>({
      source,
      transport,
      gapGraceMs,
      now: () => agora,
    });
    return {
      source,
      transport,
      poller,
      avancar: (ms: number) => {
        agora += ms;
      },
    };
  }

  it("segura o cursor na primeira lacuna", async () => {
    const { source, transport, poller } = montarComRelogio();
    // A transação da 3 ainda não commitou; a 4 e a 5 chegaram antes dela.
    source.adicionar(1, 2, 4, 5);

    await poller.drainNow();

    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 2]);
    expect(poller.cursor).toBe(2);
    expect(poller.heldCount).toBe(2);
  });

  it("entrega em ordem quando a lacuna fecha", async () => {
    const { source, transport, poller } = montarComRelogio();
    source.adicionar(1, 2, 4, 5);
    await poller.drainNow();

    source.adicionar(3);
    await poller.drainNow();

    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(poller.cursor).toBe(5);
    expect(poller.heldCount).toBe(0);
  });

  it("desiste da lacuna depois do prazo e não trava o stream", async () => {
    const { source, transport, poller, avancar } = montarComRelogio(1_000);
    source.adicionar(1, 4, 5);

    await poller.drainNow();
    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1]);

    // As transações de 2 e 3 sofreram ROLLBACK: os números foram queimados e
    // esperar por eles pararia a tela para sempre.
    avancar(1_500);
    await poller.drainNow();

    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 4, 5]);
    expect(poller.cursor).toBe(5);
  });

  it("um evento que chega fora de ordem numa leitura sozinha também espera", async () => {
    const { source, transport, poller } = montarComRelogio();
    source.adicionar(2);

    await poller.drainNow();
    expect(transport.emitidos).toHaveLength(0);

    source.adicionar(1);
    await poller.drainNow();
    expect(transport.emitidos.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("não relê a mesma página para sempre quando tudo está retido", async () => {
    const { source, poller } = montarComRelogio();
    source.adicionar(2, 3);

    await poller.drainNow();
    const primeiras = source.chamadas;
    await poller.drainNow();

    // Duas leituras por drain no máximo: a que traz a página e a que confirma
    // que não veio mais nada. Um laço por cursor de entrega não terminaria.
    expect(source.chamadas - primeiras).toBeLessThanOrEqual(2);
  });
});

describe("tique de segurança", () => {
  it("drena sozinho no intervalo e para no stop", async () => {
    vi.useFakeTimers();
    try {
      const { source, transport, poller } = montar();
      source.adicionar(1);

      poller.start(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(transport.emitidos.map((event) => event.sequence)).toEqual([1]);

      poller.stop();
      source.adicionar(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(transport.emitidos.map((event) => event.sequence)).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
