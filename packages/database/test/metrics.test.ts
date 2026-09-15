import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { createModel, listHarnesses } from "../src/harness.js";
import {
  loadPriceIndex,
  projectMetrics,
  rebuildMetrics,
  recomputeMetricDailyForModel,
} from "../src/metric-projector.js";
import {
  countRunMetrics,
  readMetricCosts,
  readMetricSeries,
  readMetricsOverview,
  readRunMetrics,
} from "../src/metrics.js";
import {
  listCurrentModelPrices,
  listModelPriceHistory,
  setModelPrice,
} from "../src/model-price.js";
import { createProvider, updateProvider } from "../src/provider.js";
import { appendRunEvent } from "../src/run-event.js";
import { createRun, transitionRun, writeRunTerminalStatus } from "../src/run.js";
import { metricDaily, runMetrics } from "../src/schema/metrics.js";
import {
  countWorkersByStatus,
  heartbeatWorker,
  listRunRowsWithDeadWorker,
  listWorkerPresence,
  markStaleWorkers,
  registerWorker,
  stopWorker,
} from "../src/worker.js";
import {
  criarEquipamento,
  criarProjectComWorkspace,
  criarTask,
  type Equipamento,
  exigirOk,
  limparExecucao,
  USER,
} from "./support.js";

/**
 * O projetor de métricas, a leitura e a presença de Worker (Fase 10A).
 *
 * Os Runs terminam pelas mesmas funções que a aplicação usa — nada de `INSERT`
 * direto em `run` —, então a massa respeita a máquina de estados e o
 * `finished_at` que o projetor lê é o que a produção escreve.
 */

let handle: DatabaseHandle;
let equipamento: Equipamento;
let projectId: string;

const REPO = "C:\\repos\\metricas";

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-metricas",
  });
});

beforeEach(async () => {
  await limparExecucao(handle);
  const project = await criarProjectComWorkspace(handle.db, {
    title: "Observabilidade",
    workspacePath: REPO,
  });
  projectId = project.id;
  equipamento = await criarEquipamento(handle.db, { nome: "de métricas" });
});

afterAll(async () => {
  await limparExecucao(handle);
  await handle.close();
});

interface RunTerminado {
  readonly runId: string;
  readonly taskId: string;
}

/**
 * Cria um Run, leva-o até `RUNNING`, grava os eventos pedidos e fecha.
 *
 * `usage` é uma lista de acumulados, como o harness os emite: o projetor
 * precisa exercitar exatamente essa semântica.
 */
async function rodar(input: {
  titulo: string;
  status?: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
  usage?: readonly { input: number; output: number; cacheRead?: number; cacheWrite?: number }[];
  tools?: readonly string[];
  modelKey?: string | null;
}): Promise<RunTerminado> {
  const task = await criarTask(handle.db, { projectId, title: input.titulo });
  const run = exigirOk(
    await createRun(handle.db, {
      userId: USER,
      taskId: task.id,
      loadoutId: equipamento.loadoutId,
    }),
    `a criação do Run de "${input.titulo}"`,
  );

  if (input.modelKey !== undefined) {
    await handle.pool.query("update run set model_key = $1 where id = $2", [
      input.modelKey,
      run.id,
    ]);
  }

  // `createRun` já deixa o Run em `QUEUED`: a fila **é** a tabela.
  for (const to of ["PREPARING", "RUNNING"] as const) {
    exigirOk(
      await transitionRun(handle.db, { userId: USER, runId: run.id, to }),
      `a transição do Run para ${to}`,
    );
  }

  for (const usage of input.usage ?? []) {
    await appendRunEvent(handle.db, {
      userId: USER,
      runId: run.id,
      event: {
        type: "Usage",
        payload: {
          type: "Usage",
          usage: {
            inputTokens: usage.input,
            outputTokens: usage.output,
            cacheReadInputTokens: usage.cacheRead ?? 0,
            cacheCreationInputTokens: usage.cacheWrite ?? 0,
          },
        },
      },
    });
  }

  for (const name of input.tools ?? []) {
    await appendRunEvent(handle.db, {
      userId: USER,
      runId: run.id,
      event: { type: "ToolCall", payload: { type: "ToolCall", name, arguments: "" } },
    });
  }

  exigirOk(
    await writeRunTerminalStatus(handle.db, {
      userId: USER,
      runId: run.id,
      status: input.status ?? "SUCCEEDED",
    }),
    "o fechamento do Run",
  );

  return { runId: run.id, taskId: task.id };
}

