import {
  MetricCostsQuerySchema,
  MetricCostsSchema,
  MetricSeriesQuerySchema,
  MetricSeriesSchema,
  MetricsOverviewQuerySchema,
  MetricsOverviewSchema,
  ModelPriceListSchema,
  ModelPriceSchema,
  ProblemDetailsSchema,
  RunMetricsSchema,
  SetModelPriceSchema,
  WorkerListSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

/**
 * As rotas da observabilidade avançada (planejamento v0.4, Fase 10A).
 *
 * Todas são **leitura de projeção**, exceto o cadastro de preço: `run_metric` e
 * `metric_daily` são mantidos pelo projetor do Worker e podem ser reconstruídos
 * do zero. Nenhuma delas alcança a execução de um Run.
 *
 * Os nomes de schema são nomeados na spec (`.meta({ id })` em
 * `packages/contracts`), e não anônimos: um `Schema1` no cliente gerado é um
 * tipo que ninguém consegue procurar, e foi a pendência que as fases
 * anteriores deixaram.
 */

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

const IdParamSchema = z.object({ id: z.uuid().describe("UUIDv7 do recurso.") });

export const metricsOverviewRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/metrics/overview`,
  tags: ["metrics"],
  summary: "Os tiles da janela",
  description:
    "Runs por desfecho, tokens, duração média e p95, custo por moeda, disjuntores " +
    "abertos e Workers por estado. O custo nunca vem zerado por ausência: sem preço, " +
    "sem assinatura ou sem tokens reportados, ele sai `NOT_MEASURED` com `amount` nulo " +
    "e a contagem de Runs em `notMeasuredRuns`. Com `projectId`, o rateio de assinatura " +
    "fica de fora — `metric_daily` não tem dimensão cruzada Project × Provider, e " +
    "atribuir a mensalidade pela fatia do Provider inteiro seria um número que não é " +
    "de ninguém.",
  request: { query: MetricsOverviewQuerySchema },
  responses: {
    200: {
      description: "Os tiles da janela.",
      content: { "application/json": { schema: MetricsOverviewSchema } },
    },
    400: problem("Janela ou filtro inválido."),
  },
});

export const metricsSeriesRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/metrics/series`,
  tags: ["metrics"],
  summary: "Pontos por dia, por dimensão",
  description:
    "Um ponto por dia da janela, **inclusive nos dias sem Run**: uma série que pula " +
    "os dias vazios desenha uma inclinação que não existiu. Zero aqui é um fato — " +
    "'nenhum Run neste dia' —, ao contrário do custo, onde zero seria mentira: a série " +
    "de custo existe dentro de **uma** moeda, e os Runs sem preço ficam fora dela.",
  request: { query: MetricSeriesQuerySchema },
  responses: {
    200: {
      description: "A série, das linhas de maior soma para as de menor.",
      content: { "application/json": { schema: MetricSeriesSchema } },
    },
    400: problem("Métrica, dimensão ou janela inválida."),
  },
});

export const metricsCostsRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/metrics/costs`,
  tags: ["metrics"],
  summary: "Custo por Provider e por Model",
  description:
    "Um Provider `PER_TOKEN` soma os preços vigentes na data de cada Run. Um " +
    "`SUBSCRIPTION` com `monthlyCost` recebe o rateio da mensalidade pela fatia de " +
    "tokens dele no mês civil UTC, mês a mês, e sai rotulado " +
    "`ESTIMATED_SUBSCRIPTION` — nunca as duas coisas somadas, que contariam o mesmo " +
    "gasto duas vezes. `totals` traz uma entrada por moeda; moedas diferentes não se " +
    "somam, porque converter exigiria uma taxa de câmbio que o sistema não tem.",
  request: { query: MetricCostsQuerySchema },
  responses: {
    200: {
      description: "Custos da janela, com a procedência de cada número.",
      content: { "application/json": { schema: MetricCostsSchema } },
    },
    400: problem("Janela inválida."),
  },
});

export const projectMetricsRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/projects/{id}/metrics`,
  tags: ["metrics"],
  summary: "Os tiles de um Project",
  description:
    "O mesmo recorte de `/metrics/overview`, restrito a um Project. Os baldes são " +
    "recalculados a partir de `run_metric` pela mesma função pura do projetor: o que " +
    "muda é de onde as linhas vêm, não como são somadas.",
  request: {
    params: IdParamSchema,
    query: MetricsOverviewQuerySchema.omit({ projectId: true }),
  },
  responses: {
    200: {
      description: "Os tiles do Project.",
      content: { "application/json": { schema: MetricsOverviewSchema } },
    },
    400: problem("Janela inválida."),
    404: problem("Não existe Project com este id."),
  },
});

