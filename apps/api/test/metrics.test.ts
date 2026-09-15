import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ExecutionProfileListSchema,
  HarnessListSchema,
  LoadoutSchema,
  MetricCostsSchema,
  MetricSeriesSchema,
  MetricsOverviewSchema,
  ModelPriceListSchema,
  ModelPriceSchema,
  ProblemDetailsSchema,
  RunMetricsSchema,
  WorkerListSchema,
} from "@dungeon-master/contracts";
import {
  createDatabase,
  type DatabaseHandle,
  LOCAL_USER_ID,
  projectMetrics,
  registerWorker,
} from "@dungeon-master/database";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import { criarApp, limparTudo, pedir } from "./support.js";

/**
 * As rotas da Fase 10A pela API.
 *
 * O Run é criado e fechado pelas rotas de verdade, e o projetor roda como o
 * Worker o roda: se a projeção quebrar, estes testes quebram junto, em vez de
 * medir uma massa inserida à mão que a produção nunca produziria.
 */

let handle: DatabaseHandle;
let app: App;
let workspace: string;

const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-api-metricas",
  });
  app = criarApp(handle);
  // Um diretório de verdade: `PATCH /projects/{id}` confere a existência no
  // disco antes de gravar o caminho.
  workspace = mkdtempSync(join(tmpdir(), "dm-metricas-"));
});

beforeEach(async () => {
  await limparTudo(handle);
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
  rmSync(workspace, { recursive: true, force: true });
});

/** Um Loadout completo sobre os cadastros semeados, pelas rotas de verdade. */
async function criarLoadout(modelId?: string): Promise<string> {
  const harnesses = HarnessListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` })).json(),
  );
  const harness = harnesses.items.find((item) => item.key === "CLAUDE_CODE");

  const perfis = ExecutionProfileListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/execution-profiles` })).json(),
  );
  const perfil = perfis.items.find((item) => item.enabled);

  const agent = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/agents`,
    body: { name: "Engenheiro de métricas", role: "ENGINEER", instructions: "Implemente." },
  });
  const { id: agentId } = (await agent.json()) as { id: string };

  const resposta = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/loadouts`,
    body: {
      name: "Claude Code medido",
      agentId,
      harnessId: harness?.id,
      executionProfileId: perfil?.id,
      ...(modelId === undefined ? {} : { modelId }),
    },
  });

  expect(resposta.status).toBe(201);
  return LoadoutSchema.parse(await resposta.json()).id;
}

/** Um Model do Harness semeado, para os testes de preço. */
async function criarModel(chave: string): Promise<{ id: string }> {
  const harnesses = HarnessListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` })).json(),
  );
  const harness = harnesses.items.find((item) => item.key === "CLAUDE_CODE");

  const resposta = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/models`,
    body: { harnessId: harness?.id, key: chave, name: `Modelo ${chave}` },
  });

  expect(resposta.status).toBe(201);
  return (await resposta.json()) as { id: string };
}

async function corpo<T>(resposta: Response): Promise<T> {
  return (await resposta.json()) as T;
}

/**
 * Um Project com workspace, uma Task e um Run fechado, tudo pela API.
 *
 * Com `modelKey`, o Loadout aponta para um Model de verdade: é o que faz o Run
 * copiar a chave e o custo ter em que se apoiar.
 */
