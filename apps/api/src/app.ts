import {
  type HealthResponse,
  isUserSettingsKey,
  type PingEventResponse,
  USER_SETTING_VALUE_SCHEMAS,
} from "@dungeon-master/contracts";
import { DASHBOARD_EVENT_PAGE_LIMIT } from "@dungeon-master/database";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import { requestId } from "hono/request-id";

import { API_BASE_PATH, API_VERSION } from "./config.js";
import { registerAchievementRoutes } from "./handlers/achievements.js";
import { registerInboxRoutes } from "./handlers/inbox.js";
import { registerKnowledgeRoutes } from "./handlers/knowledge.js";
import { registerPreflightRoutes } from "./handlers/preflight.js";
import { registerProjectRoutes } from "./handlers/projects.js";
import {
  registerKnowledgeCandidateRoutes,
  registerProposedTaskRoutes,
} from "./handlers/proposals.js";
import {
  registerAgentRoutes,
  registerExecutionProfileRoutes,
  registerHarnessRoutes,
  registerLoadoutRoutes,
  registerModelRoutes,
} from "./handlers/registry.js";
import { registerRunRoutes, resolveStreamCursor } from "./handlers/runs.js";
import { registerTaskGraphRoutes } from "./handlers/task-graph.js";
import { registerTaskRoutes } from "./handlers/tasks.js";
import {
  registerApprovalGateRoutes,
  registerRunWorkflowRoutes,
  registerWorkflowRoutes,
} from "./handlers/workflows.js";
import type { Logger } from "./logger.js";
import type {
  AchievementsPort,
  DashboardEventsPort,
  DatabaseProbe,
  ExecutionPort,
  SettingsPort,
  WorkPort,
} from "./ports.js";
import type { AchievementCatalog } from "./routes/achievements.js";
import {
  buildProblem,
  HttpProblem,
  problemResponse,
  problemTitleForStatus,
  problemTypeForStatus,
  ProblemType,
  toValidationIssues,
  validationStatusFor,
} from "./problem.js";
import { eventsPingRoute, eventsStreamRoute } from "./routes/events.js";
import { healthRoute } from "./routes/health.js";
import { settingsReadRoute, settingsUpdateRoute } from "./routes/settings.js";
import { reportStreamFailure } from "./sse/failure.js";
import { HonoSseWriter } from "./sse/hono-writer.js";

export type { DatabaseProbe } from "./ports.js";

/**
 * Páginas de replay ao abrir o stream.
 *
 * Vem do repositório que serve o replay, e não de um `500` escrito aqui: um
 * número copiado é uma segunda verdade que diverge no dia em que a primeira
 * mudar — e um `REPLAY_PAGE_SIZE` colado foi exatamente o que escondeu a
 * paginação de `GET /runs/{id}/events` (post-mortem #10).
 */
const REPLAY_PAGE_SIZE = DASHBOARD_EVENT_PAGE_LIMIT;

