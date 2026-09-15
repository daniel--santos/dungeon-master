import { dnd, plain } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { seedMetrics, setTheme } from "./helpers";

/**
 * A observabilidade avançada de ponta a ponta (Fase 10B), sem Worker no ar.
 *
 * A fixture `seedMetrics` escreve o que o projetor escreveria — `run_metric` e
 * o rollup diário derivado dele —, e **de propósito não semeia custo nenhum**.
 * É isso que deixa a suíte provar o caminho que importa: a tela abre dizendo
 * "não medido", alguém cadastra um preço em Settings, a API recalcula o rollup
 * dos dias daquele Model, e o mesmo tile passa a dizer "preço vigente" com o
 * número. Um painel que mostrasse zero no primeiro passo passaria neste teste
 * sem nunca ter medido nada.
 *
 * O arquivo se chama `observability` (a rota é `/observability`), e a ordem
 * alfabética o coloca depois de `hall.spec` — que precisa contar as cartas do
 * catálogo antes de qualquer Campanha existir.
 */

const WINDOW_LABEL = dnd["metrics.window"];

/** Um diretório que existe na máquina que roda a API. */
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Quantos dias atrás a vigência de preço começa. Antes da Expedição mais velha. */
const DIAS_ANTES_DA_VIGENCIA = 10;

/** Um dia UTC no formato do campo de data, `YYYY-MM-DD`. */
function diaUtc(diasAtras: number): string {
  return new Date(Date.now() - diasAtras * 86_400_000).toISOString().slice(0, 10);
}

interface Cenario {
  readonly projectId: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly runIds: readonly string[];
  /** O Run com contexto, ferramentas e Selos: é o que a aba do cockpit abre. */
  readonly ricoRunId: string;
  /** O Run sem tokens reportados. */
  readonly mudoRunId: string;
}

async function criar<T extends { id: string }>(
  request: APIRequestContext,
  path: string,
  data: unknown,
): Promise<T> {
  const response = await request.post(path, { data });
  expect(response.ok(), `${path}: ${String(response.status())}`).toBe(true);
  return (await response.json()) as T;
}

/** Abre um `Select` do Radix e escolhe a opção pelo nome. */
async function escolher(page: Page, rotulo: string, opcao: RegExp | string): Promise<void> {
  await page.getByLabel(rotulo, { exact: true }).first().click();
  await page.getByRole("option", { name: opcao }).click();
}

/**
 * Campanha, Herói, Equipamento com Patrono, quatro Missões e quatro
 * Expedições pela API; depois a fixture, que as leva a desfecho e as mede.
 *
 * O Patrono importa: sem `model_key` no Run não existe dimensão `MODEL`, e
 * cadastrar preço não mudaria custo nenhum — o teste passaria sem provar nada.
 */