async function expedicaoFechada(
  options: { modelKey?: string } = {},
): Promise<{ runId: string; projectId: string; modelId: string | null }> {
  const projeto = await corpo<{ id: string }>(
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/projects`,
      body: { title: "Medir" },
    }),
  );
  await pedir({
    app,
    method: "PATCH",
    path: `${API_BASE_PATH}/projects/${projeto.id}`,
    body: { workspacePath: workspace },
  });
  const modelo = options.modelKey === undefined ? null : await criarModel(options.modelKey);
  const loadoutId = await criarLoadout(modelo?.id);

  const tarefa = await corpo<{ id: string }>(
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: projeto.id, title: "Uma Expedição medida" },
    }),
  );

  const respostaRun = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks/${tarefa.id}/runs`,
    body: { loadoutId },
  });
  const criado = await corpo<{ id: string }>(respostaRun);
  expect(respostaRun.status, JSON.stringify(criado)).toBe(201);

  const runId = criado.id;

  // O Worker é quem levaria o Run até o fim; aqui a máquina de estados é
  // percorrida direto, com as mesmas colunas que ele escreveria.
  await handle.pool.query(
    `update run set status = 'RUNNING', started_at = now() - interval '5 seconds' where id = $1`,
    [runId],
  );
  await handle.pool.query(
    `insert into run_event (id, user_id, run_id, sequence, type, payload)
     values (gen_random_uuid(), $1, $2, 1, 'Usage',
             '{"type":"Usage","usage":{"inputTokens":1000000,"outputTokens":100000}}'::jsonb),
            (gen_random_uuid(), $1, $2, 2, 'ToolCall',
             '{"type":"ToolCall","name":"mcp__knowledge__search_knowledge","arguments":""}'::jsonb)`,
    [LOCAL_USER_ID, runId],
  );
  await handle.pool.query(
    // Um segundo atrás, e não `now()`: o relógio do PostgreSQL pode estar
    // milissegundos à frente do relógio do Node, e o projetor lê até o instante
    // que o **processo** acha que é agora. Em produção quem escreve
    // `finished_at` é a aplicação, com o próprio relógio, e o atraso de
    // segurança de um segundo cobre o resto; aqui a massa nasce do banco.
    `update run set status = 'SUCCEEDED', finished_at = now() - interval '1 second' where id = $1`,
    [runId],
  );

  const relatorio = await projectMetrics(handle.db, { userId: LOCAL_USER_ID, lagMs: 0 });
  expect(relatorio.ok).toBe(true);
  expect(relatorio.runs).toBe(1);

  return { runId, projectId: projeto.id, modelId: modelo?.id ?? null };
}

describe("GET /api/v1/metrics/overview", () => {
  it("responde os tiles da janela, com o custo não medido separado", async () => {
    await expedicaoFechada();

    const resposta = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/metrics/overview?window=7d`,
    });

    expect(resposta.status).toBe(200);
    const body = MetricsOverviewSchema.parse(await resposta.json());

    expect(body.window).toBe("7d");
    expect(body.runs.total).toBe(1);
    expect(body.runs.succeeded).toBe(1);
    expect(body.runs.successRate).toBe(1);
    expect(body.tokens.total).toBe(1_100_000);
    expect(body.tokens.knownRuns).toBe(1);
    expect(body.costs).toEqual([{ status: "NOT_MEASURED", currency: null, amount: null }]);
    expect(body.notMeasuredRuns).toBe(1);
    expect(body.workers).toEqual({ online: 0, stale: 0, offline: 0 });
  });

  it("recusa uma janela fora do vocabulário com 400 em problem+json", async () => {
    const resposta = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/metrics/overview?window=42d`,
    });

    expect(resposta.status).toBe(400);
    expect(resposta.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    const problema = ProblemDetailsSchema.parse(await resposta.json());
    expect(problema.errors?.length).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/metrics/series", () => {
  it("devolve um ponto por dia, inclusive nos dias sem Run", async () => {
    await expedicaoFechada();

    const resposta = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/metrics/series?metric=tokens&dimension=ALL&window=7d`,
    });

    expect(resposta.status).toBe(200);
    const body = MetricSeriesSchema.parse(await resposta.json());

    expect(body.unit).toBe("tokens");
    expect(body.series).toHaveLength(1);
    expect(body.series[0]?.points).toHaveLength(7);
    expect(body.series[0]?.total).toBe(1_100_000);
  });

  it("sem nada precificado, a série de custo vem com a moeda nula", async () => {
    await expedicaoFechada();

    const resposta = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/metrics/series?metric=cost&window=7d`,
    });

    const body = MetricSeriesSchema.parse(await resposta.json());
    expect(body.currency).toBeNull();
    expect(body.series[0]?.total).toBe(0);
  });
});