/** O projetor sem atraso de segurança: em teste não há commit fora de ordem para esperar. */
async function projetar(): Promise<{ runs: number; buckets: number }> {
  const relatorio = await projectMetrics(handle.db, { userId: USER, lagMs: 0 });
  expect(relatorio.error).toBeNull();
  expect(relatorio.ok).toBe(true);
  return { runs: relatorio.runs, buckets: relatorio.buckets };
}

describe("projeção de métricas", () => {
  it("uma Expedição terminal vira uma linha com tokens, ferramentas e duração", async () => {
    const { runId } = await rodar({
      titulo: "Medir o que foi feito",
      usage: [
        { input: 100, output: 10 },
        { input: 400, output: 60, cacheRead: 30, cacheWrite: 5 },
      ],
      tools: ["Bash", "mcp__knowledge__search_knowledge", "Read", "mcp__knowledge__get_item"],
    });

    const relatorio = await projetar();
    expect(relatorio.runs).toBe(1);

    const metrica = await readRunMetrics(handle.db, { userId: USER, runId });
    expect(metrica).not.toBeNull();
    // `Usage` é acumulado: vale o último, não a soma dos dois.
    expect(metrica?.tokens).toEqual({
      input: 400,
      output: 60,
      cacheRead: 30,
      cacheWrite: 5,
      total: 495,
      known: true,
    });
    expect(metrica?.status).toBe("SUCCEEDED");
    expect(metrica?.projectId).toBe(projectId);
    expect(metrica?.toolCalls).toEqual({
      total: 4,
      // Empate de contagem desempata pela chave, para a tabela não trocar de
      // ordem entre dois carregamentos do mesmo dado.
      byServer: [
        { server: "knowledge", calls: 2 },
        { server: "native", calls: 2 },
      ],
    });
    expect(metrica?.durationMs).not.toBeNull();
    expect(metrica?.queueMs).not.toBeNull();
    // Sem preço cadastrado, o custo não é zero: é "não medido".
    expect(metrica?.cost).toEqual({ status: "NOT_MEASURED", currency: null, amount: null });
  });

  it("um harness que não reporta tokens deixa nulo, e nunca zero", async () => {
    const { runId } = await rodar({ titulo: "Sem Usage" });
    await projetar();

    const metrica = await readRunMetrics(handle.db, { userId: USER, runId });
    expect(metrica?.tokens).toEqual({
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      total: null,
      known: false,
    });

    const overview = await readMetricsOverview(handle.db, {
      userId: USER,
      window: "7d",
      staleAfterMs: 30_000,
    });
    expect(overview.tokens.knownRuns).toBe(0);
    expect(overview.tokens.unknownRuns).toBe(1);
    expect(overview.notMeasuredRuns).toBe(1);
  });

  it("o cursor não reprocessa: o segundo passe não vê nada", async () => {
    await rodar({ titulo: "Primeira", usage: [{ input: 10, output: 1 }] });
    expect((await projetar()).runs).toBe(1);
    expect((await projetar()).runs).toBe(0);

    await rodar({ titulo: "Segunda", usage: [{ input: 20, output: 2 }] });
    expect((await projetar()).runs).toBe(1);
  });

  it("o rollup conta por desfecho e `ALL` é o total verdadeiro", async () => {
    await rodar({ titulo: "Vitória", usage: [{ input: 10, output: 1 }] });
    await rodar({ titulo: "Derrota", status: "FAILED" });
    await rodar({ titulo: "Desistência", status: "CANCELLED" });
    await projetar();

    const overview = await readMetricsOverview(handle.db, {
      userId: USER,
      window: "30d",
      staleAfterMs: 30_000,
    });

    expect(overview.runs.total).toBe(3);
    expect(overview.runs.succeeded).toBe(1);
    expect(overview.runs.failed).toBe(1);
    expect(overview.runs.cancelled).toBe(1);
    expect(overview.runs.successRate).toBeCloseTo(1 / 3, 6);
  });

  it("sem Run na janela, a taxa de sucesso é nula — e não zero", async () => {
    const overview = await readMetricsOverview(handle.db, {
      userId: USER,
      window: "7d",
      staleAfterMs: 30_000,
    });
    expect(overview.runs.total).toBe(0);
    expect(overview.runs.successRate).toBeNull();
    expect(overview.duration.averageMs).toBeNull();
    expect(overview.duration.p95Ms).toBeNull();
    expect(overview.costs).toEqual([]);
  });

  it("a série vem contínua: todo dia da janela tem ponto", async () => {
    await rodar({ titulo: "Um dia", usage: [{ input: 10, output: 1 }] });
    await projetar();

    const serie = await readMetricSeries(handle.db, {
      userId: USER,
      metric: "runs",
      dimension: "ALL",
      window: "7d",
    });

    expect(serie.series).toHaveLength(1);
    expect(serie.series[0]?.points).toHaveLength(7);
    expect(serie.series[0]?.total).toBe(1);
    expect(serie.unit).toBe("runs");
  });

  it("a série por Harness resolve o nome atual do cadastro", async () => {
    await rodar({ titulo: "Por guilda", usage: [{ input: 10, output: 1 }] });
    await projetar();

    const serie = await readMetricSeries(handle.db, {
      userId: USER,
      metric: "tokens",
      dimension: "HARNESS",
      window: "7d",
    });

    expect(serie.series[0]?.key).toBe("CLAUDE_CODE");
    expect(serie.series[0]?.label).not.toBe("CLAUDE_CODE");
    expect(serie.series[0]?.total).toBe(11);
  });

  it("`rebuild` reproduz exatamente as mesmas linhas", async () => {
    await rodar({
      titulo: "Reprodutível A",
      usage: [{ input: 100, output: 10 }],
      tools: ["Bash"],
    });
    await rodar({ titulo: "Reprodutível B", status: "FAILED" });
    await projetar();

    const antes = await snapshotMetricas();
    expect(antes.runs).toHaveLength(2);
    expect(antes.daily.length).toBeGreaterThan(0);

    const relatorio = await rebuildMetrics(handle.db, { userId: USER, lagMs: 0 });
    expect(relatorio.ok).toBe(true);
    expect(relatorio.runs).toBe(2);

    const depois = await snapshotMetricas();
    expect(depois.runs).toEqual(antes.runs);
    expect(depois.daily).toEqual(antes.daily);
  });
});