async function prepararCenario(request: APIRequestContext, sufixo: string): Promise<Cenario> {
  const project = await criar<{ id: string }>(request, "/api/v1/projects", {
    title: `Campanha da Torre ${sufixo}`,
  });
  // Sem workspace a partida é recusada com `409`: o Run precisa de um diretório
  // que exista na máquina que roda a API.
  const workspace = await request.patch(`/api/v1/projects/${project.id}`, {
    data: { workspacePath: WORKSPACE },
  });
  expect(workspace.ok()).toBe(true);

  const harnesses = await request.get("/api/v1/harnesses");
  const harnessItems = (
    (await harnesses.json()) as { items: { id: string; key: string; enabled: boolean }[] }
  ).items;
  const harness =
    harnessItems.find((item) => item.key === "CLAUDE_CODE" && item.enabled) ??
    harnessItems.find((item) => item.enabled);
  expect(harness).toBeDefined();

  // O Patronato e o Patrono são criados aqui, e não tirados do `db:seed`: o
  // seed não traz Model nenhum, e sem `model_key` no Run não existe dimensão
  // `MODEL` — cadastrar preço não mudaria custo algum e o teste passaria sem
  // provar nada.
  const provider = await criar<{ id: string }>(request, "/api/v1/providers", {
    name: `Patronato da Torre ${sufixo}`,
    kind: "API_KEY",
    authEnvKeys: ["DM_E2E_TORRE_KEY"],
    harnessKeys: ["CLAUDE_CODE"],
  });
  const modelName = `Patrono da Torre ${sufixo}`;
  const model = await criar<{ id: string }>(request, "/api/v1/models", {
    harnessId: harness?.id,
    providerId: provider.id,
    key: `torre-${sufixo}`,
    name: modelName,
  });

  const profiles = await request.get("/api/v1/execution-profiles");
  const profile = (
    (await profiles.json()) as { items: { id: string; mode: string; enabled: boolean }[] }
  ).items.find((item) => item.mode === "HOST" && item.enabled);
  expect(profile).toBeDefined();

  const agent = await criar<{ id: string }>(request, "/api/v1/agents", {
    name: `Vigia da Torre ${sufixo}`,
    role: "EXPLORER",
    instructions: "Observa e anota o que mede.",
  });
  const loadout = await criar<{ id: string }>(request, "/api/v1/loadouts", {
    name: `Luneta da Torre ${sufixo}`,
    agentId: agent.id,
    harnessId: harness?.id,
    modelId: model.id,
    executionProfileId: profile?.id,
  });

  const kinds = ["BUG", "FEATURE", "RESEARCH", "CHORE"] as const;
  const runIds: string[] = [];

  for (const [posicao, kind] of kinds.entries()) {
    const task = await criar<{ id: string }>(request, "/api/v1/tasks", {
      projectId: project.id,
      title: `Medir o que passou ${String(posicao)} ${sufixo}`,
      kind,
    });
    const run = await criar<{ id: string }>(request, `/api/v1/tasks/${task.id}/runs`, {
      loadoutId: loadout.id,
    });
    runIds.push(run.id);
  }

  const [rico, mudo, falho, velho] = runIds as [string, string, string, string];

  await seedMetrics({
    runs: [
      {
        runId: rico,
        status: "SUCCEEDED",
        daysAgo: 0,
        durationMs: 95_000,
        queueMs: 4_000,
        tokens: { input: 120_000, output: 8_000, cacheRead: 40_000, cacheWrite: 2_000 },
        context: { estimatedTokens: 5_400, items: 9, sections: 4, truncations: 1 },
        toolCallsByServer: { native: 12, knowledge: 3 },
        stepsByType: { AGENT: 2, VALIDATION: 1 },
        gates: { user: 1, policy: 2 },
        childrenDelegated: 1,
      },
      // Sem `Usage`: os tokens dele não entram como zero em lugar nenhum.
      { runId: mudo, status: "SUCCEEDED", daysAgo: 1, durationMs: 20_000, tokens: null },
      {
        runId: falho,
        status: "FAILED",
        daysAgo: 2,
        durationMs: 8_000,
        tokens: { input: 3_000, output: 500 },
      },
      {
        runId: velho,
        status: "SUCCEEDED",
        daysAgo: 4,
        durationMs: 300_000,
        tokens: { input: 60_000, output: 4_000 },
      },
    ],
    workers: { suffix: sufixo, staleMinutes: 45 },
  });

  return {
    projectId: project.id,
    modelId: model.id,
    modelName,
    runIds,
    ricoRunId: rico,
    mudoRunId: mudo,
  };
}

