import {
  type HealthResponse,
  isUserSettingsKey,
  type PingEventResponse,
  USER_SETTING_VALUE_SCHEMAS,
} from "@dungeon-master/contracts";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

import { requestId } from "hono/request-id";

import { API_BASE_PATH, API_VERSION } from "./config.js";
import { registerAchievementRoutes } from "./handlers/achievements.js";
import { registerInboxRoutes } from "./handlers/inbox.js";
import { registerProjectRoutes } from "./handlers/projects.js";
import { registerTaskRoutes } from "./handlers/tasks.js";
import type { Logger } from "./logger.js";
import type { DashboardEventsPort, DatabaseProbe, SettingsPort, WorkPort } from "./ports.js";
import type { AchievementCatalog } from "./routes/achievements.js";
import {
  buildProblem,
  HttpProblem,
  problemResponse,
  ProblemType,
  toValidationIssues,
} from "./problem.js";
import { eventsPingRoute, eventsStreamRoute } from "./routes/events.js";
import { healthRoute } from "./routes/health.js";
import { settingsReadRoute, settingsUpdateRoute } from "./routes/settings.js";
import { HonoSseWriter } from "./sse/hono-writer.js";

export type { DatabaseProbe } from "./ports.js";

/** Páginas de replay ao abrir o stream. Igual ao teto do repositório. */
const REPLAY_PAGE_SIZE = 500;

export interface CreateAppOptions {
  /** Checagem de banco injetada, para que a app possa ser criada sem conexão. */
  probeDatabase: () => Promise<DatabaseProbe>;
  /** Stream SSE, replay por cursor e gravação de evento. */
  events: DashboardEventsPort;
  /** Leitura e escrita das configurações do usuário local. */
  settings: SettingsPort;
  /** Project, Task e Inbox: as rotas de trabalho da Fase 1. */
  work: WorkPort;
  /**
   * O catálogo de Conquistas já validado.
   *
   * Entra pronto, e não como uma função que lê o disco, porque catálogo é
   * dado: o arquivo é versionado, muda com um deploy e não com uma
   * requisição. Carregá-lo uma vez no boot também mantém `pnpm gen` sem I/O.
   */
  achievements: AchievementCatalog;
  logger?: Logger;
  /** Instante do boot, usado para calcular `uptimeSeconds`. */
  startedAt?: number;
  /**
   * Liga `POST /events/ping`. Padrão: ligado fora de `production`.
   *
   * A rota é registrada de qualquer jeito, para o `openapi.json` não depender do
   * `NODE_ENV` de quem rodou `pnpm gen`; o que muda é só a resposta.
   */
  pingEnabled?: boolean;
}

export type App = ReturnType<typeof createApp>;

/**
 * Monta a aplicação Hono.
 *
 * Toda dependência entra por injeção porque `scripts/gen-openapi.ts` precisa
 * instanciar a app para gerar a spec sem subir servidor nem conectar no
 * PostgreSQL. Um handler que abrisse conexão no escopo do módulo quebraria o
 * `pnpm gen` e o CI junto.
 */
