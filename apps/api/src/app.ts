import type { HealthResponse } from "@dungeon-master/contracts";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { requestId } from "hono/request-id";

import { API_BASE_PATH, API_VERSION } from "./config.js";
import type { Logger } from "./logger.js";
import {
  buildProblem,
  HttpProblem,
  problemResponse,
  ProblemType,
  toValidationIssues,
} from "./problem.js";
import { healthRoute } from "./routes/health.js";

export interface DatabaseProbe {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error: string | null;
}

export interface CreateAppOptions {
  /** Checagem de banco injetada, para que a app possa ser criada sem conexão. */
  probeDatabase: () => Promise<DatabaseProbe>;
  logger?: Logger;
  /** Instante do boot, usado para calcular `uptimeSeconds`. */
  startedAt?: number;
}

export type App = ReturnType<typeof createApp>;

/**
 * Monta a aplicação Hono.
 *
 * A dependência de banco entra por injeção porque `scripts/gen-openapi.ts`
 * precisa instanciar a app para gerar a spec sem subir servidor nem conectar
 * no PostgreSQL.
 */
export function createApp(options: CreateAppOptions) {
  const startedAt = options.startedAt ?? Date.now();
  const logger = options.logger;

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
    tags: [{ name: "system", description: "Saúde, versão e documentação." }],
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