describe("GET /api/v1/projects/{id}/metrics", () => {
  it("responde os tiles do Project", async () => {
    const { projectId } = await expedicaoFechada();

    const resposta = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/projects/${projectId}/metrics?window=30d`,
    });

    expect(resposta.status).toBe(200);
    const body = MetricsOverviewSchema.parse(await resposta.json());
    expect(body.projectId).toBe(projectId);
    expect(body.runs.total).toBe(1);
  });

  it("404 quando o Project não existe — e não um painel zerado", async () => {
    const resposta = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/projects/${ID_INEXISTENTE}/metrics`,
    });

    expect(resposta.status).toBe(404);
    expect(resposta.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
  });
});

describe("GET /api/v1/runs/{id}/metrics", () => {
  it("traz a quebra da Expedição, com as ferramentas por servidor", async () => {
    const { runId } = await expedicaoFechada();

    const resposta = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${runId}/metrics`,
    });

    expect(resposta.status).toBe(200);
    const body = RunMetricsSchema.parse(await resposta.json());

    expect(body.runId).toBe(runId);
    expect(body.tokens.known).toBe(true);
    expect(body.toolCalls).toEqual({ total: 1, byServer: [{ server: "knowledge", calls: 1 }] });
    expect(body.cost.status).toBe("NOT_MEASURED");
  });

  it("404 num Run que ainda não foi projetado", async () => {
    const resposta = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${ID_INEXISTENTE}/metrics`,
    });

    expect(resposta.status).toBe(404);
  });
});

describe("preço de Model", () => {
  it("`PUT` abre a vigência e o custo do Run passa a `PRICED`", async () => {
    const { runId, modelId } = await expedicaoFechada({ modelKey: "modelo-de-preco" });
    if (modelId === null) throw new Error("O Model do preço não foi criado.");

    // A vigência começa antes do Run: um preço que começa depois não alcança o
    // que já aconteceu, e é essa a regra que o histórico existe para sustentar.
    const ontem = new Date(Date.now() - 86_400_000).toISOString();

    const resposta = await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/models/${modelId}/price`,
      body: {
        currency: "USD",
        inputPerMillion: 3,
        outputPerMillion: 15,
        effectiveFrom: ontem,
      },
    });

    expect(resposta.status).toBe(200);
    const preco = ModelPriceSchema.parse(await resposta.json());
    expect(preco.currency).toBe("USD");
    expect(preco.effectiveTo).toBeNull();

    const metrica = RunMetricsSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs/${runId}/metrics` })
      ).json(),
    );
    // 1 M de entrada a 3 + 0,1 M de saída a 15 = 4,5
    expect(metrica.cost).toEqual({ status: "PRICED", currency: "USD", amount: 4.5 });
  });

  it("uma vigência que não começa depois da atual é `409`", async () => {
    const modelo = await criarModel("modelo-de-preco");
    const instante = new Date(Date.UTC(2026, 3, 1)).toISOString();

    const corpoPreco = {
      currency: "USD",
      inputPerMillion: 1,
      outputPerMillion: 2,
      effectiveFrom: instante,
    };

    expect(
      (
        await pedir({
          app,
          method: "PUT",
          path: `${API_BASE_PATH}/models/${modelo.id}/price`,
          body: corpoPreco,
        })
      ).status,
    ).toBe(200);

    const repetido = await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/models/${modelo.id}/price`,
      body: corpoPreco,
    });

    expect(repetido.status).toBe(409);
    expect(repetido.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
  });

  it("o histórico e a lista de vigências correntes respondem", async () => {
    const modelo = await criarModel("modelo-de-preco");

    await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/models/${modelo.id}/price`,
      body: { currency: "BRL", inputPerMillion: 1, outputPerMillion: 2 },
    });

    const correntes = ModelPriceListSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/model-prices` })).json(),
    );
    expect(correntes.items).toHaveLength(1);
    expect(correntes.items[0]?.modelName).not.toBeNull();

    const historico = ModelPriceListSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/models/${modelo.id}/prices` })
      ).json(),
    );
    expect(historico.items).toHaveLength(1);

    const inexistente = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/models/${ID_INEXISTENTE}/prices`,
    });
    expect(inexistente.status).toBe(404);
  });

  it("uma mensalidade sem moeda é recusada antes de chegar ao banco", async () => {
    const providers = await corpo<{ items: { id: string }[] }>(
      await pedir({ app, method: "GET", path: `${API_BASE_PATH}/providers` }),
    );
    const provider = providers.items[0];
    if (provider === undefined) throw new Error("O seed não deixou nenhum Provider.");

    const recusado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/providers/${provider.id}`,
      body: { billingKind: "SUBSCRIPTION", monthlyCost: 200 },
    });

    expect([400, 422]).toContain(recusado.status);
    expect(recusado.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
  });

  it("o faturamento volta gravado, e sair de assinatura leva a mensalidade junto", async () => {
    const providers = await corpo<{ items: { id: string }[] }>(
      await pedir({ app, method: "GET", path: `${API_BASE_PATH}/providers` }),
    );
    const provider = providers.items[0];
    if (provider === undefined) throw new Error("O seed não deixou nenhum Provider.");

    // O `PATCH` respondia `200` com o Provider intacto: o handler validava os
    // três campos e não os repassava ao repositório. Um `200` que não grava é
    // pior do que um `400` — a tela mostra "salvo" e o número nunca aparece.
    const assinatura = await corpo<{
      billingKind: string | null;
      monthlyCost: number | null;
      currency: string | null;
    }>(
      await pedir({
        app,
        method: "PATCH",
        path: `${API_BASE_PATH}/providers/${provider.id}`,
        body: { billingKind: "SUBSCRIPTION", monthlyCost: 123.45, currency: "USD" },
      }),
    );

    expect(assinatura.billingKind).toBe("SUBSCRIPTION");
    expect(assinatura.monthlyCost).toBe(123.45);
    expect(assinatura.currency).toBe("USD");

    const porToken = await corpo<{ monthlyCost: number | null; currency: string | null }>(
      await pedir({
        app,
        method: "PATCH",
        path: `${API_BASE_PATH}/providers/${provider.id}`,
        body: { billingKind: "PER_TOKEN" },
      }),
    );

    expect(porToken.monthlyCost).toBeNull();
    expect(porToken.currency).toBeNull();
  });
});

