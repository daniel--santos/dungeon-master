import { describe, expect, it, vi } from "vitest";

import {
  assertReplayBufferInvariant,
  EVENT_BUFFER_TTL_MS,
  RECONNECT_GRACE_MS,
  SseTransport,
} from "./sse-transport.js";
import { evento, type FakeEvent, FakeWriter } from "./testing.js";

function criarTransporte(
  options: Partial<ConstructorParameters<typeof SseTransport<FakeEvent>>[0]> = {},
) {
  return new SseTransport<FakeEvent>({
    serialize: (event) => JSON.stringify(event),
    heartbeatIntervalMs: 0,
    ...options,
  });
}

describe("invariante do buffer de replay", () => {
  it("as constantes do módulo satisfazem o invariante", () => {
    expect(EVENT_BUFFER_TTL_MS).toBeGreaterThanOrEqual(RECONNECT_GRACE_MS);
    expect(() =>
      assertReplayBufferInvariant(EVENT_BUFFER_TTL_MS, RECONNECT_GRACE_MS),
    ).not.toThrow();
  });

  it("lança quando o TTL é menor que a janela de graça", () => {
    expect(() => assertReplayBufferInvariant(1_000, 5_000)).toThrow(/precisa ser >=/);
  });

  it("o construtor não deixa burlar o invariante", () => {
    expect(() => criarTransporte({ bufferTtlMs: 1_000, graceMs: 5_000 })).toThrow(/precisa ser >=/);
    expect(() => criarTransporte({ bufferTtlMs: 5_000, graceMs: 5_000 })).not.toThrow();
  });
});

describe("entrega e deduplicação", () => {
  it("entrega ao vivo com a sequence no id do evento", async () => {
    const transport = criarTransporte();
    const writer = new FakeWriter();

    const subscription = transport.subscribe({ writer, since: 0 });
    await subscription.goLive();

    transport.broadcast(evento(1));
    transport.broadcast(evento(2));
    await vi.waitFor(() => expect(writer.sequences).toEqual([1, 2]));

    expect(writer.frames[0]!.data).toBe(JSON.stringify({ sequence: 1, type: "system.ping" }));
    expect(subscription.cursor).toBe(2);
  });

  it("ignora o que o cliente já tem, pelo cursor", async () => {
    const transport = criarTransporte();
    const writer = new FakeWriter();

    const subscription = transport.subscribe({ writer, since: 10 });
    await subscription.deliverAll([evento(8), evento(9), evento(10), evento(11)]);
    await subscription.goLive();

    expect(writer.sequences).toEqual([11]);
    expect(subscription.cursor).toBe(11);
  });

  it("não duplica um evento que chega durante o replay e também vem do banco", async () => {
    const transport = criarTransporte();
    const writer = new FakeWriter();

    const subscription = transport.subscribe({ writer, since: 0 });

    // O poller já emitiu o 3 enquanto a rota ainda lia o histórico do banco.
    transport.broadcast(evento(3));

    await subscription.deliverAll([evento(1), evento(2), evento(3)]);
    await subscription.goLive();

    expect(writer.sequences).toEqual([1, 2, 3]);
  });

  it("descarrega a fila do replay em ordem crescente", async () => {
    const transport = criarTransporte();
    const writer = new FakeWriter();

    const subscription = transport.subscribe({ writer, since: 0 });

    transport.broadcast(evento(5));
    transport.broadcast(evento(4));

    await subscription.deliverAll([evento(1)]);
    await subscription.goLive();

    expect(writer.sequences).toEqual([1, 4, 5]);
  });

  it("fecha e esquece a conexão quando a escrita falha", async () => {
    const transport = criarTransporte();
    const writer = new FakeWriter();

    const subscription = transport.subscribe({ writer, since: 0 });
    await subscription.goLive();

    writer.failNextWrite = new Error("socket morto");
    await subscription.deliver(evento(1));

    expect(subscription.closed).toBe(true);
    expect(writer.closed).toBe(true);
    expect(transport.subscriberCount).toBe(0);
    // O cursor não avança numa escrita que falhou: o cliente não viu o evento.
    expect(subscription.cursor).toBe(0);
  });

  it("entrega o mesmo evento a todas as conexões abertas", async () => {
    const transport = criarTransporte();
    const primeira = new FakeWriter();
    const segunda = new FakeWriter();

    await transport.subscribe({ writer: primeira, since: 0 }).goLive();
    await transport.subscribe({ writer: segunda, since: 7 }).goLive();

    transport.broadcast(evento(8));
    await vi.waitFor(() => {
      expect(primeira.sequences).toEqual([8]);
      expect(segunda.sequences).toEqual([8]);
    });
  });
});

