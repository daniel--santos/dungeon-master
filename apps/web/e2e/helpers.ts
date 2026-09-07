import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

/**
 * Utilitários compartilhados pelas suítes de ponta a ponta.
 *
 * O banco é um só para a suíte inteira e as suítes rodam em série, então uma
 * delas deixar o tema desligado quebraria a seguinte. `setTheme` deixa o estado
 * explícito no começo de cada teste que depende de label.
 */

/** Liga ou desliga o interruptor de tema, pela tela de configurações. */
export async function setTheme(page: Page, on: boolean): Promise<void> {
  await page.goto("/settings");

  const toggle = page.getByRole("switch");
  await expect(toggle).toBeEnabled();

  const wanted = on ? "checked" : "unchecked";
  if ((await toggle.getAttribute("data-state")) !== wanted) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("data-state", wanted);
}

export interface CatalogDefinition {
  readonly key: string;
  readonly rarity: string;
  readonly hidden: boolean;
  readonly name: { readonly theme: string; readonly plain: string };
}

const CATALOG_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/achievements/catalog/v1",
);

function read<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(CATALOG_DIR, file), "utf8")) as T;
}

/**
 * O catálogo versionado, lido do arquivo.
 *
 * O teste compara a tela com a fonte de verdade em vez de repetir os nomes: se
 * o catálogo mudar de voz, a asserção continua correta sem edição.
 */
export function definitions(): readonly CatalogDefinition[] {
  return read<CatalogDefinition[]>("catalog.json");
}

/** Os templates, que na tela viram uma única carta oculta. */
export function templates(): readonly { readonly key: string }[] {
  return read<{ key: string }[]>("templates.json");
}
