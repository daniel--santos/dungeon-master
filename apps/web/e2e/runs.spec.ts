import { dnd, plain } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { setTheme } from "./helpers";

/**
 * O caminho inteiro de uma Expedição, sem worker no ar.
 *
 * Sem o Worker um Run criado fica em `QUEUED`, e é justamente esse o estado que
 * a Fase 2A garante sozinha: a API cria o Run, congela o snapshot e leva a Task
 * junto. Cancelar dali também é imediato — em `CREATED` e `QUEUED` não há árvore
 * de processos a confirmar, então a API transiciona na hora e a Task volta para
 * o quadro. É o pedaço do fluxo que dá para provar de ponta a ponta hoje.
 *
 * Dois testes montam o cenário pela API, porque o que eles provam é outra coisa;
 * o último faz o caminho inteiro pela interface — criar a Campanha, apontar o
 * workspace para um repositório git de verdade, criar a Missão, partir e
 * cancelar — que é o critério de conclusão da Fase 2 pela web.
 */

/** Um diretório que existe na máquina que roda a API. */
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface Cenario {
  readonly projectId: string;
  readonly taskId: string;
  readonly taskTitle: string;
}

async function prepararCenario(request: APIRequestContext, sufixo: string): Promise<Cenario> {
  const project = await request.post("/api/v1/projects", {
    data: { title: `Campanha do e2e ${sufixo}` },
  });
  expect(project.ok()).toBe(true);
  const projectId = ((await project.json()) as { id: string }).id;

  // Um Project sem workspace não aceita Run: é onde o agente trabalharia.
  const workspace = await request.patch(`/api/v1/projects/${projectId}`, {
    data: { workspacePath: WORKSPACE },
  });
  expect(workspace.ok()).toBe(true);

  const taskTitle = `Encerrar a árvore de processos no Windows ${sufixo}`;
  const task = await request.post("/api/v1/tasks", {
    data: {
      projectId,
      title: taskTitle,
      description: "taskkill devolve 0 mesmo com um filho vivo.",
      kind: "BUG",
      priority: "URGENT",
    },
  });
  expect(task.ok()).toBe(true);
  const taskId = ((await task.json()) as { id: string }).id;

  return { projectId, taskId, taskTitle };
}

/** Abre um `Select` do Radix e escolhe a opção pelo nome. */
async function escolher(page: Page, rotulo: string, opcao: RegExp | string): Promise<void> {
  await page.getByLabel(rotulo, { exact: true }).first().click();
  await page.getByRole("option", { name: opcao }).click();
}

async function criarHeroi(page: Page, nome: string): Promise<void> {
  await page.goto("/agents");
  await page
    .getByRole("button", { name: `Novo ${dnd["entity.agent"]}` })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill(nome);
  await dialog.getByLabel("Instruções").fill("Implementa e testa no mesmo passo.");
  await dialog.getByRole("button", { name: "Salvar" }).click();

  await expect(page.locator(`[data-agent="${nome}"]`)).toBeVisible();
}

async function criarEquipamento(page: Page, nome: string, heroi: string): Promise<void> {
  await page.goto("/loadouts");
  await page
    .getByRole("button", { name: `Novo ${dnd["entity.loadout"]}` })
    .first()
    .click();

  await page.getByLabel("Nome", { exact: true }).fill(nome);
  await escolher(page, dnd["entity.agent"], new RegExp(heroi));
  await page.getByRole("button", { name: "Salvar" }).click();

  await expect(page.locator(`[data-loadout="${nome}"]`)).toBeVisible();
}