export interface CreateAppOptions {
  /** Checagem de banco injetada, para que a app possa ser criada sem conexão. */
  probeDatabase: () => Promise<DatabaseProbe>;
  /** Stream SSE, replay por cursor e gravação de evento. */
  events: DashboardEventsPort;
  /** Leitura e escrita das configurações do usuário local. */
  settings: SettingsPort;
  /** Project, Task e Inbox: as rotas de trabalho da Fase 1. */
  work: WorkPort;
  /** Harness, Model, Agent, ExecutionProfile, Loadout e Run: a Fase 2A. */
  execution: ExecutionPort;
  /**
   * O catálogo de Conquistas já validado.
   *
   * Entra pronto, e não como uma função que lê o disco, porque catálogo é
   * dado: o arquivo é versionado, muda com um deploy e não com uma
   * requisição. Carregá-lo uma vez no boot também mantém `pnpm gen` sem I/O.
   */
  achievements: AchievementCatalog;
  /**
   * O Hall com estado: progresso, crônica e estatísticas de Herói.
   *
   * Separado do catálogo porque são coisas diferentes: o catálogo é o arquivo
   * versionado, sem usuário; isto é a projeção que o Worker mantém no banco.
   */
  hall: AchievementsPort;
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
    // Um corpo bem formado que quebra uma regra estrutural do schema — a
    // definição de um Workflow com ciclo, por exemplo — vira 422, com os mesmos
    // `errors[]` apontando o campo.
    defaultHook: (result, c) => {
      if (result.success) return;

      const status = validationStatusFor(result.error);
      const problem = buildProblem({
        status,
        type: ProblemType.validation,
        title: status === 422 ? "Conteúdo inválido" : "Requisição inválida",
        detail:
          status === 422
            ? "O corpo está bem formado, mas quebra uma regra do recurso. Veja `errors[]`."
            : "Um ou mais campos da requisição não passaram na validação.",
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

    // Uma função só resolve o cursor das duas rotas de stream. A cópia que
    // morava aqui tinha perdido a guarda de `Number.isSafeInteger` no ramo da
    // query, e um `?since=` de 19 dígitos — que o `StreamQuerySchema` aceita —
    // descia até o `bigint` do PostgreSQL e estourava dentro do stream, no
    // buraco que o post-mortem #9 fechou.
    const since = resolveStreamCursor({
      header: headers["last-event-id"],
      query: query.since,
    });

    return streamSSE(c, async (stream) => {
      // post-mortem #9 (08/09/2026): sem isto, uma falha aqui virava um 200
      // com stream vazio e um `console.error` do Hono. Veja `sse/failure.ts`.
      const relatarFalha = (error: unknown): Promise<void> =>
        reportStreamFailure({
          stream,
          error,
          message: "sse de dashboard falhou",
          ...(logger === undefined ? {} : { logger }),
          requestId: c.get("requestId"),
          context: { since },
        });

      try {
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
        } catch (error) {
          // Antes do `finally`, e não depois: fechar a assinatura fecha o
          // stream, e um quadro escrito depois disso não chega a ninguém.
          await relatarFalha(error);
        } finally {
          await subscription.close();
          logger?.info({ requestId: c.get("requestId") }, "sse desconectado");
        }
      } catch (error) {
        // Falhou antes de haver assinatura, ou dentro da própria limpeza.
        await relatarFalha(error);
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

  // ------------------------------------------- Propostas e grafo (Fase 5)

  registerTaskGraphRoutes(app, { projects: options.work.projects, tasks: options.work.tasks });
  registerProposedTaskRoutes(app, options.work.proposedTasks);
  registerKnowledgeCandidateRoutes(app, options.work.knowledgeCandidates);

  // ------------------------------------------------------- Grimório (Fase 6)

  registerKnowledgeRoutes(app, options.work.knowledge);

  // ------------------------------------------------------------- execução

  registerHarnessRoutes(app, options.execution.harnesses);
  registerModelRoutes(app, options.execution.models);
  registerAgentRoutes(app, options.execution.agents);
  registerExecutionProfileRoutes(app, options.execution.executionProfiles);
  registerLoadoutRoutes(app, options.execution.loadouts);
  registerPreflightRoutes(app, options.execution.dockerPreflight);
  registerRunRoutes(app, options.execution.runs, logger === undefined ? {} : { logger });

  // ------------------------------------------------------------- Workflow

  registerRunWorkflowRoutes(app, options.execution.runs);
  registerWorkflowRoutes(app, options.execution.workflows);
  registerApprovalGateRoutes(app, options.execution.approvalGates);

  // ------------------------------------------------------------- Conquistas

  registerAchievementRoutes(app, options.achievements, options.hall);

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
      {
        name: "execution",
        description: "Cadastros de execução: Harness, Model, Agent, ExecutionProfile e Loadout.",
      },
      { name: "runs", description: "Runs: as tentativas concretas de realizar uma Task." },
      { name: "workflows", description: "Workflows: o processo de uma execução, como dados." },
      { name: "approvals", description: "ApprovalGates: as pausas humanas de um Run." },
      {
        name: "proposals",
        description: "ProposedTasks: o trabalho que os Runs encontraram e não fizeram.",
      },
      {
        name: "knowledge",
        description:
          "O Grimório: candidatos, itens de conhecimento com revisão humana, o resumo e as " +
          "decisões do Project, e os lotes do Distiller.",
      },
      {
        name: "achievements",
        description:
          "O catálogo versionado de Conquistas, a projeção de progresso e as forjadas em revisão.",
      },
      { name: "heroes", description: "Estatísticas de Herói e de Equipamento. Projeção." },
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
          extensions: error.extensions,
        }),
      );
    }

    // Erros que o Hono levanta antes de qualquer handler nosso: corpo que não é
    // JSON válido, `content-type` errado, corpo grande demais. Eles já sabem o
    // status certo, e tratá-los como erro inesperado devolvia `500` para o que é
    // culpa da requisição — o cliente via "erro interno" e ficava sem saber que
    // bastava corrigir o corpo.
    if (error instanceof HTTPException) {
      const status = error.status;
      const cliente = status < 500;

      logger?.[cliente ? "warn" : "error"](
        { requestId: id, err: error, status },
        "exceção HTTP do framework",
      );

      return problemResponse(
        c,
        buildProblem({
          status,
          type: problemTypeForStatus(status),
          title: problemTitleForStatus(status),
          // A mensagem do Hono descreve o que veio errado na requisição
          // ("Malformed JSON in request body") e é segura de mostrar. Num `5xx`
          // ela pode carregar detalhe interno, e aí vale a regra de sempre.
          detail: cliente
            ? error.message
            : "A requisição falhou por um erro inesperado. Consulte os logs pelo requestId.",
          instance,
          requestId: id,
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
