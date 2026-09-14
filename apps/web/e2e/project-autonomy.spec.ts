import { dnd } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { seedAutonomy, setTheme, type SeedAutonomyResult } from "./helpers";

/**
 * A autonomia controlada de ponta a ponta (Fase 9C), sem Worker no ar.
 *
 * A fixture `seedAutonomy` deixa uma Campanha no nível 3 com um Édito, um
 * Tesouro com consumo (as duas Expedições criadas pela API antes dela), uma
 * Sentinela de portão fechado, um Encaminhamento, uma Missão criada por
 * política e um Run filho por delegação; daí em diante tudo é pela
 * interface e pela API de verdade: a Rédea com as quatro abas, a mudança de
 * nível com confirmação ao subir ao 4 e sem ela ao descer ao 2 (com o Édito
 * ficando inerte), as sugestões na Nova Expedição com o Equipamento
 * pré-selecionado pelo Encaminhamento, o `409 BREAKER_OPEN` tratado no
 * diálogo, o reset da Sentinela com confirmação, a origem nas listas e no
 * cockpit.
 *
 * O preflight mede a CLI na hora, com teto de 15 s por adapter: a espera
 * pela partida é mais larga do que o padrão de 10 s.
 *
 * O arquivo se chama `project-autonomy` (a rota é `/projects/:id/autonomy`)
 * e não `autonomy` de propósito: o Playwright roda os arquivos em ordem
 * alfabética, e `hall.spec` precisa ser o primeiro a tocar o banco — ele
 * conta as cartas do catálogo antes de qualquer Campanha existir, e uma
 * Campanha criada antes dele instancia Conquistas de template. O banco é um
 * só para a suíte inteira, e a partida daqui grava o aceite do modo host,
 * que `runs.spec` espera ainda vazio: o `afterEach` o revoga.
 */

test.afterEach(async ({ request }) => {
  const response = await request.put("/api/v1/settings/execution.hostAcknowledged", {
    data: { value: false },
  });
  expect(response.ok()).toBe(true);
});

/** Um diretório que existe na máquina que roda a API. */
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** O preflight sobe a CLI: espera mais que o resto. */
const PREFLIGHT_TIMEOUT = 60_000;

interface Cenario {
  readonly projectId: string;
  readonly loadoutId: string;
  readonly loadoutName: string;
  /** Uma Missão Monstro pronta: é a que o Encaminhamento casa e a que parte. */
  readonly bugTaskId: string;
  readonly policyTaskId: string;
  readonly policyTaskTitle: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly childTaskTitle: string;
  readonly seed: SeedAutonomyResult;
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

/**
 * Campanha com workspace, Herói e Equipamento, quatro Missões e duas
 * Expedições pela API; depois a fixture, que fecha o portão.
 */
async function prepararCenario(request: APIRequestContext, sufixo: string): Promise<Cenario> {
  const project = await criar<{ id: string }>(request, "/api/v1/projects", {
    title: `Campanha da Rédea ${sufixo}`,
  });
  const workspace = await request.patch(`/api/v1/projects/${project.id}`, {
    data: { workspacePath: WORKSPACE },
  });
  expect(workspace.ok()).toBe(true);

  const harnesses = await request.get("/api/v1/harnesses");
  const items = (
    (await harnesses.json()) as { items: { id: string; key: string; enabled: boolean }[] }
  ).items;
  const harness =
    items.find((item) => item.key === "CLAUDE_CODE" && item.enabled) ??
    items.find((item) => item.enabled);
  const profiles = await request.get("/api/v1/execution-profiles");
  const profile = (
    (await profiles.json()) as { items: { id: string; mode: string; enabled: boolean }[] }
  ).items.find((item) => item.mode === "HOST" && item.enabled);
  expect(harness).toBeDefined();
  expect(profile).toBeDefined();

  const agent = await criar<{ id: string }>(request, "/api/v1/agents", {
    name: `Batedor da Rédea ${sufixo}`,
    role: "EXPLORER",
    instructions: "Explora e anota o que encontra.",
  });
  const loadoutName = `Forja da Rédea ${sufixo}`;
  const loadout = await criar<{ id: string }>(request, "/api/v1/loadouts", {
    name: loadoutName,
    agentId: agent.id,
    harnessId: harness!.id,
    executionProfileId: profile!.id,
  });

  const bugTask = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: `Derrotar o monstro do login ${sufixo}`,
    kind: "BUG",
    priority: "HIGH",
  });
  const policyTaskTitle = `Varrer os logs antigos ${sufixo}`;
  const policyTask = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: policyTaskTitle,
    kind: "CHORE",
  });
  const parentTask = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: `Mapear o modulo de pagamentos ${sufixo}`,
    kind: "RESEARCH",
  });
  const childTaskTitle = `Explorar o gateway ${sufixo}`;
  const childTask = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: childTaskTitle,
    kind: "RESEARCH",
  });

  // As duas Expedições partem antes da Sentinela fechar o portão.
  const parentRun = await criar<{ id: string }>(request, `/api/v1/tasks/${parentTask.id}/runs`, {
    loadoutId: loadout.id,
  });
  const childRun = await criar<{ id: string }>(request, `/api/v1/tasks/${childTask.id}/runs`, {
    loadoutId: loadout.id,
  });

  const seed = await seedAutonomy({
    suffix: sufixo,
    projectId: project.id,
    loadoutId: loadout.id,
    parentRunId: parentRun.id,
    childRunId: childRun.id,
    policyTaskId: policyTask.id,
  });

  return {
    projectId: project.id,
    loadoutId: loadout.id,
    loadoutName,
    bugTaskId: bugTask.id,
    policyTaskId: policyTask.id,
    policyTaskTitle,
    parentRunId: parentRun.id,
    childRunId: childRun.id,
    childTaskTitle,
    seed,
  };
}

