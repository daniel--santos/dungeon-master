import { dnd, plain } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { definitions, projectAchievements, setTheme } from "./helpers";

/**
 * O Hall com a projeção ligada.
 *
 * A Fase 2.5D trocou o modo catálogo pela projeção real, e é ela que estes
 * testes exercitam: um fato do domínio vira progresso numa carta, um
 * desbloqueio vira uma linha na Crônica, e o interruptor de tema continua
 * trocando só texto.
 *
 * Quem projeta é o Worker, e a configuração do Playwright não sobe Worker de
 * propósito — ele tentaria executar os Runs que `runs.spec` deixa em `QUEUED`.
 * `projectAchievements()` roda o mesmo passe pela linha de comando do operador,
 * entre a ação na interface e a conferência da tela.
 */

const CARD = "[data-achievement]";

/** A carta de uma Conquista do catálogo, pela chave. */
function card(page: Page, key: string) {
  return page.locator(`[data-achievement="${key}"]`);
}

async function criarCampanha(request: APIRequestContext, titulo: string): Promise<string> {
  const response = await request.post("/api/v1/projects", { data: { title: titulo } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

async function criarMonstro(
  request: APIRequestContext,
  projectId: string,
  titulo: string,
): Promise<string> {
  const response = await request.post("/api/v1/tasks", {
    data: { projectId, title: titulo, kind: "BUG", priority: "HIGH" },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

/** Conclui a Missão pela interface, que é o caminho que o critério exige. */
async function concluirPelaTela(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  await page.getByRole("button", { name: "Concluir" }).first().click();
  await expect(page.getByText(dnd["task.status.completed"]).first()).toBeVisible();
}

test("o catálogo inteiro aparece, com o medidor vindo da projeção", async ({ page }) => {
  await setTheme(page, true);
  projectAchievements();

  const catalog = definitions();

  await page.goto("/hall");

  // O medidor é o `counts` da API, e não uma contagem das cartas na tela.
  await expect(page.getByText(/\d+ de \d+ desbloqueadas/)).toBeVisible();

  // As definições do catálogo, todas gravadas pela sincronização do projetor.
  await expect(page.locator(CARD)).toHaveCount(catalog.length);
  for (const definition of catalog.filter((entry) => !entry.hidden)) {
    await expect(card(page, definition.key)).toBeVisible();
  }
});

test("filtra por raridade pela URL, e a API responde só com aquilo", async ({ page }) => {
  await setTheme(page, true);
  projectAchievements();

  const epics = definitions().filter((definition) => definition.rarity === "EPIC");
  expect(epics.length).toBeGreaterThan(0);

  await page.goto("/hall?rarity=EPIC");

  await expect(page.locator(CARD)).toHaveCount(epics.length);
  await expect(page.locator(CARD).getByText(dnd["achievement.rarity.epic"])).toHaveCount(
    epics.length,
  );
  await expect(page.locator(CARD).getByText(dnd["achievement.rarity.common"])).toHaveCount(0);
});

test("concluir um Monstro pela tela põe o Caçador em progresso 1 de 10", async ({
  page,
  request,
}) => {
  await setTheme(page, true);

  const projectId = await criarCampanha(request, "Campanha do Bestiário");
  const taskId = await criarMonstro(request, projectId, "taskkill devolve 0 com um filho vivo");

  // Antes do fato, a carta está bloqueada e não tem barra.
  projectAchievements();
  await page.goto("/hall");
  await expect(card(page, "monster_slayer")).toHaveAttribute("data-state", "LOCKED");

  await concluirPelaTela(page, taskId);
  projectAchievements();

  await page.goto("/hall");
  const caçador = card(page, "monster_slayer");
  await expect(caçador).toHaveAttribute("data-state", "IN_PROGRESS");
  await expect(caçador.getByText("1 de 10")).toBeVisible();
  await expect(caçador.getByText(dnd["achievement.state.inProgress"])).toBeVisible();

  // O Bestiário mostra o Monstro derrotado, na mesma tela.
  await page.goto("/hall?tab=bestiary");
  await expect(page.locator(`[data-bestiary-task="${taskId}"]`)).toBeVisible();
});

test("a Crônica sai de vazia para cheia quando existe um desbloqueio", async ({
  page,
  request,
}) => {
  await setTheme(page, true);

  await page.goto("/hall?tab=chronicle");
  await expect(page.getByText(dnd["hall.tab.chronicle"]).first()).toBeVisible();
  await expect(page.locator("[data-chronicle-unlock]")).toHaveCount(0);

  // "Cartógrafo" é o desbloqueio mais barato do catálogo: uma dependência entre
  // Missões, sem precisar de execução. "Primeira Expedição" exigiria um Run
  // vitorioso, e sem Worker no ar nenhum Run sai de `QUEUED` nesta suíte.
  const projectId = await criarCampanha(request, "Campanha do Cartógrafo");
  const antes = await criarMonstro(request, projectId, "Mapear o território");
  const depois = await criarMonstro(request, projectId, "Percorrer o território");

  const dependency = await request.put(`/api/v1/tasks/${depois}/dependencies/${antes}`);
  expect(dependency.ok()).toBe(true);

  projectAchievements();

  await page.goto("/hall?tab=chronicle");
  await expect(page.locator("[data-chronicle-unlock]")).not.toHaveCount(0);
  await expect(page.getByText("Cartógrafo").first()).toBeVisible();

  // E a mesma Conquista aparece desbloqueada na grade.
  await page.goto("/hall?state=UNLOCKED");
  await expect(card(page, "cartographer")).toHaveAttribute("data-state", "UNLOCKED");
});

test("com o tema desligado, a mesma carta mostra o nome plain e nenhum sabor", async ({ page }) => {
  projectAchievements();

  const first = definitions().find((definition) => !definition.hidden);
  expect(first).toBeDefined();
  const key = first!.key;

  await setTheme(page, true);
  await page.goto("/hall");
  await expect(card(page, key).getByRole("heading")).toContainText(first!.name.theme);
  await expect(page.getByRole("heading", { level: 1, name: dnd["nav.hall"] })).toBeVisible();

  await setTheme(page, false);
  await page.goto("/hall");

  // Mesma rota, mesma carta, mesmo ícone: só o texto muda.
  await expect(card(page, key).getByRole("heading")).toContainText(first!.name.plain);
  await expect(page.getByRole("heading", { level: 1, name: plain["nav.hall"] })).toBeVisible();
  await expect(page).toHaveURL(/\/hall$/);
  // Texto de sabor é só do tema: sem ele, não é renderizado.
  await expect(card(page, key)).not.toContainText(first!.flavor);

  // Religa, para a suíte terminar como começou.
  await setTheme(page, true);
});
