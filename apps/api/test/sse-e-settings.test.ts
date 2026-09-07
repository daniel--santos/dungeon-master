import {
  DashboardEventSchema,
  ProblemDetailsSchema,
  UserSettingsSchema,
} from "@dungeon-master/contracts";
import {
  appendDashboardEvent,
  createDatabase,
  type DatabaseHandle,
  listDashboardEventsSince,
  LOCAL_USER_ID,
} from "@dungeon-master/database";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { type App, createApp } from "../src/app.js";
import {
  createEventsRuntime,
  type EventsRuntime,
  createSettingsPort,
  createWorkPort,
} from "../src/composition.js";
import { API_BASE_PATH } from "../src/config.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";

let handle: DatabaseHandle;
let runtime: EventsRuntime;
let app: App;

beforeAll(async () => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 5,
    applicationName: "vitest-api",
  });

  runtime = await createEventsRuntime({
    db: handle.db,
    pool: handle.pool,
    userId: LOCAL_USER_ID,
    // O heartbeat não interessa aqui e só somaria ruído aos quadros lidos.
    heartbeatIntervalMs: 0,
    // Tique curto: alguns testes dependem do drain, e esperar 5 s por cada um
    // deixaria a suíte lenta sem provar nada a mais.
    fallbackIntervalMs: 100,
  });

  app = createApp({
    probeDatabase: async () => ({ ok: true, latencyMs: 0, error: null }),
    events: runtime.port,
    settings: createSettingsPort({ db: handle.db, userId: LOCAL_USER_ID }),
    work: createWorkPort({ db: handle.db, userId: LOCAL_USER_ID }),
    achievements: { definitions: [], templates: [], invalid: [] },
    pingEnabled: true,
  });

  await runtime.start();
});

afterAll(async () => {
  await runtime.stop();
  await limpar("dashboard_event");
  await limpar("user_setting");
  await handle.close();
});

beforeEach(async () => {
  await limpar("user_setting");
});

/**
 * Fixtures em SQL cru, pelo pool.
 *
 * `apps/api` não importa o Drizzle: quem fala com o ORM é
 * `@dungeon-master/database`, e um `import` de `drizzle-orm` aqui só para
 * arrumar a mesa borraria essa linha.
 */
async function limpar(tabela: "dashboard_event" | "user_setting"): Promise<void> {
  await handle.pool.query(`delete from ${tabela} where user_id = $1`, [LOCAL_USER_ID]);
}

async function lerConfiguracoesCruas(): Promise<Array<{ key: string; value: unknown }>> {
  const result = await handle.pool.query<{ key: string; value: unknown }>(
    "select key, value from user_setting where user_id = $1 order by key",
    [LOCAL_USER_ID],
  );
  return result.rows;
}

/**
 * Lê quadros SSE de uma resposta até juntar `quantidade` eventos, e então
 * cancela a leitura, o que aborta o stream do lado do servidor.
 */