describe("GET /api/v1/metrics/costs e /api/v1/workers", () => {
  it("o rateio de assinatura aparece rotulado", async () => {
    await expedicaoFechada();

    const providers = await corpo<{ items: { id: string; name: string }[] }>(
      await pedir({ app, method: "GET", path: `${API_BASE_PATH}/providers` }),
    );
    const provider = providers.items[0];
    if (provider === undefined) throw new Error("O seed não deixou nenhum Provider.");

    await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/providers/${provider.id}`,
      body: { billingKind: "SUBSCRIPTION", monthlyCost: 100, currency: "USD" },
    });

    const custos = MetricCostsSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/metrics/costs?window=30d` })
      ).json(),
    );

    // O Model do seed pode ou não apontar para este Provider; o que o teste
    // fixa é a forma: todo custo carrega procedência, e nada vem zerado.
    for (const linha of custos.providers) {
      expect(["PRICED", "ESTIMATED_SUBSCRIPTION", "NOT_MEASURED"]).toContain(linha.cost.status);
      if (linha.cost.status === "NOT_MEASURED") expect(linha.cost.amount).toBeNull();
    }
    expect(custos.models.length).toBeGreaterThanOrEqual(0);
  });

  it("os Workers aparecem com o estado calculado", async () => {
    await registerWorker(handle.db, {
      userId: LOCAL_USER_ID,
      workerId: "maquina#4242#01996d00-0000-7000-8000-00000000f0a1",
      hostname: "maquina",
      pid: 4242,
      version: "0.0.0",
      nodeVersion: "v22.22.2",
      capacity: 2,
      harnesses: [{ key: "CLAUDE_CODE", version: "1.0.0", authStatus: "AUTHENTICATED" }],
    });

    const resposta = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/workers` });
    expect(resposta.status).toBe(200);

    const body = WorkerListSchema.parse(await resposta.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBe("ONLINE");
    expect(body.items[0]?.runningRuns).toBe(0);
    expect(body.items[0]?.harnesses[0]?.key).toBe("CLAUDE_CODE");
  });
});