export function createApp(options: CreateAppOptions) {
  const startedAt = options.startedAt ?? Date.now();
  const logger = options.logger;
  const events = options.events;
  const settings = options.settings;
  const pingEnabled = options.pingEnabled ?? process.env["NODE_ENV"] !== "production";

  const app = new OpenAPIHono({
    // Erro de validação de entrada vira 400 com `errors[]`, no formato RFC 9457.
    defaultHook: (result, c) => {
      if (result.success) return;

      const problem = buildProblem({
        status: 400,
        type: ProblemType.validation,
        title: "Requisição inválida",
        detail: "Um ou mais campos da requisição não passaram na validação.",
        instance: new URL(c.req.url).pathname,
        requestId: c.get("requestId"),
        errors: toValidationIssues(result.error),
      });

      return problemResponse(c, problem);
    },
  });

  app.use("*", requestId());

  if (logger) {
    app.use("*", async (c, next) => {
      const start = Date.now();
      await next();
      logger.info(
        {
          requestId: c.get("requestId"),
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          status: c.res.status,
          durationMs: Date.now() - start,
        },
        "request",
      );
    });
  }

  app.openapi(healthRoute, async (c) => {
    const database = await options.probeDatabase();

    const body: HealthResponse = {
      status: database.ok ? "ok" : "degraded",
      service: "dungeon-master-api",
      version: API_VERSION,
      uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
      checkedAt: new Date().toISOString(),
      database,
    };

    return c.json(body, 200);
  });

  // ------------------------------------------------------------------ eventos

  app.openapi(eventsStreamRoute, (c) => {
    const query = c.req.valid("query");
    const headers = c.req.valid("header");

    // O `Last-Event-ID` ganha do `since`: numa reconexão automática o browser
    // repete a URL da primeira tentativa, que já está velha, mas manda o header
    // com o último id que realmente recebeu. O `since` continua valendo no
    // primeiro connect e para quem testa com curl.
    const fromHeader = Number.parseInt(headers["last-event-id"] ?? "", 10);
    const since =
      Number.isSafeInteger(fromHeader) && fromHeader >= 0
        ? fromHeader
        : Number.parseInt(query.since ?? "0", 10);

    return streamSSE(c, async (stream) => {
      const writer = new HonoSseWriter(stream);
      const subscription = events.transport.subscribe({ writer, since });

      try {
        // Buffer primeiro: uma reconexão rápida costuma caber na memória e não
        // precisa de ida ao banco. `null` é "não dá para provar que cobre", e
        // aí o banco resolve — a dúvida sempre custa uma consulta, nunca um
        // evento perdido.
        const buffered = events.transport.replaySince(since);

        if (buffered === null) {
          let cursor = since;
          for (;;) {
            const page = await events.listSince(cursor, REPLAY_PAGE_SIZE);
            if (page.length === 0) break;
            await subscription.deliverAll(page);
            cursor = page[page.length - 1]!.sequence;
            if (page.length < REPLAY_PAGE_SIZE) break;
          }
        } else {
          await subscription.deliverAll(buffered);
        }

        // Só agora o que chegou durante o replay é liberado, em ordem e sem
        // repetir o que o replay já entregou.
        await subscription.goLive();

        logger?.info(
          { requestId: c.get("requestId"), since, cursor: subscription.cursor },
          "sse conectado",
        );

        // Segura o handler até o cliente sumir. Sem isto o `streamSSE` fecha a
        // resposta assim que o callback resolve.
        await writer.whenClosed;
      } finally {
        await subscription.close();
        logger?.info({ requestId: c.get("requestId") }, "sse desconectado");
      }
    });
  });

  app.openapi(eventsPingRoute, async (c) => {
    if (!pingEnabled) {
      throw new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Recurso não encontrado",
        detail: "O endpoint de ping existe apenas fora de produção.",
      });
    }

    const event = await events.append({
      type: "system.ping",
      payload: { origin: "api", requestedAt: new Date().toISOString() },
    });

    const body: PingEventResponse = { event };
    return c.json(body, 201);
  });

  // ----------------------------------------------------------- configurações

  app.openapi(settingsReadRoute, async (c) => c.json(await settings.read(), 200));

  app.openapi(settingsUpdateRoute, async (c) => {
    const { key } = c.req.valid("param");

    if (!isUserSettingsKey(key)) {
      throw new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Configuração não encontrada",
        detail: `A chave ${JSON.stringify(key)} não existe no contrato de configurações.`,
      });
    }

    const parsed = USER_SETTING_VALUE_SCHEMAS[key].safeParse(c.req.valid("json").value);

    if (!parsed.success) {
      throw new HttpProblem({
        status: 400,
        type: ProblemType.validation,
        title: "Valor inválido para a configuração",
        detail: `O valor enviado não é aceito pela chave ${JSON.stringify(key)}.`,
        // O schema da chave valida só o `value`, então os caminhos que o Zod
        // devolve são relativos a ele; o cliente precisa do caminho no corpo.
        errors: toValidationIssues(parsed.error).map((issue) => ({
          ...issue,
          path: issue.path === "" ? "value" : `value.${issue.path}`,
        })),
      });
    }

    return c.json(await settings.write(key, parsed.data), 200);
  });

  // ------------------------------------------------- Project, Task e Inbox

  registerProjectRoutes(app, options.work.projects);
  registerTaskRoutes(app, options.work.tasks);
  registerInboxRoutes(app, options.work.inbox);

  // ------------------------------------------------------------- Conquistas

  registerAchievementRoutes(app, options.achievements);

  app.doc31(`${API_BASE_PATH}/openapi.json`, {
    openapi: "3.1.0",
    info: {
      title: "Dungeon Master API",
      version: API_VERSION,
      description:
        "Control Plane do Dungeon Master. Erros seguem a RFC 9457 " +
        "(`application/problem+json`). Todos os instantes são UTC.",
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    },
    servers: [{ url: "http://127.0.0.1:3333", description: "Desenvolvimento local" }],
    tags: [
      { name: "system", description: "Saúde, versão e documentação." },
      { name: "events", description: "Stream SSE de eventos de dashboard." },
      { name: "settings", description: "Configurações do usuário local." },
      { name: "projects", description: "Projects: a unidade persistente de contexto." },
      { name: "tasks", description: "Tasks, subtarefas e dependências." },
      { name: "inbox", description: "Captura de intenção: as Tasks em INBOX." },
      { name: "achievements", description: "O catálogo versionado de Conquistas." },
    ],
  });

  app.get(
    `${API_BASE_PATH}/docs`,
    swaggerUI({ url: `${API_BASE_PATH}/openapi.json`, title: "Dungeon Master API" }),
  );

  app.notFound((c) =>
    problemResponse(
      c,
      buildProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Recurso não encontrado",
        detail: `Nenhuma rota corresponde a ${c.req.method} ${new URL(c.req.url).pathname}.`,
        instance: new URL(c.req.url).pathname,
        requestId: c.get("requestId"),
      }),
    ),
  );

  app.onError((error, c) => {
    const instance = new URL(c.req.url).pathname;
    const id = c.get("requestId");

    if (error instanceof HttpProblem) {
      logger?.warn({ requestId: id, err: error, status: error.status }, "problema tratado");
      return problemResponse(
        c,
        buildProblem({
          status: error.status,
          type: error.type,
          title: error.title,
          detail: error.message,
          instance,
          requestId: id,
          errors: error.errors,
        }),
      );
    }

    logger?.error({ requestId: id, err: error }, "erro não tratado");

    // Nada de mensagem interna no corpo: o `requestId` liga a resposta ao log.
    return problemResponse(
      c,
      buildProblem({
        status: 500,
        type: ProblemType.internal,
        title: "Erro interno",
        detail: "A requisição falhou por um erro inesperado. Consulte os logs pelo requestId.",
        instance,
        requestId: id,
      }),
    );
  });

  return app;
}