async function abrirAba(page: Page, aba: string): Promise<void> {
  await page.locator(`[data-autonomy-tab="${aba}"]`).click();
}

test("a Rédea da Campanha: nível com confirmação, Éditos, Tesouro, Sentinela e Encaminhamento", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const cenario = await prepararCenario(request, sufixo);
  const { seed } = cenario;

  // ------------------------------------------------ a tela e o nível 3
  await page.goto(`/projects/${cenario.projectId}/autonomy`);
  await expect(page.getByRole("heading", { level: 1, name: dnd["autonomy.title"] })).toBeVisible();
  await expect(page.locator("[data-autonomy-header-level]")).toHaveAttribute(
    "data-autonomy-header-level",
    "3",
  );
  await expect(page.locator('[data-autonomy-level="3"]')).toHaveAttribute(
    "data-autonomy-level-active",
    "true",
  );
  await expect(page.locator('[data-autonomy-allow="AUTO_APPROVE_PROPOSAL"]')).toHaveAttribute(
    "data-autonomy-allowed",
    "true",
  );
  await expect(page.locator('[data-autonomy-allow="DELEGATE"]')).toHaveAttribute(
    "data-autonomy-allowed",
    "false",
  );

  // ------------------------------------------------ os Éditos
  await abrirAba(page, "policies");
  const edito = page.locator(`[data-policy="${seed.names.policy}"]`);
  await expect(edito).toBeVisible();
  await expect(edito).toHaveAttribute("data-policy-action", "AUTO_APPROVE");
  await expect(edito).toHaveAttribute("data-policy-inert", "false");
  await expect(edito).toContainText(dnd["policy.action.autoApprove"]);
  await expect(edito).toContainText(dnd["policy.subject.proposal"]);
  await expect(edito.locator('[data-rule-condition="taskKind"]')).toContainText(
    dnd["entity.task.kind.chore"],
  );
  // O fail-closed fica à vista na lista, não só no formulário.
  await expect(page.locator("[data-policy-list]")).toContainText(dnd["autonomy.failClosed"]);

  // ------------------------------------------------ o Tesouro com consumo
  await abrirAba(page, "budgets");
  const tesouro = page.locator(`[data-budget="${seed.names.budget}"]`);
  await expect(tesouro).toBeVisible();
  await expect(tesouro).toContainText(dnd["budget.window.day"]);
  // As duas Expedições criadas hoje sobre um teto de dez.
  const runsBar = tesouro.locator('[data-budget-limit="maxRuns"]');
  await expect(runsBar).toContainText("2 / 10");
  await expect(runsBar).toHaveAttribute("data-budget-limit-ratio", "0.20");
  await expect(tesouro.locator("[data-budget-pressure]")).toContainText("20%");
  await expect(tesouro.locator("[data-budget-tokens-unknown]")).toHaveCount(0);

  // ------------------------------------------------ a Sentinela de portão fechado
  await abrirAba(page, "breakers");
  const sentinela = page.locator(`[data-breaker="${seed.names.breaker}"]`);
  await expect(sentinela).toBeVisible();
  await expect(sentinela).toHaveAttribute("data-breaker-state", "OPEN");
  await expect(sentinela).toContainText(dnd["breaker.state.open"]);
  await expect(sentinela.locator("[data-breaker-reason]")).toContainText("fixture do e2e");
  await expect(sentinela.locator("[data-breaker-opened-at]")).toBeVisible();
  await expect(sentinela.locator("[data-breaker-reopens-at]")).toBeVisible();
  await expect(sentinela.locator(`[data-breaker-reset="${seed.names.breaker}"]`)).toBeVisible();

  // ------------------------------------------------ o Encaminhamento
  await abrirAba(page, "routing");
  const regra = page.locator(`[data-routing-rule="${seed.names.routingRule}"]`);
  await expect(regra).toBeVisible();
  await expect(regra).toHaveAttribute("data-routing-kind", "LOADOUT");
  await expect(regra.locator("[data-routing-target]")).toContainText(cenario.loadoutName);
  await expect(regra.locator('[data-rule-condition="taskKind"]')).toContainText(
    dnd["entity.task.kind.bug"],
  );

  // ------------------------------------------------ subir ao 4 pede confirmação
  await abrirAba(page, "level");
  await page.locator('[data-autonomy-level="4"]').click();
  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao).toContainText(dnd["autonomy.level.delegate"]);
  await expect(confirmacao.locator('[data-autonomy-gain="DELEGATE"]')).toBeVisible();
  await expect(confirmacao.locator('[data-autonomy-gain="AUTO_DISPATCH"]')).toHaveCount(0);
  await confirmacao.getByRole("button", { name: dnd["autonomy.change.action"] }).click();
  await expect(page.locator("[data-autonomy-header-level]")).toHaveAttribute(
    "data-autonomy-header-level",
    "4",
  );
  // O `autonomy.changed` chega pelo SSE e vira toast.
  await expect(page.locator(`[data-autonomy-toast="level:${cenario.projectId}:4"]`)).toBeVisible();

  // ------------------------------------------------ descer ao 2 grava na hora, e o Édito fica inerte
  await page.locator('[data-autonomy-level="2"]').click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator("[data-autonomy-header-level]")).toHaveAttribute(
    "data-autonomy-header-level",
    "2",
  );
  await abrirAba(page, "policies");
  await expect(edito).toHaveAttribute("data-policy-inert", "true");
  await expect(edito.locator("[data-policy-inert-badge]")).toContainText(dnd["policy.inert"]);
});

