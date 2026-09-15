import type { OpenAPIHono } from "@hono/zod-openapi";

import type { MetricsPort } from "../ports.js";
import {
  metricsCostsRoute,
  metricsOverviewRoute,
  metricsSeriesRoute,
  modelPriceHistoryRoute,
  modelPricesListRoute,
  modelPriceSetRoute,
  projectMetricsRoute,
  runMetricsRoute,
  workersListRoute,
} from "../routes/metrics.js";
import { notFoundProblem } from "./failures.js";
import { HttpProblem, ProblemType } from "../problem.js";

/**
 * As rotas de métricas, custo e presença de Worker (Fase 10A).
 *
 * Tudo entra pela porta, como o resto da API: o handler não sabe se atrás dela
 * existe PostgreSQL. As janelas têm padrão `30d` aqui, e não no schema Zod, pelo
 * mesmo motivo de `resolvePage`: o padrão é decisão da rota, e deixá-lo no
 * contrato faria o cliente gerado declarar um campo obrigatório que ele nunca
 * precisa preencher.
 */
export function registerMetricRoutes(app: OpenAPIHono, metrics: MetricsPort): void {
  app.openapi(metricsOverviewRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await metrics.overview({
        window: query.window ?? "30d",
        projectId: query.projectId ?? null,
      }),
      200,
    );
  });

  app.openapi(metricsSeriesRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await metrics.series({
        metric: query.metric ?? "runs",
        dimension: query.dimension ?? "ALL",
        window: query.window ?? "30d",
        projectId: query.projectId ?? null,
        currency: query.currency,
      }),
      200,
    );
  });

  app.openapi(metricsCostsRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(await metrics.costs({ window: query.window ?? "30d" }), 200);
  });

  app.openapi(projectMetricsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");

    // O `404` vem de o Project não existir, e não de ele não ter Run: um
    // Project recém-criado tem métrica zerada, que é uma resposta legítima.
    if (!(await metrics.projectExists(id))) throw notFoundProblem("Project", id);

    return c.json(await metrics.overview({ window: query.window ?? "30d", projectId: id }), 200);
  });

  app.openapi(runMetricsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const metrica = await metrics.run(id);
    if (metrica === null) throw notFoundProblem("métrica de Run", id);
    return c.json(metrica, 200);
  });

  // --------------------------------------------------------------- preços

  app.openapi(modelPricesListRoute, async (c) => c.json({ items: await metrics.prices() }, 200));

  app.openapi(modelPriceHistoryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const historico = await metrics.priceHistory(id);
    if (historico === null) throw notFoundProblem("Model", id);
    return c.json({ items: historico }, 200);
  });

  app.openapi(modelPriceSetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const gravado = await metrics.setPrice(id, c.req.valid("json"));

    if (gravado === null) throw notFoundProblem("Model", id);
    if (!gravado.ok) {
      throw new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Vigência de preço inválida",
        detail:
          "A vigência nova precisa começar depois do início da vigência atual: o " +
          "histórico de preço é append-only e não se reescreve.",
      });
    }

    return c.json(gravado.value, 200);
  });

  // -------------------------------------------------------------- Workers

  app.openapi(workersListRoute, async (c) => c.json({ items: await metrics.workers() }, 200));
}
