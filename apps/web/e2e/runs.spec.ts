import { dnd, plain } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
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
 * Project e Task nascem pela API porque a web ainda não edita `workspacePath`,
 * e sem ele nenhum Run pode ser criado. O que a suíte percorre pela interface é
 * o que ela existe para provar: cadastrar um Agent e um Loadout, partir com o
 * aceite explícito, e encerrar pelo diálogo de confirmação.
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