/**
 * As linhas que importam, sem os carimbos de gravação.
 *
 * `projected_at` e `updated_at` mudam por definição num rebuild; compará-los
 * transformaria o teste de "reproduz" num teste de relógio.
 */
async function snapshotMetricas(): Promise<{
  runs: unknown[];
  daily: unknown[];
}> {
  const runs = await handle.db
    .select()
    .from(runMetrics)
    .where(eq(runMetrics.userId, USER))
    .orderBy(runMetrics.runId);

  const daily = await handle.db
    .select()
    .from(metricDaily)
    .where(eq(metricDaily.userId, USER))
    .orderBy(metricDaily.day, metricDaily.dimension, metricDaily.dimensionKey);

  return {
    runs: runs.map(({ projectedAt: _p, ...resto }) => resto),
    daily: daily.map(({ updatedAt: _u, ...resto }) => resto),
  };
}

describe("custo", () => {
  async function criarModelComPreco(input: {
    key: string;
    providerId?: string;
  }): Promise<{ modelId: string }> {
    const model = exigirOk(
      await createModel(handle.db, {
        userId: USER,
        harnessId: equipamento.harnessId,
        key: input.key,
        name: `Modelo ${input.key}`,
        ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
      }),
      "a criação do Model",
    );
    return { modelId: model.id };
  }

  it("um preço novo muda o custo de Runs já projetados", async () => {
    const { modelId } = await criarModelComPreco({ key: "sonnet-teste" });
    const { runId } = await rodar({
      titulo: "Com preço",
      modelKey: "sonnet-teste",
      usage: [{ input: 1_000_000, output: 100_000 }],
    });
    await projetar();

    const semPreco = await readRunMetrics(handle.db, { userId: USER, runId });
    expect(semPreco?.cost.status).toBe("NOT_MEASURED");

    const preco = exigirOk(
      await setModelPrice(handle.db, {
        userId: USER,
        modelId,
        currency: "USD",
        inputPerMillion: 3,
        outputPerMillion: 15,
        effectiveFrom: new Date(Date.now() - 86_400_000),
      }),
      "o cadastro do preço",
    );
    expect(preco.currency).toBe("USD");

    const comPreco = await readRunMetrics(handle.db, { userId: USER, runId });
    // 1 M de entrada a 3 + 0,1 M de saída a 15 = 3 + 1,5 = 4,5
    expect(comPreco?.cost).toEqual({ status: "PRICED", currency: "USD", amount: 4.5 });

    // E o rollup acompanhou, sem precisar de reconstrução.
    const overview = await readMetricsOverview(handle.db, {
      userId: USER,
      window: "7d",
      staleAfterMs: 30_000,
    });
    expect(overview.costs).toEqual([{ status: "PRICED", currency: "USD", amount: 4.5 }]);
    expect(overview.notMeasuredRuns).toBe(0);
  });

  it("o histórico é append-only: um preço novo fecha a vigência anterior", async () => {
    const { modelId } = await criarModelComPreco({ key: "codex-teste" });

    await setModelPrice(handle.db, {
      userId: USER,
      modelId,
      currency: "USD",
      inputPerMillion: 1,
      outputPerMillion: 2,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    });
    await setModelPrice(handle.db, {
      userId: USER,
      modelId,
      currency: "USD",
      inputPerMillion: 2,
      outputPerMillion: 4,
      effectiveFrom: new Date(Date.UTC(2026, 6, 1)),
    });

    const historico = await listModelPriceHistory(handle.db, { userId: USER, modelId });
    expect(historico).toHaveLength(2);
    expect(historico[0]?.effectiveTo).toBeNull();
    expect(historico[1]?.effectiveTo).toBe(new Date(Date.UTC(2026, 6, 1)).toISOString());

    const correntes = await listCurrentModelPrices(handle.db, { userId: USER });
    expect(correntes.filter((preco) => preco.modelId === modelId)).toHaveLength(1);
  });

  it("uma vigência que não começa depois da atual é recusada", async () => {
    const { modelId } = await criarModelComPreco({ key: "pi-teste" });
    const inicio = new Date(Date.UTC(2026, 5, 1));

    await setModelPrice(handle.db, {
      userId: USER,
      modelId,
      currency: "USD",
      inputPerMillion: 1,
      outputPerMillion: 2,
      effectiveFrom: inicio,
    });

    const recusado = await setModelPrice(handle.db, {
      userId: USER,
      modelId,
      currency: "USD",
      inputPerMillion: 9,
      outputPerMillion: 9,
      effectiveFrom: inicio,
    });

    expect(recusado?.ok).toBe(false);
    if (recusado !== null && !recusado.ok) {
      expect(recusado.failure).toBe("EFFECTIVE_FROM_NOT_AFTER_CURRENT");
    }
  });

  it("um Provider por assinatura rateia a mensalidade pela fatia de tokens do mês", async () => {
    const provider = exigirOk(
      await createProvider(handle.db, {
        userId: USER,
        name: "Provedor de Assinatura",
        kind: "SUBSCRIPTION",
      }),
      "a criação do Provider",
    );

    await criarModelComPreco({ key: "assinado", providerId: provider.id });

    await rodar({
      titulo: "Assinatura",
      modelKey: "assinado",
      usage: [{ input: 600, output: 400 }],
    });
    await projetar();

    exigirOk(
      await updateProvider(handle.db, {
        userId: USER,
        providerId: provider.id,
        patch: { billingKind: "SUBSCRIPTION", monthlyCost: 200, currency: "USD" },
      }),
      "a marcação de assinatura",
    );

    const custos = await readMetricCosts(handle.db, { userId: USER, window: "30d" });
    const doProvider = custos.providers.find((linha) => linha.providerId === provider.id);

    expect(doProvider?.cost.status).toBe("ESTIMATED_SUBSCRIPTION");
    expect(doProvider?.cost.currency).toBe("USD");
    // Único Provider com tokens no mês: a fatia é inteira, e o rateio dá a
    // mensalidade toda — que é o que de fato se paga.
    expect(doProvider?.cost.amount).toBe(200);
    // A janela de 30 dias cruza dois meses civis; os tokens estão no de hoje.
    const mesCorrente = new Date().toISOString().slice(0, 7);
    expect(doProvider?.months.find((mes) => mes.month === mesCorrente)?.windowTokens).toBe(1_000);
    expect(custos.totals).toEqual([
      { status: "ESTIMATED_SUBSCRIPTION", currency: "USD", amount: 200 },
    ]);
  });

  it("sair de `SUBSCRIPTION` leva a mensalidade junto", async () => {
    const provider = exigirOk(
      await createProvider(handle.db, { userId: USER, name: "Vai e volta", kind: "API_KEY" }),
      "a criação do Provider",
    );

    exigirOk(
      await updateProvider(handle.db, {
        userId: USER,
        providerId: provider.id,
        patch: { billingKind: "SUBSCRIPTION", monthlyCost: 50, currency: "BRL" },
      }),
      "a marcação de assinatura",
    );

    const depois = exigirOk(
      await updateProvider(handle.db, {
        userId: USER,
        providerId: provider.id,
        patch: { billingKind: "PER_TOKEN" },
      }),
      "a troca para cobrança por token",
    );

    expect(depois.billingKind).toBe("PER_TOKEN");
    expect(depois.monthlyCost).toBeNull();
    expect(depois.currency).toBeNull();
  });

  it("o índice de preços casa Model pela chave dentro do Harness", async () => {
    const { modelId } = await criarModelComPreco({ key: "indexado" });
    await setModelPrice(handle.db, {
      userId: USER,
      modelId,
      currency: "USD",
      inputPerMillion: 5,
      outputPerMillion: 5,
    });

    const harness = (await listHarnesses(handle.db, { userId: USER })).find(
      (linha) => linha.key === "CLAUDE_CODE",
    );
    const indice = await loadPriceIndex(handle.db, { userId: USER });
    expect(indice.get(`${harness?.key ?? ""}|indexado`)).toHaveLength(1);

    // Sem Run daquele Model, o recálculo não tem dia para refazer.
    expect(
      await recomputeMetricDailyForModel(handle.db, {
        userId: USER,
        harnessKey: "CLAUDE_CODE",
        modelKey: "indexado",
      }),
    ).toBe(0);
  });
});

