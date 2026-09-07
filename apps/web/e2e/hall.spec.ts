import { dnd, plain } from "@dungeon-master/glossary";
import { expect, test } from "@playwright/test";

import { definitions, setTheme, templates } from "./helpers";

/**
 * O Hall em modo catálogo: tudo à vista, tudo bloqueado, e o filtro na URL.
 */

const CARD = "[data-achievement]";

test("mostra o catálogo inteiro bloqueado, com o medidor honesto", async ({ page }) => {
  await setTheme(page, true);

  const catalog = definitions();
  const visible = catalog.filter((definition) => !definition.hidden).length;
  const extra = templates().length > 0 ? 1 : 0;

  await page.goto("/hall");

  await expect(page.getByText(`0 de ${String(visible)} desbloqueadas`)).toBeVisible();

  // As definições, mais a carta oculta que representa o que a sua jornada gera.
  await expect(page.locator(CARD)).toHaveCount(catalog.length + extra);
  await expect(page.locator(CARD).getByText(dnd["achievement.state.locked"])).toHaveCount(visible);
});

test("filtra por raridade pela URL", async ({ page }) => {
  await setTheme(page, true);

  const epics = definitions().filter((definition) => definition.rarity === "EPIC");
  expect(epics.length).toBeGreaterThan(0);

  await page.goto("/hall?rarity=EPIC");

  await expect(page.locator(CARD)).toHaveCount(epics.length);
  for (const definition of epics) {
    await expect(page.locator(`[data-achievement="${definition.key}"]`)).toBeVisible();
  }
  await expect(page.locator(CARD).getByText(dnd["achievement.rarity.epic"])).toHaveCount(
    epics.length,
  );
  await expect(page.locator(CARD).getByText(dnd["achievement.rarity.common"])).toHaveCount(0);
});

test("com o tema desligado, a mesma carta mostra o nome plain", async ({ page }) => {
  const first = definitions()[0];
  expect(first).toBeDefined();
  const selector = `[data-achievement="${first!.key}"]`;

  await setTheme(page, true);
  await page.goto("/hall");
  await expect(page.locator(selector).getByRole("heading")).toHaveText(first!.name.theme);
  await expect(page.getByRole("heading", { level: 1, name: dnd["nav.hall"] })).toBeVisible();

  await setTheme(page, false);
  await page.goto("/hall");

  // Mesma rota, mesma carta, mesmo ícone: só o texto muda.
  await expect(page.locator(selector).getByRole("heading")).toHaveText(first!.name.plain);
  await expect(page.getByRole("heading", { level: 1, name: plain["nav.hall"] })).toBeVisible();
  await expect(page).toHaveURL(/\/hall$/);

  // Religa, para a suíte terminar como começou.
  await setTheme(page, true);
});