export const runMetricsRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/runs/{id}/metrics`,
  tags: ["metrics"],
  summary: "A quebra de uma Expedição",
  description:
    "Tokens, contexto montado contra tokens de entrada, chamadas de ferramenta por " +
    "servidor MCP, passos por tipo, aprovações por quem decidiu, filhos delegados e o " +
    "custo com procedência. Só existe depois de o Run terminar **e** o projetor passar: " +
    "antes disso é `404`, porque `run_metric` só tem Expedição acabada.",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "A quebra do Run.",
      content: { "application/json": { schema: RunMetricsSchema } },
    },
    404: problem("Não existe métrica para este Run: ele não terminou ou ainda não foi projetado."),
  },
});

// --------------------------------------------------------------------------
// Preço de Model
// --------------------------------------------------------------------------

export const modelPricesListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/model-prices`,
  tags: ["metrics"],
  summary: "As vigências correntes de preço",
  description: "Uma por Model que tem preço cadastrado, em ordem de nome de Model.",
  responses: {
    200: {
      description: "Os preços vigentes.",
      content: { "application/json": { schema: ModelPriceListSchema } },
    },
  },
});

export const modelPriceSetRoute = createRoute({
  method: "put",
  path: `${API_BASE_PATH}/models/{id}/price`,
  tags: ["metrics"],
  summary: "Abre uma vigência de preço",
  description:
    "O histórico é append-only: a vigência corrente é **fechada** e uma nova é aberta. " +
    "Sobrescrever a linha faria o custo de março mudar sozinho no dia de um reajuste " +
    "em abril. Gravar um preço recalcula o rollup dos dias em que aquele Model " +
    "apareceu, para a tela não continuar mostrando `NOT_MEASURED` no que acabou de " +
    "ganhar preço.",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: SetModelPriceSchema } } },
  },
  responses: {
    200: {
      description: "A vigência aberta.",
      content: { "application/json": { schema: ModelPriceSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Model com este id."),
    409: problem("A vigência nova precisa começar depois do início da corrente."),
  },
});

export const modelPriceHistoryRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/models/{id}/prices`,
  tags: ["metrics"],
  summary: "O histórico de preço de um Model",
  description: "Da vigência mais recente para a mais antiga. A corrente tem `effectiveTo` nulo.",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "O histórico.",
      content: { "application/json": { schema: ModelPriceListSchema } },
    },
    404: problem("Não existe Model com este id."),
  },
});

// --------------------------------------------------------------------------
// Presença de Worker
// --------------------------------------------------------------------------

export const workersListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/workers`,
  tags: ["metrics"],
  summary: "Os Workers conhecidos",
  description:
    "`status` é calculado na leitura, e não é coluna: gravá-lo exigiria alguém " +
    "escrevendo `STALE` no segundo exato em que o prazo vence. `ONLINE` bateu dentro " +
    "do prazo, `STALE` não bate há mais de três intervalos e não se despediu, e " +
    "`OFFLINE` desligou graciosamente. `runningRuns` conta o que cada um ainda " +
    "segura — inclusive um morto, e é justamente esse número que a reconciliação zera.",
  responses: {
    200: {
      description: "Os Workers, dos vivos para os desligados.",
      content: { "application/json": { schema: WorkerListSchema } },
    },
  },
});