test("cadastra herói e equipamento, parte com o aceite e cancela pelo diálogo", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const cenario = await prepararCenario(request, "1");

  await criarHeroi(page, "Ferreiro do e2e");
  await criarEquipamento(page, "Forja do e2e", "Ferreiro do e2e");

  // ------------------------------------------------------------- partir
  await page.goto(`/tasks/${cenario.taskId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(cenario.taskTitle);

  await page.getByRole("button", { name: `Nova ${dnd["entity.run"]}` }).click();

  const dialog = page.getByRole("dialog");
  // O diálogo pré-seleciona o Equipamento padrão ou o primeiro por nome, e desde
  // a Fase 6 o semeado "Escriba do Grimório" vem antes de "Forja do e2e"; o
  // teste escolhe o seu de propósito.
  await escolher(page, dnd["entity.loadout"], "Forja do e2e");
  await expect(dialog.getByText("Forja do e2e").first()).toBeVisible();

  // Sem o aceite explícito, a Expedição não parte. É a exigência da Fase 2B.
  const partir = dialog.getByRole("button", { name: "Partir" });
  await expect(partir).toBeDisabled();

  const aceite = dialog.getByLabel(`Aceito executar ${dnd["env.host.warning"]}`);
  await expect(dialog.locator("[data-host-acknowledgement]")).toContainText(
    "acesso ao disco e à rede",
  );
  await aceite.check();

  await expect(partir).toBeEnabled();
  await partir.click();

  // -------------------------------------------------- cockpit, ainda na fila
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}/);
  const runUrl = page.url();

  await expect(page.locator("[data-run-status]").first()).toHaveText(dnd["run.status.queued"]);

  const badge = page.locator('[data-env-badge="HOST"]').first();
  await expect(badge).toContainText(dnd["env.host"]);
  await expect(badge).toContainText(dnd["env.host.warning"]);
  await expect(badge).toContainText(dnd["env.host.canonical"]);

  // ----------------------------------------------------- e também na lista
  await page.goto("/runs");
  const linha = page.getByRole("row").filter({ hasText: cenario.taskTitle });
  await expect(linha).toBeVisible();
  await expect(linha.locator("[data-run-status]")).toHaveText(dnd["run.status.queued"]);
  await expect(linha.locator('[data-env-badge="HOST"]')).toContainText(dnd["env.host.warning"]);

  // ------------------------------------------------------------- cancelar
  await page.goto(runUrl);
  await page.getByRole("button", { name: `Cancelar ${dnd["entity.run"]}` }).click();

  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao).toContainText("árvore de processos for confirmada encerrada");
  await confirmacao.getByRole("button", { name: `Cancelar ${dnd["entity.run"]}` }).click();

  // Em QUEUED não há árvore a confirmar: a API transiciona na hora.
  await expect(page.locator("[data-run-status]").first()).toHaveText(dnd["run.status.cancelled"]);

  // ------------------------------------------------- e a Missão volta ao quadro
  await page.goto(`/tasks/${cenario.taskId}`);
  await expect(page.getByText(dnd["task.status.ready"]).first()).toBeVisible();
});

test("o badge de ambiente muda de nome, nunca de aviso, ao trocar o tema", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const cenario = await prepararCenario(request, "2");

  await criarHeroi(page, "Batedor do e2e");
  await criarEquipamento(page, "Batida do e2e", "Batedor do e2e");

  await page.goto(`/tasks/${cenario.taskId}`);
  await page.getByRole("button", { name: `Nova ${dnd["entity.run"]}` }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(`Aceito executar ${dnd["env.host.warning"]}`).check();
  await dialog.getByRole("button", { name: "Partir" }).click();

  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}/);
  const runUrl = page.url();

  const comTema = page.locator('[data-env-badge="HOST"]').first();
  await expect(comTema).toContainText(dnd["env.host"]);
  await expect(comTema).toContainText("sem isolamento");
  await expect(comTema).toContainText("HOST · UNISOLATED");

  await setTheme(page, false);
  await page.goto(runUrl);

  // Mesma rota, mesmo badge: só o nome muda. O aviso e o canônico ficam.
  const semTema = page.locator('[data-env-badge="HOST"]').first();
  await expect(semTema).toContainText(plain["env.host"]);
  await expect(semTema).toContainText("sem isolamento");
  await expect(semTema).toContainText("HOST · UNISOLATED");
  await expect(semTema).not.toContainText(dnd["env.host"]);

  // Religa, para a suíte terminar como começou.
  await setTheme(page, true);
});

/**
 * Um repositório git de verdade, criado pelo teste, em um diretório temporário.
 *
 * A API confere no disco antes de gravar o caminho, então apontar para um lugar
 * inventado não passaria. `git init` porque o tipo escolhido na tela é
 * `GIT_REPO`, e é ele que habilita a estratégia de worktree por Expedição.
 */
function criarRepositorio(): string {
  const diretorio = mkdtempSync(join(tmpdir(), "dm-e2e-repo-"));
  execFileSync("git", ["init", "--initial-branch=main", diretorio], { stdio: "ignore" });
  return diretorio;
}

test("o fluxo inteiro pela interface: campanha com workspace, missão, partida e retirada", async ({
  page,
}) => {
  await setTheme(page, true);

  const repositorio = criarRepositorio();
  const nomeDaCampanha = `Forja temporária ${String(Date.now())}`;
  // Único por tentativa: com `retries` no CI, a segunda tentativa reencontra a
  // Missão da primeira na listagem, e um nome fixo faz o filtro por linha
  // casar duas vezes (violação de modo estrito).
  const nomeDaMissao = `Confirmar o encerramento da árvore de processos ${String(Date.now())}`;

  try {
    await criarHeroi(page, "Ferreiro do fluxo");
    await criarEquipamento(page, "Forja do fluxo", "Ferreiro do fluxo");

    // ------------------------------------------------ criar a Campanha
    await page.goto("/projects");
    await page.getByRole("button", { name: `Criar ${dnd["entity.project"]}` }).click();

    const criacao = page.getByRole("dialog");
    await criacao.getByLabel("Título").fill(nomeDaCampanha);
    await criacao.getByRole("button", { name: "Criar", exact: true }).click();

    await page.getByRole("link", { name: nomeDaCampanha }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(nomeDaCampanha);
    const urlDaCampanha = page.url();

    // Nasce sem workspace, e o cabeçalho diz isso em vez de deixar descobrir no `409`.
    await expect(page.locator('[data-workspace="missing"]')).toContainText(
      dnd["entity.run.plural"],
    );

    // ------------------------------------------------ criar a Missão
    await page.getByRole("button", { name: `Nova ${dnd["entity.task"]}` }).click();
    const novaMissao = page.getByRole("dialog");
    await novaMissao.getByLabel("Título").fill(nomeDaMissao);
    await novaMissao.getByRole("button", { name: "Criar", exact: true }).click();

    await page.getByRole("link", { name: nomeDaMissao }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}/);
    const urlDaMissao = page.url();

    // Sem workspace, partir está desabilitado — e não escondido.
    const partida = page.getByRole("button", { name: `Nova ${dnd["entity.run"]}` });
    await expect(partida).toBeDisabled();

    // ------------------------------------------------ apontar o workspace
    await page.goto(urlDaCampanha);
    await page.getByRole("button", { name: "Editar" }).click();

    const edicao = page.getByRole("dialog");
    await escolher(page, "Tipo", dnd["workspaceKind.gitRepo"]);
    await edicao.getByLabel("Caminho").fill(repositorio);
    await edicao.getByRole("button", { name: "Salvar" }).click();

    const badge = page.locator('[data-workspace="configured"]').first();
    await expect(badge).toContainText(repositorio);

    // ------------------------------------------------ partir
    await page.goto(urlDaMissao);
    await expect(partida).toBeEnabled();
    await partida.click();

    const dialogo = page.getByRole("dialog");
    await escolher(page, dnd["entity.loadout"], /Forja do fluxo/);
    await dialogo.getByLabel(`Aceito executar ${dnd["env.host.warning"]}`).check();
    await dialogo.getByRole("button", { name: "Partir" }).click();

    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}/);
    const urlDaExpedicao = page.url();
    await expect(page.locator("[data-run-status]").first()).toHaveText(dnd["run.status.queued"]);

    // O título da Missão vem na própria listagem, sem uma leitura por linha.
    await page.goto("/runs");
    await expect(page.getByRole("row").filter({ hasText: nomeDaMissao })).toBeVisible();

    // ------------------------------------------------ cancelar
    await page.goto(urlDaExpedicao);
    await page.getByRole("button", { name: `Cancelar ${dnd["entity.run"]}` }).click();

    const confirmacao = page.getByRole("alertdialog");
    await confirmacao.getByRole("button", { name: `Cancelar ${dnd["entity.run"]}` }).click();

    await expect(page.locator("[data-run-status]").first()).toHaveText(dnd["run.status.cancelled"]);

    // ------------------------------------------------ e a Missão volta ao quadro
    await page.goto(urlDaMissao);
    await expect(page.getByText(dnd["task.status.ready"]).first()).toBeVisible();
  } finally {
    rmSync(repositorio, { recursive: true, force: true });
  }
});