describe("buffer de replay", () => {
  it("reenvia da memória o que aconteceu durante a janela de reconexão", async () => {
    const transport = criarTransporte();
    const primeira = new FakeWriter();

    const antes = transport.subscribe({ writer: primeira, since: 0 });
    await antes.goLive();
    transport.broadcast(evento(1));
    await vi.waitFor(() => expect(primeira.sequences).toEqual([1]));

    // O browser caiu; a janela de graça está correndo.
    await antes.close();
    transport.broadcast(evento(2));
    transport.broadcast(evento(3));

    const guardados = transport.replaySince(1);
    expect(guardados?.map((event) => event.sequence)).toEqual([2, 3]);

    const depois = new FakeWriter();
    const reconectado = transport.subscribe({ writer: depois, since: 1 });
    await reconectado.deliverAll(guardados ?? []);
    await reconectado.goLive();

    expect(depois.sequences).toEqual([2, 3]);
  });

  it("devolve null quando não dá para provar que cobre a faixa", () => {
    const transport = criarTransporte();

    // Buffer vazio: pode ser "nada aconteceu" ou "tudo expirou". Vai ao banco.
    expect(transport.replaySince(0)).toBeNull();

    transport.broadcast(evento(10));
    // Cliente parado no 4: o buffer começa no 10 e não sabe o que houve entre.
    expect(transport.replaySince(4)).toBeNull();
    // Cliente no 9: o 10 é o próximo, então a faixa está coberta.
    expect(transport.replaySince(9)?.map((event) => event.sequence)).toEqual([10]);
    // Cliente à frente do buffer: nada a reenviar, e isso é uma resposta.
    expect(transport.replaySince(10)).toEqual([]);
  });

  it("esquece o que passou do TTL", () => {
    let agora = 1_000_000;
    const transport = criarTransporte({
      bufferTtlMs: 5_000,
      graceMs: 1_000,
      now: () => agora,
    });

    transport.broadcast(evento(1));
    agora += 6_000;
    transport.broadcast(evento(2));

    expect(transport.replaySince(1)?.map((event) => event.sequence)).toEqual([2]);
    // O 1 expirou, então o buffer não consegue mais cobrir quem estava no zero.
    expect(transport.replaySince(0)).toBeNull();
  });

  it("descarta os mais antigos ao estourar o teto", () => {
    const transport = criarTransporte({ bufferMax: 3 });

    for (let sequence = 1; sequence <= 5; sequence += 1) {
      transport.broadcast(evento(sequence));
    }

    expect(transport.replaySince(2)?.map((event) => event.sequence)).toEqual([3, 4, 5]);
    expect(transport.replaySince(1)).toBeNull();
  });
});

describe("janela de graça", () => {
  it("continua 'com assinantes' durante a graça e avisa no fim", async () => {
    vi.useFakeTimers();
    try {
      const ocioso = vi.fn();
      const transport = criarTransporte({ graceMs: 100, bufferTtlMs: 100, onIdle: ocioso });
      const writer = new FakeWriter();

      const subscription = transport.subscribe({ writer, since: 0 });
      await subscription.goLive();
      expect(transport.hasSubscribers()).toBe(true);

      await subscription.close();
      // Sem ninguém conectado, mas dentro da graça: o poller continua drenando.
      expect(transport.hasSubscribers()).toBe(true);
      expect(ocioso).not.toHaveBeenCalled();

      vi.advanceTimersByTime(101);
      expect(transport.hasSubscribers()).toBe(false);
      expect(ocioso).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uma reconexão dentro da graça cancela o aviso de ocioso", async () => {
    vi.useFakeTimers();
    try {
      const ocioso = vi.fn();
      const transport = criarTransporte({ graceMs: 100, bufferTtlMs: 100, onIdle: ocioso });

      const primeira = transport.subscribe({ writer: new FakeWriter(), since: 0 });
      await primeira.goLive();
      await primeira.close();

      vi.advanceTimersByTime(50);
      const segunda = transport.subscribe({ writer: new FakeWriter(), since: 0 });
      await segunda.goLive();

      vi.advanceTimersByTime(500);
      expect(ocioso).not.toHaveBeenCalled();
      expect(transport.hasSubscribers()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("heartbeat", () => {
  it("manda comentário periódico e recolhe conexão morta", async () => {
    vi.useFakeTimers();
    try {
      const transport = criarTransporte({ heartbeatIntervalMs: 1_000 });
      const vivo = new FakeWriter();
      const morto = new FakeWriter();

      await transport.subscribe({ writer: vivo, since: 0 }).goLive();
      await transport.subscribe({ writer: morto, since: 0 }).goLive();
      transport.start();

      morto.closed = true;

      await vi.advanceTimersByTimeAsync(1_000);

      expect(vivo.comments).toEqual(["heartbeat"]);
      expect(transport.subscriberCount).toBe(1);

      await transport.stop();
      expect(vivo.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
