import {
  RUN_EVENT_PAGE_LIMIT,
  type RunEventList,
  type RunPage,
  type RunStatus,
} from "@dungeon-master/contracts";
import type { RunFilters } from "@dungeon-master/database";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

import type { Logger } from "../logger.js";
import { resolvePage } from "../pagination.js";
import type { RunsPort } from "../ports.js";
import {
  runsCancelRoute,
  runsContextRoute,
  runsCreateRoute,
  runsEventsRoute,
  runsEventStreamRoute,
  runsGetRoute,
  runsListRoute,
} from "../routes/runs.js";
import { reportStreamFailure } from "../sse/failure.js";
import { HonoSseWriter } from "../sse/hono-writer.js";
import { notFoundProblem, runFailureProblem } from "./failures.js";

/** Páginas de replay ao abrir o stream. Igual ao teto do repositório. */
const REPLAY_PAGE_SIZE = RUN_EVENT_PAGE_LIMIT;

function normalizarStatus(
  status: RunStatus | RunStatus[] | undefined,
): readonly RunStatus[] | undefined {
  if (status === undefined) return undefined;
  return Array.isArray(status) ? status : [status];
}

/**
 * Resolve o cursor de reconexão.
 *
 * O `Last-Event-ID` ganha do `since`: numa reconexão automática o browser
 * repete a URL da primeira tentativa, que já está velha, mas manda o header com
 * o último id que realmente recebeu. O `since` continua valendo no primeiro
 * connect e para quem testa com curl.
 */
export function resolveStreamCursor(input: {
  header: string | undefined;
  query: string | undefined;
}): number {
  const doHeader = Number.parseInt(input.header ?? "", 10);
  if (Number.isSafeInteger(doHeader) && doHeader >= 0) return doHeader;

  const daQuery = Number.parseInt(input.query ?? "0", 10);
  return Number.isSafeInteger(daQuery) && daQuery >= 0 ? daQuery : 0;
}

export function registerRunRoutes(
  app: OpenAPIHono,
  runs: RunsPort,
  options: { logger?: Logger } = {},
): void {
  const logger = options.logger;

  app.openapi(runsCreateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const created = await runs.create(id, {
      ...(input.loadoutId === undefined ? {} : { loadoutId: input.loadoutId }),
      ...(input.executionProfileId === undefined
        ? {}
        : { executionProfileId: input.executionProfileId }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.resumeFromRunId === undefined ? {} : { resumeFromRunId: input.resumeFromRunId }),
    });

    if (created === null) throw notFoundProblem("Task", id);
    if (!created.ok) throw runFailureProblem(created.failure);

    return c.json(created.value, 201);
  });

  app.openapi(runsListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);

    const filters: RunFilters = {
      taskId: query.taskId,
      projectId: query.projectId,
      harnessKey: query.harnessKey,
      status: normalizarStatus(query.status),
    };

    const result = await runs.list({ page, pageSize, filters });
    const body: RunPage = { items: result.items, page, pageSize, total: result.total };

    return c.json(body, 200);
  });

  app.openapi(runsGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const run = await runs.get(id);

    if (run === null) throw notFoundProblem("Run", id);

    return c.json(run, 200);
  });

  app.openapi(runsContextRoute, async (c) => {
    const { id } = c.req.valid("param");

    // Dois 404 com detalhes diferentes: o Run que não existe e o Run que ainda
    // não foi reclamado (ou é anterior ao Context Engine) e não tem registro.
    const run = await runs.get(id);
    if (run === null) throw notFoundProblem("Run", id);

    const context = await runs.context(id);
    if (context === null) throw notFoundProblem("RunContext", id);

    return c.json(context, 200);
  });

  app.openapi(runsCancelRoute, async (c) => {
    const { id } = c.req.valid("param");

    const cancelled = await runs.cancel(id);
    if (cancelled === null) throw notFoundProblem("Run", id);
    if (!cancelled.ok) throw runFailureProblem(cancelled.failure);

    return c.json(cancelled.value, 200);
  });

  app.openapi(runsEventsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");

    // A existência é checada antes de ler: sem isso, o log de um Run
    // inexistente seria uma página vazia em vez de 404.
    const run = await runs.get(id);
    if (run === null) throw notFoundProblem("Run", id);

    const afterSequence = Number.parseInt(query.after ?? "0", 10);
    const pedido = query.limit === undefined ? REPLAY_PAGE_SIZE : Number.parseInt(query.limit, 10);
    const limit = Math.min(pedido, RUN_EVENT_PAGE_LIMIT);

    // Pede um a mais do que o limite para saber se há continuação sem contar a
    // tabela inteira: num Run longo, um `count(*)` por página custaria uma
    // varredura por leitura, e a tela não usa o total.
    const items = await runs.events(id, { afterSequence, limit: limit + 1 });
    const hasMore = items.length > limit;
    const pagina = hasMore ? items.slice(0, limit) : items;

    const body: RunEventList = {
      items: pagina,
      hasMore,
      lastSequence: pagina[pagina.length - 1]?.sequence ?? afterSequence,
    };

    return c.json(body, 200);
  });

  app.openapi(runsEventStreamRoute, async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const headers = c.req.valid("header");

    const run = await runs.get(id);
    if (run === null) throw notFoundProblem("Run", id);

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
          message: "sse de run falhou",
          ...(logger === undefined ? {} : { logger }),
          requestId: c.get("requestId"),
          context: { runId: id, since },
        });

      try {
        const writer = new HonoSseWriter(stream);
        const handle = runs.openStream(id);
        const subscription = handle.transport.subscribe({ writer, since });

        try {
          // Buffer primeiro: uma reconexão rápida costuma caber na memória e não
          // precisa de ida ao banco. `null` é "não dá para provar que cobre", e
          // aí o banco resolve — a dúvida sempre custa uma consulta, nunca um
          // evento perdido.
          const buffered = handle.transport.replaySince(since);

          if (buffered === null) {
            let cursor = since;
            for (;;) {
              const page = await handle.listSince(cursor, REPLAY_PAGE_SIZE);
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
            { requestId: c.get("requestId"), runId: id, since, cursor: subscription.cursor },
            "sse de run conectado",
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
          // Devolve a referência: sem isto, um Run olhado uma vez continuaria
          // consultando o banco para sempre.
          handle.close();
          logger?.info({ requestId: c.get("requestId"), runId: id }, "sse de run desconectado");
        }
      } catch (error) {
        // Falhou antes de haver assinatura, ou dentro da própria limpeza.
        await relatarFalha(error);
      }
    });
  });
}