test("a observabilidade: tiles honestos, janela, dimensão, Workers, preço e os dois temas", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const cenario = await prepararCenario(request, sufixo);

  // ------------------------------------------------------------ os tiles
  await page.goto("/observability?window=7d");
  await expect(
    page.getByRole("heading", { level: 1, name: dnd["nav.observability"] }),
  ).toBeVisible();

  const tiles = page.locator("[data-metrics-tiles]");
  await expect(tiles).toHaveAttribute("data-metrics-tiles", "7d");
  await expect(page.locator("[data-metrics-runs]")).toHaveAttribute("data-metrics-runs", "4");
  // Três vitórias em quatro: a taxa vem do servidor, não da tela.
  await expect(page.locator("[data-metrics-success-rate]")).toHaveAttribute(
    "data-metrics-success-rate",
    "0.75",
  );

  // Tokens: três das quatro Expedições reportaram, e o denominador aparece.
  await expect(page.locator("[data-metrics-tokens-measured]")).toHaveAttribute(
    "data-metrics-tokens-measured",
    "3",
  );
  await expect(page.locator("[data-metrics-tokens-measured]")).toContainText("3");
  await expect(page.locator("[data-metrics-tokens-measured]")).toContainText("4");

  // Custo: nada precificado ainda. A API manda uma entrada `NOT_MEASURED` com
  // `amount` nulo, e a tela desenha o travessão com o rótulo do status — nunca
  // um zero, que fecharia a conta errada para baixo sem nenhum sinal.
  await expect(page.locator('[data-cost-status="NOT_MEASURED"]').first()).toBeVisible();
  await expect(page.getByText(dnd["metrics.cost.status.notMeasured"]).first()).toBeVisible();
  await expect(page.locator('[data-cost-status="PRICED"]')).toHaveCount(0);
  await expect(page.locator("[data-cost-not-measured]")).toContainText("4");

  // ------------------------------------------------------- Workers
  const workers = page.locator("[data-metrics-workers]");
  await expect(workers).toBeVisible();
  await expect(page.locator('[data-worker-status="ONLINE"]')).toHaveCount(1);
  await expect(page.locator('[data-worker-status="STALE"]')).toHaveCount(1);
  await expect(page.locator('[data-worker-status="STALE"]')).toContainText(
    dnd["metrics.worker.status.stale"],
  );

  // --------------------------------------------------- troca de janela
  await escolher(page, WINDOW_LABEL, dnd["metrics.window.d30"]);
  await expect(page).toHaveURL(/window=30d/);
  await expect(tiles).toHaveAttribute("data-metrics-tiles", "30d");

  // ------------------------------------------------- série e dimensão
  await expect(page.locator("[data-metrics-series]")).toHaveAttribute(
    "data-metrics-series",
    "runs",
  );
  await expect(page.locator('[data-metrics-breakdown="ALL"]')).toBeVisible();

  await escolher(page, dnd["metrics.series.dimension"], dnd["metrics.dimension.taskKind"]);
  await expect(page).toHaveURL(/dimension=TASK_KIND/);
  await expect(page.locator('[data-metrics-breakdown="TASK_KIND"]')).toBeVisible();
  // As chaves de enum são traduzidas pelo glossário, e não pela API.
  await expect(page.locator('[data-breakdown-key="BUG"]')).toContainText(
    dnd["entity.task.kind.bug"],
  );
  await expect(page.locator("[data-breakdown-key]")).toHaveCount(4);

  // A tabela equivalente do gráfico existe, e é uma tabela de verdade.
  await expect(page.locator("[data-metrics-series-table]")).toBeVisible();

  // -------------------------------------------------- o preço em Settings
  await page.goto("/settings");
  const prices = page.locator("[data-settings-prices]");
  await expect(prices).toBeVisible();
  await prices.scrollIntoViewIfNeeded();

  await page.locator(`[data-model-price-open="${cenario.modelId}"]`).click();
  const dialog = page.locator("[data-model-price-dialog]");
  await expect(dialog).toBeVisible();
  // Este Patrono nunca teve preço: o histórico diz isso, em vez de vir vazio.
  await expect(dialog.getByText(dnd["settings.prices.history.empty"])).toBeVisible();

  await dialog.locator('[data-model-price-field="input"]').fill("3");
  await dialog.locator('[data-model-price-field="output"]').fill("15");
  // A vigência começa antes da Expedição mais velha da janela. Sem isso o
  // preço valeria só de agora em diante, e o custo do que já passou
  // continuaria — corretamente — não medido: o preço de um Run é o vigente na
  // data dele, e não o último cadastrado.
  await dialog
    .locator('[data-model-price-field="effective-from"]')
    .fill(diaUtc(DIAS_ANTES_DA_VIGENCIA));
  await dialog.locator("[data-model-price-save]").click();
  await expect(dialog).toBeHidden();

  // O histórico agora tem a vigência corrente.
  await page.locator(`[data-model-price-open="${cenario.modelId}"]`).click();
  await expect(page.locator("[data-model-price-history]")).toBeVisible();
  await expect(page.getByText(dnd["settings.prices.history.current"])).toBeVisible();
  await page.keyboard.press("Escape");

  // ------------------------------- o custo deixa de ser "não medido"
  await page.goto("/observability?window=30d");
  await expect(page.locator('[data-cost-status="PRICED"]').first()).toBeVisible();
  await expect(page.locator('[data-cost-currency="USD"]').first()).toBeVisible();
  await expect(page.getByText(dnd["metrics.cost.status.priced"]).first()).toBeVisible();
  // Uma Expedição continua sem tokens: ela não vira custo zero, continua
  // contada entre as não medidas.
  await expect(page.locator("[data-cost-not-measured]")).toContainText("1");

  // -------------------------------------------- o bloco da Campanha
  await page.goto(`/projects/${cenario.projectId}`);
  const bloco = page.locator("[data-project-metrics]");
  await expect(bloco).toBeVisible();
  await expect(bloco).toContainText(dnd["metrics.project.subscriptionNote"]);
  await bloco.getByRole("link", { name: dnd["metrics.project.open"] }).click();
  await expect(page).toHaveURL(new RegExp(`projectId=${cenario.projectId}`));
  await expect(page.locator("[data-metrics-project]")).toBeVisible();

  // ------------------------------------------------- os dois temas
  await setTheme(page, false);
  await page.goto("/observability?window=30d");
  await expect(
    page.getByRole("heading", { level: 1, name: plain["nav.observability"] }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: dnd["nav.observability"] })).toHaveCount(
    0,
  );
  await setTheme(page, true);
});

