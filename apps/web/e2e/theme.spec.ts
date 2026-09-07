import { dnd, plain } from "@dungeon-master/glossary";
import { expect, test, type Page } from "@playwright/test";

/**
 * O critério de conclusão da Fase 1 para a web: alternar o interruptor troca
 * todos os labels sem recarregar, e a preferência sobrevive à recarga.
 */

const MARKER = "__dmSemRecarga";

/** Marca a página. Uma navegação de verdade apaga a marca; um push do router não. */
async function mark(page: Page): Promise<void> {
  await page.evaluate((key) => {
    Object.assign(window, { [key]: true });
  }, MARKER);
}

async function markSurvives(page: Page): Promise<boolean> {
  return await page.evaluate(
    (key) => (window as unknown as Record<string, unknown>)[key] === true,
    MARKER,
  );
}

test("o interruptor de tema troca os labels sem recarregar, e persiste", async ({ page }) => {
  await page.goto("/");

  const sidebar = page.getByRole("navigation", { name: "Navegação principal" });
  const tasks = (label: string) => sidebar.getByText(label, { exact: true });

  await expect(tasks(dnd["nav.tasks"])).toBeVisible();

  await mark(page);
  expect(await markSurvives(page)).toBe(true);

  await sidebar.getByRole("link", { name: dnd["nav.settings"] }).click();
  await expect(page).toHaveURL(/\/settings$/);

  const toggle = page.getByRole("switch");
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("data-state", "checked");

  // Desliga: o texto da barra lateral tem de trocar na mesma página.
  await toggle.click();
  await expect(tasks(plain["nav.tasks"])).toBeVisible();
  await expect(tasks(dnd["nav.tasks"])).toHaveCount(0);
  await expect(toggle).toHaveAttribute("data-state", "unchecked");
  expect(await markSurvives(page)).toBe(true);

  // Recarrega: a preferência veio do banco, não da memória da aba.
  await page.reload();
  await expect(tasks(plain["nav.tasks"])).toBeVisible();
  expect(await markSurvives(page)).toBe(false);

  // Religa, para a tela terminar como começou.
  const toggleAgain = page.getByRole("switch");
  await expect(toggleAgain).toBeEnabled();
  await expect(toggleAgain).toHaveAttribute("data-state", "unchecked");
  await toggleAgain.click();
  await expect(tasks(dnd["nav.tasks"])).toBeVisible();
  await expect(toggleAgain).toHaveAttribute("data-state", "checked");
});