test("a Nova Expedição com sugestões, o 409 da Sentinela, o reset e a origem nas listas", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const cenario = await prepararCenario(request, sufixo);
  const { seed } = cenario;

  // ------------------------------------------------ as sugestões pré-selecionam o Equipamento
  await page.goto(`/tasks/${cenario.bugTaskId}`);
  await page.getByRole("button", { name: `Nova ${dnd["entity.run"]}` }).click();
  const dialog = page.getByRole("dialog");
  const sugestoes = dialog.locator('[data-run-suggestions="ready"]');
  await expect(sugestoes).toBeVisible();
  const sugestaoEquipamento = sugestoes.locator('[data-run-suggestion="loadout"]');
  await expect(sugestaoEquipamento).toHaveAttribute(
    "data-run-suggestion-selected",
    cenario.loadoutId,
  );
  await expect(sugestaoEquipamento).toContainText(cenario.loadoutName);
  await expect(sugestaoEquipamento).toContainText(dnd["entity.routingRule"]);
  await expect(sugestaoEquipamento).toContainText(seed.names.routingRule);
  await expect(sugestaoEquipamento.locator("[data-run-suggestion-applied]")).toBeVisible();
  await expect(dialog.getByLabel(dnd["entity.loadout"], { exact: true }).first()).toContainText(
    cenario.loadoutName,
  );

  // ------------------------------------------------ a partida esbarra na Sentinela
  await dialog.getByLabel(`Aceito executar ${dnd["env.host.warning"]}`).click();
  const partir = dialog.getByRole("button", { name: "Partir" });
  await expect(partir).toBeEnabled({ timeout: PREFLIGHT_TIMEOUT });
  await partir.click();
  const recusa = dialog.locator('[data-run-refusal="breaker"]');
  await expect(recusa).toBeVisible();
  await expect(recusa).toContainText(dnd["breaker.open.title"]);
  await expect(recusa).toContainText(seed.names.breaker);
  await expect(recusa.locator("[data-run-refusal-reopens]")).toBeVisible();
  await expect(recusa.locator("[data-run-refusal-open]")).toBeVisible();
  // O diálogo continua aberto; a Missão continua pronta.
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();

  // ------------------------------------------------ o reset reabre o portão
  await page.goto(`/projects/${cenario.projectId}/autonomy?tab=breakers`);
  const sentinela = page.locator(`[data-breaker="${seed.names.breaker}"]`);
  await expect(sentinela).toHaveAttribute("data-breaker-state", "OPEN");
  await sentinela.locator(`[data-breaker-reset="${seed.names.breaker}"]`).click();
  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao).toContainText(seed.names.breaker);
  await confirmacao.getByRole("button", { name: dnd["breaker.reset"] }).click();
  await expect(sentinela).toHaveAttribute("data-breaker-state", "CLOSED");
  await expect(sentinela.locator(`[data-breaker-reset="${seed.names.breaker}"]`)).toHaveCount(0);
  await expect(
    page.locator(`[data-autonomy-toast="breaker:${seed.breakerId}:CLOSED"]`),
  ).toBeVisible();

  // ------------------------------------------------ a Missão criada por Édito
  await page.goto(`/tasks/${cenario.policyTaskId}`);
  await expect(page.locator('[data-task-created-by="POLICY"]')).toContainText(
    dnd["task.origin.policy"],
  );
  await page.goto(`/tasks?projectId=${cenario.projectId}&createdBy=POLICY`);
  await expect(page.getByRole("link", { name: cenario.policyTaskTitle })).toBeVisible();
  await expect(page.locator('[data-task-created-by="POLICY"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: cenario.childTaskTitle })).toHaveCount(0);

  // ------------------------------------------------ a origem no cockpit e na lista
  await page.goto(`/runs/${cenario.childRunId}`);
  const origem = page.locator("[data-run-origin]");
  await expect(origem).toHaveAttribute("data-run-origin", "DELEGATION");
  await expect(origem).toContainText(dnd["run.origin.delegation"]);
  await expect(origem.locator("[data-run-parent]")).toHaveAttribute(
    "href",
    `/runs/${cenario.parentRunId}`,
  );
  await expect(origem.locator("[data-run-parent-step]")).toHaveText(seed.parentStepKey);

  await origem.locator("[data-run-parent]").click();
  // O cockpit acrescenta `?events=all` à URL.
  await expect(page).toHaveURL(new RegExp(`/runs/${cenario.parentRunId}(\\?.*)?$`));
  const filhas = page.locator("[data-run-children]");
  await expect(filhas).toHaveAttribute("data-run-children", "1");
  await expect(filhas.locator(`[data-run-child="${cenario.childRunId}"]`)).toContainText(
    cenario.childTaskTitle,
  );

  await page.goto(`/runs?projectId=${cenario.projectId}&createdBy=DELEGATION`);
  await expect(page.locator('[data-run-created-by="DELEGATION"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: cenario.childTaskTitle })).toBeVisible();
});