describe("presença de Worker", () => {
  const WORKER_A = "maquina#1001#01996d00-0000-7000-8000-00000000f001";
  const WORKER_B = "maquina#1002#01996d00-0000-7000-8000-00000000f002";

  async function registrar(id: string): Promise<void> {
    await registerWorker(handle.db, {
      userId: USER,
      workerId: id,
      hostname: "maquina",
      pid: Number(id.split("#")[1] ?? "1"),
      version: "0.0.0",
      nodeVersion: "v22.22.2",
      capacity: 2,
      harnesses: [{ key: "CLAUDE_CODE", version: "1.0.0", authStatus: "AUTHENTICATED" }],
    });
  }

  it("o estado é calculado na leitura, e o silêncio vira `STALE`", async () => {
    await registrar(WORKER_A);

    const vivos = await listWorkerPresence(handle.db, { userId: USER, staleAfterMs: 30_000 });
    expect(vivos).toHaveLength(1);
    expect(vivos[0]?.status).toBe("ONLINE");
    expect(vivos[0]?.harnesses[0]?.key).toBe("CLAUDE_CODE");

    const futuro = new Date(Date.now() + 120_000);
    const silenciosos = await listWorkerPresence(handle.db, {
      userId: USER,
      staleAfterMs: 30_000,
      now: futuro,
    });
    expect(silenciosos[0]?.status).toBe("STALE");

    await stopWorker(handle.db, { userId: USER, workerId: WORKER_A });
    const parados = await listWorkerPresence(handle.db, { userId: USER, staleAfterMs: 30_000 });
    expect(parados[0]?.status).toBe("OFFLINE");
  });

  it("`worker.stale` é anunciado uma vez só, e a volta do batimento é anunciada", async () => {
    await registrar(WORKER_A);

    const futuro = new Date(Date.now() + 120_000);
    const primeira = await markStaleWorkers(handle.db, {
      userId: USER,
      staleAfterMs: 30_000,
      now: futuro,
    });
    expect(primeira.map((worker) => worker.id)).toEqual([WORKER_A]);

    const segunda = await markStaleWorkers(handle.db, {
      userId: USER,
      staleAfterMs: 30_000,
      now: futuro,
    });
    expect(segunda).toEqual([]);

    // Voltou a bater: a marca cai e a ressurreição é anunciada.
    expect(await heartbeatWorker(handle.db, { userId: USER, workerId: WORKER_A })).toBe(true);
    expect(await heartbeatWorker(handle.db, { userId: USER, workerId: WORKER_A })).toBe(false);

    const eventos = await handle.pool.query<{ type: string }>(
      "select type from dashboard_event where user_id = $1 and type like 'worker.%' order by sequence",
      [USER],
    );
    expect(eventos.rows.map((linha) => linha.type)).toEqual([
      "worker.online",
      "worker.stale",
      "worker.online",
    ]);
  });

  it("um Worker vivo nunca perde um Run para outro que sobe", async () => {
    await registrar(WORKER_A);
    await registrar(WORKER_B);

    const task = await criarTask(handle.db, { projectId, title: "Em execução" });
    const run = exigirOk(
      await createRun(handle.db, {
        userId: USER,
        taskId: task.id,
        loadoutId: equipamento.loadoutId,
      }),
      "a criação do Run",
    );
    // `createRun` já deixa o Run em `QUEUED`: a fila **é** a tabela.
    for (const to of ["PREPARING", "RUNNING"] as const) {
      exigirOk(
        await transitionRun(handle.db, { userId: USER, runId: run.id, to }),
        `a transição para ${to}`,
      );
    }
    await handle.pool.query("update run set claimed_by = $1 where id = $2", [WORKER_A, run.id]);

    // O Worker B varre e não encontra órfão: o A está batendo.
    expect(
      await listRunRowsWithDeadWorker(handle.db, {
        userId: USER,
        workerId: WORKER_B,
        staleAfterMs: 30_000,
      }),
    ).toEqual([]);

    // Três intervalos depois, o A é órfão e o Run aparece para o B.
    const orfaos = await listRunRowsWithDeadWorker(handle.db, {
      userId: USER,
      workerId: WORKER_B,
      staleAfterMs: 30_000,
      now: new Date(Date.now() + 120_000),
    });
    expect(orfaos.map((linha) => ({ id: linha.run.id, reason: linha.reason }))).toEqual([
      { id: run.id, reason: "WORKER_STALE" },
    ]);
  });

  it("um Run reclamado por um Worker sem linha continua sendo órfão", async () => {
    await registrar(WORKER_B);

    const task = await criarTask(handle.db, { projectId, title: "Antes da migração" });
    const run = exigirOk(
      await createRun(handle.db, {
        userId: USER,
        taskId: task.id,
        loadoutId: equipamento.loadoutId,
      }),
      "a criação do Run",
    );
    exigirOk(
      await transitionRun(handle.db, { userId: USER, runId: run.id, to: "PREPARING" }),
      "a transição para PREPARING",
    );
    await handle.pool.query("update run set claimed_by = $1 where id = $2", [
      "outra-maquina#7#velho",
      run.id,
    ]);

    const orfaos = await listRunRowsWithDeadWorker(handle.db, {
      userId: USER,
      workerId: WORKER_B,
      staleAfterMs: 30_000,
    });
    expect(orfaos.map((linha) => ({ id: linha.run.id, reason: linha.reason }))).toEqual([
      { id: run.id, reason: "NO_WORKER_ROW" },
    ]);
  });

  it("os tiles contam Workers por estado", async () => {
    await registrar(WORKER_A);
    await registrar(WORKER_B);
    await stopWorker(handle.db, { userId: USER, workerId: WORKER_B });

    expect(await countWorkersByStatus(handle.db, { userId: USER, staleAfterMs: 30_000 })).toEqual({
      online: 1,
      stale: 0,
      offline: 1,
    });

    const overview = await readMetricsOverview(handle.db, {
      userId: USER,
      window: "7d",
      staleAfterMs: 30_000,
    });
    expect(overview.workers).toEqual({ online: 1, stale: 0, offline: 1 });
  });
});

describe("contagem de apoio", () => {
  it("conta linhas de projeção, para o operador conferir um rebuild", async () => {
    await rodar({ titulo: "Contar", usage: [{ input: 5, output: 5 }] });
    await projetar();

    const contagem = await countRunMetrics(handle.db, { userId: USER });
    expect(contagem.runs).toBe(1);
    expect(contagem.buckets).toBeGreaterThan(0);

    const daily = await handle.db
      .select()
      .from(metricDaily)
      .where(and(eq(metricDaily.userId, USER), eq(metricDaily.dimension, "ALL")));
    expect(daily).toHaveLength(1);
    expect(daily[0]?.dimensionKey).toBe("ALL");
  });
});
