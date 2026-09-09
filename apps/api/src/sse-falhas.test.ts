import type { Run, RunEvent } from "@dungeon-master/contracts";
import { SseTransport } from "@dungeon-master/events";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { API_BASE_PATH } from "./config.js";
import type { Logger } from "./logger.js";
import { createSpecPorts, type RunStreamHandle } from "./ports.js";
import { SSE_FAILURE_DETAIL } from "./sse/failure.js";

/**
 * Uma falha durante o replay do SSE não pode virar um `200` mudo.
 *
 * O cenário é o do post-mortem #9: os headers `200 text/event-stream` já
 * saíram quando o handler vai ao banco, e o replay rejeita — banco fora por um
 * instante, pool esgotado, cursor fora da faixa da coluna. A porta inerte de
 * `createSpecPorts` faz exatamente isso: `listSince` lança. Não é preciso banco
 * nenhum para exercitar o buraco.
 */

interface Registro {
  readonly nivel: "info" | "error";
  readonly campos: Record<string, unknown>;
  readonly mensagem: string;
}

function loggerDeTeste(registros: Registro[]): Logger {
  const anotar =
    (nivel: Registro["nivel"]) =>
    (campos: unknown, mensagem?: string): void => {
      registros.push({
        nivel,
        campos: (campos ?? {}) as Record<string, unknown>,
        mensagem: mensagem ?? "",
      });
    };

  // Só `info` e `error` são chamados pelas rotas de stream; o resto do pino não
  // entra no caminho e um duplo completo seria ruído.
  return { info: anotar("info"), error: anotar("error") } as unknown as Logger;
}

/** Lê o stream inteiro até o servidor fechá-lo. */
async function corpoDoStream(response: Response, timeoutMs = 5_000): Promise<string> {
  const body = response.body;
  if (body === null) throw new Error("O stream veio sem corpo.");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const prazo = setTimeout(() => void reader.cancel(), timeoutMs);
  let texto = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      texto += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(prazo);
  }

  return texto;
}

function quadroDeErro(corpo: string): { error: string; detail: string; requestId?: string } {
  const quadro = corpo.split("\n\n").find((bloco) => bloco.includes("event: error"));
  if (quadro === undefined) throw new Error(`O stream não trouxe quadro de erro: ${corpo}`);

  const dados = quadro
    .split("\n")
    .filter((linha) => linha.startsWith("data: "))
    .map((linha) => linha.slice("data: ".length))
    .join("\n");

  return JSON.parse(dados) as { error: string; detail: string; requestId?: string };
}

describe(`GET ${API_BASE_PATH}/events/stream`, () => {
  it("uma falha no replay vira quadro de erro e log estruturado, e não um 200 mudo", async () => {
    const registros: Registro[] = [];
    const app = createApp({ ...createSpecPorts(), logger: loggerDeTeste(registros) });

    const response = await app.request(`${API_BASE_PATH}/events/stream`);
    expect(response.status).toBe(200);

    const corpo = await corpoDoStream(response);
    const quadro = quadroDeErro(corpo);

    expect(quadro.error).toBe("stream_failed");
    expect(quadro.detail).toBe(SSE_FAILURE_DETAIL);
    expect(quadro.requestId).toBeTruthy();

    const erro = registros.find((registro) => registro.nivel === "error");
    expect(erro?.mensagem).toBe("sse de dashboard falhou");
    expect(erro?.campos["requestId"]).toBe(quadro.requestId);
    expect(erro?.campos["err"]).toBeInstanceOf(Error);
  });

  it("um cursor grande demais na query cai para 0 em vez de descer ao banco", async () => {
    const pedidos: number[] = [];
    const spec = createSpecPorts();
    const app = createApp({
      ...spec,
      events: {
        ...spec.events,
        listSince: async (afterSequence) => {
          pedidos.push(afterSequence);
          return [];
        },
      },
    });

    // 19 dígitos: o `StreamQuerySchema` aceita (`.max(19)`), mas o valor não é
    // inteiro seguro e o `bigint` da coluna recusaria o parâmetro.
    const response = await app.request(`${API_BASE_PATH}/events/stream?since=9999999999999999999`);
    expect(response.status).toBe(200);

    // O replay drena e o handler fica preso em `whenClosed`; o que importa é o
    // cursor que chegou ao repositório, e ele já chegou.
    await corpoDoStream(response, 300);

    expect(pedidos[0]).toBe(0);
  });
});

describe(`GET ${API_BASE_PATH}/runs/{id}/events/stream`, () => {
  it("uma falha no replay vira quadro de erro e log estruturado", async () => {
    const registros: Registro[] = [];
    const spec = createSpecPorts();
    let fechado = false;

    const handle: RunStreamHandle = {
      transport: new SseTransport<RunEvent>({
        serialize: (event) => JSON.stringify(event),
        heartbeatIntervalMs: 0,
      }),
      listSince: () => Promise.reject(new Error("select * from run_event where sequence > $1")),
      close: () => {
        fechado = true;
      },
    };

    const app = createApp({
      ...spec,
      logger: loggerDeTeste(registros),
      execution: {
        ...spec.execution,
        runs: {
          ...spec.execution.runs,
          // O handler só pergunta se o Run existe; nada mais do objeto é lido.
          get: async () => ({}) as Run,
          openStream: () => handle,
        },
      },
    });

    const response = await app.request(
      `${API_BASE_PATH}/runs/01996d00-0000-7000-8000-0000000000ff/events/stream`,
    );
    expect(response.status).toBe(200);

    const quadro = quadroDeErro(await corpoDoStream(response));
    expect(quadro.error).toBe("stream_failed");
    expect(quadro.requestId).toBeTruthy();

    // A mensagem do driver — SQL e parâmetros — fica no log, não na resposta.
    expect(quadro.detail).not.toContain("run_event");

    const erro = registros.find((registro) => registro.nivel === "error");
    expect(erro?.mensagem).toBe("sse de run falhou");
    expect(erro?.campos["requestId"]).toBe(quadro.requestId);

    // A referência do stream volta mesmo com o replay quebrado: sem isso, um
    // Run que falhou uma vez seguiria consultando o banco para sempre. A
    // liberação vem uma linha depois de o socket fechar — que é o que o leitor
    // acima observa —, então a leitura acontece um tique adiante.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fechado).toBe(true);
  });
});