async function lerEventos(response: Response, quantidade: number, timeoutMs = 10_000) {
  const body = response.body;
  if (body === null) throw new Error("A resposta do stream veio sem corpo.");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const eventos: Array<{ id: string; data: unknown }> = [];
  const comentarios: string[] = [];
  let restante = "";

  const prazo = setTimeout(() => void reader.cancel(), timeoutMs);

  try {
    while (eventos.length < quantidade) {
      const { done, value } = await reader.read();
      if (done) break;

      restante += decoder.decode(value, { stream: true });

      // Quadros SSE são separados por linha em branco.
      let corte = restante.indexOf("\n\n");
      while (corte !== -1) {
        const quadro = restante.slice(0, corte);
        restante = restante.slice(corte + 2);

        if (quadro.startsWith(":")) {
          comentarios.push(quadro.slice(1).trim());
        } else {
          const linhas = quadro.split("\n");
          const id = linhas.find((linha) => linha.startsWith("id: "))?.slice(4) ?? "";
          const data = linhas
            .filter((linha) => linha.startsWith("data: "))
            .map((linha) => linha.slice(6))
            .join("\n");
          eventos.push({ id, data: JSON.parse(data) });
        }

        corte = restante.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(prazo);
    await reader.cancel();
  }

  return { eventos, comentarios };
}

describe(`GET ${API_BASE_PATH}/settings`, () => {
  it("devolve os padrões quando nada foi gravado", async () => {
    const response = await app.request(`${API_BASE_PATH}/settings`);

    expect(response.status).toBe(200);
    expect(UserSettingsSchema.parse(await response.json())).toEqual({ "ui.theme": "dnd" });
  });

  it("devolve o que está gravado por cima do padrão", async () => {
    await handle.pool.query(
      "insert into user_setting (user_id, key, value) values ($1, $2, $3::jsonb)",
      [LOCAL_USER_ID, "ui.theme", JSON.stringify("plain")],
    );

    const response = await app.request(`${API_BASE_PATH}/settings`);
    const body = UserSettingsSchema.parse(await response.json());

    expect(body["ui.theme"]).toBe("plain");
  });
});

describe(`PUT ${API_BASE_PATH}/settings/{key}`, () => {
  async function put(key: string, value: unknown): Promise<Response> {
    return await app.request(`${API_BASE_PATH}/settings/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
  }

  it("persiste o valor e devolve o objeto completo", async () => {
    const response = await put("ui.theme", "plain");

    expect(response.status).toBe(200);
    expect(UserSettingsSchema.parse(await response.json())).toEqual({ "ui.theme": "plain" });

    const rows = await lerConfiguracoesCruas();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("plain");
  });

  it("grava o evento settings.changed junto com o valor", async () => {
    const antes = await listDashboardEventsSince(handle.db, {
      userId: LOCAL_USER_ID,
      afterSequence: 0,
    });
    const cursor = antes.at(-1)?.sequence ?? 0;

    await put("ui.theme", "plain");

    const depois = await listDashboardEventsSince(handle.db, {
      userId: LOCAL_USER_ID,
      afterSequence: cursor,
    });

    expect(depois).toHaveLength(1);
    expect(depois[0]?.type).toBe("settings.changed");
    expect(depois[0]?.payload).toEqual({ key: "ui.theme", value: "plain" });
  });

  it("faz upsert em vez de duplicar a linha", async () => {
    await put("ui.theme", "plain");
    await put("ui.theme", "dnd");

    const rows = await lerConfiguracoesCruas();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("dnd");
  });

  it("valor fora da união vira 400 com errors[]", async () => {
    const response = await put("ui.theme", "neon");

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.errors?.[0]?.path).toBe("value");

    // Nada foi gravado: o handler recusa antes de tocar o banco.
    expect(await lerConfiguracoesCruas()).toHaveLength(0);
  });

  it("chave desconhecida vira 404 em problem details", async () => {
    const response = await put("ui.inexistente", "dnd");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.title).toBe("Configuração não encontrada");
  });

  it("chave malformada não chega ao handler e vira 400", async () => {
    const response = await put("UI.Theme", "dnd");

    expect(response.status).toBe(400);
  });
});

describe(`GET ${API_BASE_PATH}/events/stream`, () => {
  it("reenvia o que veio depois do cursor e nada antes dele", async () => {
    const marco = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { marco: true },
    });
    const primeiro = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { n: 1 },
    });
    const segundo = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { n: 2 },
    });

    const response = await app.request(
      `${API_BASE_PATH}/events/stream?since=${String(marco.sequence)}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const { eventos } = await lerEventos(response, 2);

    expect(eventos.map((evento) => evento.id)).toEqual([
      String(primeiro.sequence),
      String(segundo.sequence),
    ]);
    expect(DashboardEventSchema.parse(eventos[0]!.data).payload).toEqual({ n: 1 });
  });

  it("aceita o cursor pelo header Last-Event-ID, com precedência sobre since", async () => {
    const marco = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { marco: true },
    });
    const depois = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { depois: true },
    });

    // `since=0` pediria a tabela inteira; o header manda, como numa reconexão
    // automática do EventSource, em que a URL é a da primeira tentativa.
    const response = await app.request(`${API_BASE_PATH}/events/stream?since=0`, {
      headers: { "last-event-id": String(marco.sequence) },
    });

    const { eventos } = await lerEventos(response, 1);

    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.id).toBe(String(depois.sequence));
  });

  it("cursor malformado vira 400 antes de abrir o stream", async () => {
    const response = await app.request(`${API_BASE_PATH}/events/stream?since=abacate`);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
  });

  it("entrega ao vivo o que for gravado com o stream aberto", async () => {
    const marco = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { marco: true },
    });

    const response = await app.request(
      `${API_BASE_PATH}/events/stream?since=${String(marco.sequence)}`,
    );

    // O ping grava a linha, o trigger emite o NOTIFY sem payload, o listener
    // acorda o drain e o transporte empurra. Este é o caminho inteiro.
    const lendo = lerEventos(response, 1);
    const ping = await app.request(`${API_BASE_PATH}/events/ping`, { method: "POST" });
    expect(ping.status).toBe(201);

    const { eventos } = await lendo;

    expect(eventos).toHaveLength(1);
    const evento = DashboardEventSchema.parse(eventos[0]!.data);
    expect(evento.type).toBe("system.ping");
    expect(eventos[0]!.id).toBe(String(evento.sequence));
  });

  it("uma troca de configuração chega ao stream como settings.changed", async () => {
    const marco = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { marco: true },
    });

    const response = await app.request(
      `${API_BASE_PATH}/events/stream?since=${String(marco.sequence)}`,
    );
    const lendo = lerEventos(response, 1);

    await app.request(`${API_BASE_PATH}/settings/ui.theme`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "plain" }),
    });

    const { eventos } = await lendo;
    const evento = DashboardEventSchema.parse(eventos[0]!.data);

    expect(evento.type).toBe("settings.changed");
    expect(evento.payload).toEqual({ key: "ui.theme", value: "plain" });
  });

  it("reconectar com o último cursor não repete nem perde evento", async () => {
    const marco = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { marco: true },
    });

    const primeira = await app.request(
      `${API_BASE_PATH}/events/stream?since=${String(marco.sequence)}`,
    );
    const lendoPrimeira = lerEventos(primeira, 1);
    await app.request(`${API_BASE_PATH}/events/ping`, { method: "POST" });
    const { eventos: recebidosAntes } = await lendoPrimeira;

    const ultimoVisto = Number(recebidosAntes[0]!.id);

    // Com a conexão derrubada, chegam mais dois. Um deles é gravado direto no
    // banco, sem passar pela API, como faria o Worker.
    await app.request(`${API_BASE_PATH}/events/ping`, { method: "POST" });
    const terceiro = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { fora: true },
    });

    const segunda = await app.request(
      `${API_BASE_PATH}/events/stream?since=${String(ultimoVisto)}`,
    );
    const { eventos: recebidosDepois } = await lerEventos(segunda, 2);

    const sequencias = recebidosDepois.map((evento) => Number(evento.id));
    expect(sequencias).toEqual([ultimoVisto + 1, terceiro.sequence]);
    expect(sequencias).not.toContain(ultimoVisto);
  });
});

describe(`POST ${API_BASE_PATH}/events/ping`, () => {
  it("responde 404 quando o endpoint está desligado", async () => {
    const emProducao = createApp({
      probeDatabase: async () => ({ ok: true, latencyMs: 0, error: null }),
      events: runtime.port,
      settings: createSettingsPort({ db: handle.db, userId: LOCAL_USER_ID }),
      work: createWorkPort({ db: handle.db, userId: LOCAL_USER_ID }),
      achievements: { definitions: [], templates: [], invalid: [] },
      pingEnabled: false,
    });

    const response = await emProducao.request(`${API_BASE_PATH}/events/ping`, { method: "POST" });

    expect(response.status).toBe(404);
    expect(ProblemDetailsSchema.parse(await response.json()).status).toBe(404);
  });
});
