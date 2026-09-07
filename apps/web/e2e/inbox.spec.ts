import { dnd } from "@dungeon-master/glossary";
import { expect, test } from "@playwright/test";

import { setTheme } from "./helpers";

/**
 * O ciclo que a Fase 1 entrega inteiro: capturar sem decidir nada, decidir
 * depois, e concluir à mão — sem execução, que é a Fase 2.
 */

const PROJECT = "Campanha do e2e";
const CAPTURE = "ver por que a autenticação quebra no módulo X";

test("captura, promove para uma campanha e conclui à mão", async ({ page }) => {
  await setTheme(page, true);

  // 1. Uma campanha para receber a captura: promover exige projeto, porque
  //    `READY` sem projeto é um estado que o banco recusa.
  await page.goto("/projects");
  await page.getByRole("button", { name: `Criar ${dnd["entity.project"]}` }).click();

  const projectDialog = page.getByRole("dialog");
  await projectDialog.getByLabel("Título").fill(PROJECT);
  await projectDialog.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByRole("link", { name: PROJECT })).toBeVisible();

  // 2. Captura: uma linha e Enter.
  await page.goto("/inbox");
  const capture = page.getByLabel(dnd["entity.inbox"]);
  await capture.fill(CAPTURE);
  await capture.press("Enter");

  const row = page.getByText(CAPTURE, { exact: true });
  await expect(row).toBeVisible();

  // 3. Triagem: campanha, tipo e prioridade só agora.
  await page
    .getByRole("button", { name: `Virar ${dnd["entity.task"]}` })
    .first()
    .click();

  const promote = page.getByRole("dialog");
  await promote.getByLabel(dnd["entity.project"]).click();
  await page.getByRole("option", { name: PROJECT }).click();
  await promote.getByLabel("Tipo").click();
  await page.getByRole("option", { name: dnd["entity.task.kind.bug"] }).click();
  await promote.getByRole("button", { name: `Virar ${dnd["entity.task"]}` }).click();

  await expect(promote).toBeHidden();
  await expect(page.getByText(CAPTURE, { exact: true })).toBeHidden();

  // 4. A captura virou trabalho e aparece na lista, com o tipo escolhido.
  await page.goto("/tasks");
  const link = page.getByRole("link", { name: CAPTURE });
  await expect(link).toBeVisible();

  const tableRow = page.getByRole("row").filter({ has: link });
  await expect(tableRow.getByText(dnd["entity.task.kind.bug"])).toBeVisible();
  await expect(tableRow.getByText(dnd["task.status.ready"])).toBeVisible();

  // 5. Conclusão manual: `READY → COMPLETED`, sem execução nenhuma.
  await link.click();
  await expect(page.getByRole("heading", { name: CAPTURE })).toBeVisible();
  await expect(page.getByText(dnd["env.host.canonical"])).toBeVisible();

  await page.getByRole("button", { name: "Concluir" }).click();

  await expect(page.getByRole("button", { name: "Concluir" })).toBeHidden();
  await expect(page.getByText(dnd["task.status.completed"]).first()).toBeVisible();

  // E o estado novo sobrevive à recarga: quem gravou foi o servidor.
  await page.reload();
  await expect(page.getByText(dnd["task.status.completed"]).first()).toBeVisible();
});