test("a aba de medidas do cockpit e o faturamento de um Patronato", async ({ page, request }) => {
  await setTheme(page, true);
  const sufixo = `${String(Date.now())}b`;
  const cenario = await prepararCenario(request, sufixo);

  // ------------------------------------------------ a aba do cockpit
  await page.goto(`/runs/${cenario.ricoRunId}`);
  await page.locator("[data-run-tab-metrics]").click();
  await expect(page).toHaveURL(/tab=metrics/);

  const quebra = page.locator("[data-run-metrics]");
  await expect(quebra).toBeVisible();
  await expect(quebra).toContainText(dnd["run.metrics.context.estimated"]);
  // Ferramentas por servidor MCP: o `native` vira label de glossário.
  await expect(quebra).toContainText(dnd["run.metrics.tools.native"]);
  await expect(quebra).toContainText("knowledge");
  await expect(quebra).toContainText(dnd["run.metrics.gates.policy"]);
  // O custo desta Expedição tem procedência, mesmo sem preço cadastrado.
  await expect(quebra.locator("[data-cost-status]")).toHaveCount(1);

  // A Expedição muda não inventa quatro zeros de token.
  await page.goto(`/runs/${cenario.mudoRunId}?tab=metrics`);
  await expect(page.locator("[data-run-tokens-unknown]")).toContainText(
    dnd["metrics.tokens.unknown"],
  );

  // -------------------------------------- o faturamento de um Patronato
  const provider = await criar<{ id: string }>(request, "/api/v1/providers", {
    name: `Patronato do faturamento ${sufixo}`,
    kind: "SUBSCRIPTION",
    authEnvKeys: ["DM_E2E_FATURA_KEY"],
    harnessKeys: ["CLAUDE_CODE"],
  });

  await page.goto("/settings");
  const linha = page.locator(`[data-provider-billing-row="${provider.id}"]`);
  await linha.scrollIntoViewIfNeeded();
  await expect(linha).toBeVisible();

  await linha.locator(`[data-provider-billing-kind="${provider.id}"]`).click();
  await page.getByRole("option", { name: dnd["provider.billing.subscription"] }).click();
  await linha.locator(`[data-provider-monthly-cost="${provider.id}"]`).fill("100");
  await linha.locator(`[data-provider-currency="${provider.id}"]`).fill("USD");
  const salvar = linha.locator(`[data-provider-billing-save="${provider.id}"]`);
  await salvar.click();
  // O botão volta a desabilitar quando a releitura traz o que foi gravado: é o
  // sinal de que a escrita terminou, e evita ler a API com o `PATCH` em voo.
  await expect(salvar).toBeDisabled();

  const gravado = await request.get(`/api/v1/providers`);
  const items = (
    (await gravado.json()) as {
      items: { id: string; billingKind: string | null; monthlyCost: number | null }[];
    }
  ).items;
  const salvo = items.find((item) => item.id === provider.id);
  expect(salvo?.billingKind).toBe("SUBSCRIPTION");
  expect(salvo?.monthlyCost).toBe(100);

  // O aviso de que assinatura é estimativa fica na tela, não só no relatório.
  await expect(page.getByText(dnd["provider.billing.estimateNote"])).toBeVisible();
});
