import { dnd, plain } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { seedKnowledge, setTheme } from "./helpers";

/**
 * O Grimório da Campanha, a forja e o bloco de Settings de ponta a ponta,
 * sem Worker no ar (Fase 6B).
 *
 * Quem escreve o Grimório é o Distiller do Worker, e ele não está de pé; a
 * fixture `seedKnowledge` escreve no banco o que um lote escreveria, e daí em
 * diante tudo é pela interface e pela API de verdade: os toasts pelo SSE, o
 * contador na navegação, a fila de revisão, a aprovação com o item ficando
 * ativo, a recusa com confirmação, a segunda decisão perdendo a corrida com
 * o `409` que traz o item como ficou, a busca `q`, a linha do tempo de
 * Decretos, o cockpit com os candidatos decididos, Settings salvando e
 * recarregando, e a forjada reescrita, pendurada no Hall ou descartada.
 */

/** Um diretório que existe na máquina que roda a API. */
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface Cenario {
  readonly projectId: string;
  readonly taskId: string;
  readonly runId: string;
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

/** Campanha com workspace, uma Missão, Herói, Equipamento e um Run em QUEUED. */
async function prepararCenario(request: APIRequestContext, sufixo: string): Promise<Cenario> {
  const project = await criar<{ id: string }>(request, "/api/v1/projects", {
    title: `Campanha do Grimório ${sufixo}`,
  });
  const workspace = await request.patch(`/api/v1/projects/${project.id}`, {
    data: { workspacePath: WORKSPACE },
  });
  expect(workspace.ok()).toBe(true);

  const task = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: `Explorar a sala norte ${sufixo}`,
    kind: "RESEARCH",
  });

  const harnesses = await request.get("/api/v1/harnesses");
  const harness = (
    (await harnesses.json()) as { items: { id: string; enabled: boolean }[] }
  ).items.find((item) => item.enabled);
  const profiles = await request.get("/api/v1/execution-profiles");
  const profile = (
    (await profiles.json()) as { items: { id: string; mode: string; enabled: boolean }[] }
  ).items.find((item) => item.mode === "HOST" && item.enabled);
  expect(harness).toBeDefined();
  expect(profile).toBeDefined();

  const agent = await criar<{ id: string }>(request, "/api/v1/agents", {
    name: `Batedor ${sufixo}`,
    role: "EXPLORER",
    instructions: "Explora e anota o que encontra.",
  });
  const loadout = await criar<{ id: string }>(request, "/api/v1/loadouts", {
    name: `Lanterna ${sufixo}`,
    agentId: agent.id,
    harnessId: harness!.id,
    executionProfileId: profile!.id,
  });
  const run = await criar<{ id: string; status: string }>(
    request,
    `/api/v1/tasks/${task.id}/runs`,
    {
      loadoutId: loadout.id,
      prompt: "Explore a sala norte.",
    },
  );
  expect(run.status).toBe("QUEUED");

  return { projectId: project.id, taskId: task.id, runId: run.id };
}

async function itemDaApi(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/v1/knowledge-items/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as { status: string; reviewNote: string | null; version: number };
}

/** Abre um `Select` do Radix e escolhe a opção pelo nome. */
async function escolher(page: Page, rotulo: string, opcao: RegExp | string): Promise<void> {
  await page.getByLabel(rotulo, { exact: true }).first().click();
  await page.getByRole("option", { name: opcao }).click();
}

test("o Grimório: toasts, contador, fila, selar, recusar, o 409, a busca, os Decretos e o cockpit", async ({
  page,
  context,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const cenario = await prepararCenario(request, sufixo);

  // ------------------------------------------------ o lote chega por SSE, em outra tela
  await page.goto("/workflows");
  await expect(page.getByRole("heading", { level: 1, name: dnd["nav.workflows"] })).toBeVisible();
  await expect(page.locator("[data-pending-knowledge-count]")).toHaveCount(0);

  const seed = await seedKnowledge({ runId: cenario.runId, suffix: sufixo });

  const toastLote = page.locator(`[data-knowledge-toast="${seed.batchId}"]`);
  await expect(toastLote).toBeVisible();
  await expect(toastLote).toContainText("2 promovidas");
  const toastForja = page.locator(`[data-forged-toast="${seed.forgedId}"]`);
  await expect(toastForja).toBeVisible();
  await expect(toastForja).toContainText(dnd["forged.toast.title"]);
  await expect(toastForja).not.toContainText(seed.titles.forged);

  // O contador da navegação soma a fila de todas as Campanhas.
  await expect(page.locator("[data-pending-knowledge-count]")).toHaveText("2");

  // O atalho do toast aponta para o Grimório da Campanha. Os dois toasts se
  // empilham, e o de cima intercepta o clique; o link é conferido pelo `href`.
  await expect(toastLote.getByRole("link")).toHaveAttribute(
    "href",
    `/projects/${seed.projectId}/knowledge?tab=items&page=1`,
  );

  // ------------------------------------------------ a visão geral leva à Campanha
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { level: 1, name: dnd["nav.knowledge"] })).toBeVisible();
  const cartao = page.locator(`[data-knowledge-project="${seed.projectId}"]`);
  await expect(cartao).toBeVisible();
  await expect(cartao.locator("[data-knowledge-project-pending]")).toHaveAttribute(
    "data-knowledge-project-pending",
    "2",
  );
  await cartao.locator("[data-knowledge-project-open]").click();
  await expect(page).toHaveURL((url) => url.pathname === `/projects/${seed.projectId}/knowledge`);

  // ------------------------------------------------ resumo e fila
  await expect(page.locator(`[data-knowledge-summary="${seed.summaryId}"]`)).toContainText(
    seed.titles.summary,
  );
  const fila = page.locator("[data-review-queue]");
  await expect(fila).toHaveAttribute("data-review-queue", "2");
  await expect(fila).toContainText(dnd["knowledge.review.title"]);
  const linhaFato = fila.locator(`[data-review-item="${seed.pendingFactId}"]`);
  await expect(linhaFato).toContainText(seed.titles.pendingFact);
  await expect(linhaFato.locator('[data-knowledge-type="FACT"]')).toBeVisible();
  await expect(linhaFato.locator(`[data-review-item-run="${cenario.runId}"]`)).toHaveAttribute(
    "href",
    `/runs/${cenario.runId}`,
  );
  await expect(page.locator("[data-knowledge-pending]")).toHaveText("2");

  // ------------------------------------------------ a gaveta com a proveniência
  await linhaFato.locator("[data-review-item-open]").click();
  await expect(page).toHaveURL(new RegExp(`item=${seed.pendingFactId}`));
  const gaveta = page.locator(`[data-knowledge-sheet="${seed.pendingFactId}"]`);
  await expect(gaveta).toContainText(seed.titles.pendingFact);
  await expect(gaveta.locator("[data-knowledge-sheet-content]")).toContainText(
    "O caminho seguro é pela galeria leste.",
  );
  await expect(gaveta.locator(`[data-knowledge-provenance-run="${cenario.runId}"]`)).toBeVisible();
  await expect(
    gaveta.locator(`[data-knowledge-provenance-task="${cenario.taskId}"]`),
  ).toContainText(`Explorar a sala norte ${sufixo}`);
  await expect(gaveta.locator(`[data-knowledge-provenance-batch="${seed.batchId}"]`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(gaveta).toHaveCount(0);

  // ------------------------------------------------ uma segunda aba hesita com a recusa aberta
  const outraAba = await context.newPage();
  await outraAba.goto(`/projects/${seed.projectId}/knowledge`);
  await outraAba
    .locator(`[data-review-item="${seed.pendingFactId}"] [data-knowledge-decision="reject"]`)
    .click();
  const hesitacao = outraAba.locator(`[data-reject-knowledge-item="${seed.pendingFactId}"]`);
  await expect(hesitacao).toContainText(dnd["knowledge.reject.title"]);

  // ------------------------------------------------ selar o Fato: vira ACTIVE
  await linhaFato.locator('[data-knowledge-decision="approve"]').click();
  await expect(page.getByText(dnd["knowledge.approve.done"])).toBeVisible();
  await expect(fila.locator(`[data-review-item="${seed.pendingFactId}"]`)).toHaveCount(0);
  await expect(fila).toHaveAttribute("data-review-queue", "1");
  await expect(page.locator("[data-pending-knowledge-count]")).toHaveText("1");
  expect((await itemDaApi(request, seed.pendingFactId)).status).toBe("ACTIVE");

  // O resumo agora está atrasado em uma Página.
  await expect(page.locator("[data-knowledge-summary-stale]")).toHaveAttribute(
    "data-knowledge-summary-stale",
    "1",
  );

  // ------------------------------------------------ a segunda decisão perde a corrida
  await hesitacao.getByLabel("Nota (opcional)").fill("Já está noutra Página.");
  await hesitacao.locator('[data-knowledge-confirm="reject"]').click();
  const conflito = outraAba.locator('[data-knowledge-conflict="ACTIVE"]');
  await expect(conflito).toBeVisible();
  await expect(conflito).toContainText(dnd["knowledge.status.active"].toLowerCase());
  await outraAba.getByRole("button", { name: "Entendi" }).click();
  await expect(
    outraAba.locator(`[data-reject-knowledge-item="${seed.pendingFactId}"]`),
  ).toHaveCount(0);
  await outraAba.close();
  expect((await itemDaApi(request, seed.pendingFactId)).status).toBe("ACTIVE");

  // ------------------------------------------------ recusar o Decreto, com confirmação e nota
  const linhaDecreto = fila.locator(`[data-review-item="${seed.pendingDecisionId}"]`);
  await linhaDecreto.locator('[data-knowledge-decision="reject"]').click();
  const confirmacao = page.locator(`[data-reject-knowledge-item="${seed.pendingDecisionId}"]`);
  await expect(confirmacao).toContainText(dnd["knowledge.reject.body"]);
  await confirmacao.getByRole("button", { name: "Voltar" }).click();
  await expect(confirmacao).toHaveCount(0);
  expect((await itemDaApi(request, seed.pendingDecisionId)).status).toBe("PENDING_REVIEW");

  await linhaDecreto.locator('[data-knowledge-decision="reject"]').click();
  await page
    .locator(`[data-reject-knowledge-item="${seed.pendingDecisionId}"]`)
    .getByLabel("Nota (opcional)")
    .fill("A galeria leste alaga também.");
  await page
    .locator(`[data-reject-knowledge-item="${seed.pendingDecisionId}"]`)
    .locator('[data-knowledge-confirm="reject"]')
    .click();
  await expect(page.getByText(dnd["knowledge.reject.done"])).toBeVisible();
  await expect(page.locator("[data-review-queue]")).toHaveCount(0);
  await expect(page.locator("[data-pending-knowledge-count]")).toHaveCount(0);
  const recusado = await itemDaApi(request, seed.pendingDecisionId);
  expect(recusado.status).toBe("REJECTED");
  expect(recusado.reviewNote).toBe("A galeria leste alaga também.");

  // ------------------------------------------------ a lista e a busca `q`
  const lista = page.locator("[data-knowledge-list]");
  await expect(page.locator("[data-knowledge-total]")).toHaveAttribute("data-knowledge-total", "4");
  // "chave" só aparece no procedimento do portão; o resumo fala do portão, não da chave.
  await page.locator("[data-knowledge-search]").fill("chave");
  await expect(page).toHaveURL(/q=chave/);
  await expect(page.locator("[data-knowledge-total]")).toHaveAttribute("data-knowledge-total", "1");
  await expect(lista.locator(`[data-knowledge-item="${seed.activeItemId}"]`)).toBeVisible();
  await expect(lista.locator(`[data-knowledge-item="${seed.pendingFactId}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(page.locator("[data-knowledge-total]")).toHaveAttribute("data-knowledge-total", "4");

  // O filtro de estado vai para a URL e para a API.
  await escolher(page, dnd["knowledge.filter.status"], dnd["knowledge.status.rejected"]);
  await expect(page).toHaveURL(/status=REJECTED/);
  await expect(page.locator("[data-knowledge-total]")).toHaveAttribute("data-knowledge-total", "1");
  await expect(lista.locator(`[data-knowledge-item="${seed.pendingDecisionId}"]`)).toBeVisible();
  await page.getByRole("button", { name: "Limpar", exact: true }).click();

  // ------------------------------------------------ corrigir e arquivar pela gaveta
  await lista
    .locator(`[data-knowledge-item="${seed.activeItemId}"] [data-knowledge-item-open]`)
    .click();
  const gavetaAtivo = page.locator(`[data-knowledge-sheet="${seed.activeItemId}"]`);
  await gavetaAtivo.locator('[data-knowledge-decision="edit"]').click();
  const edicao = page.locator(`[data-edit-knowledge-item="${seed.activeItemId}"]`);
  await edicao.getByLabel("Título").fill(`${seed.titles.active} (corrigido)`);
  await edicao.locator('[data-knowledge-confirm="save"]').click();
  await expect(page.getByText(dnd["knowledge.edit.done"])).toBeVisible();
  await expect(gavetaAtivo).toContainText(`${seed.titles.active} (corrigido)`);
  await expect(gavetaAtivo).toContainText("versão 3");
  expect((await itemDaApi(request, seed.activeItemId)).version).toBe(3);

  await gavetaAtivo.locator('[data-knowledge-decision="archive"]').click();
  const arquivar = page.locator(`[data-archive-knowledge-item="${seed.activeItemId}"]`);
  await expect(arquivar).toContainText(dnd["knowledge.archive.title"]);
  await arquivar.locator('[data-knowledge-confirm="archive"]').click();
  await expect(page.getByText(dnd["knowledge.archive.done"])).toBeVisible();
  await expect(gavetaAtivo.locator('[data-knowledge-status="ARCHIVED"]')).toBeVisible();
  expect((await itemDaApi(request, seed.activeItemId)).status).toBe("ARCHIVED");
  await gavetaAtivo.locator('[data-knowledge-decision="unarchive"]').click();
  await expect(gavetaAtivo.locator('[data-knowledge-status="ACTIVE"]')).toBeVisible();
  await page.keyboard.press("Escape");

  // ------------------------------------------------ a linha do tempo de Decretos
  await page.goto(`/projects/${seed.projectId}/knowledge?tab=decisions`);
  // Sem `status`, a API lista as ativas e as em revisão; a recusada fica de fora.
  await expect(page.locator("[data-decisions]")).toHaveAttribute("data-decisions", "0");
  await expect(page.getByText(dnd["knowledge.decisions.empty"])).toBeVisible();

  const aprovar = await request.patch(`/api/v1/knowledge-items/${seed.pendingFactId}`, {
    data: { type: "DECISION" },
  });
  expect(aprovar.ok()).toBe(true);
  await page.reload();
  const decisao = page.locator(`[data-decision="${seed.pendingFactId}"]`);
  await expect(decisao).toContainText(seed.titles.pendingFact);
  await expect(decisao.locator(`[data-decision-run="${cenario.runId}"]`)).toHaveAttribute(
    "href",
    `/runs/${cenario.runId}`,
  );

  // ------------------------------------------------ os lotes
  await page.goto(`/projects/${seed.projectId}/knowledge?tab=batches`);
  const lote = page.locator(`[data-batch="${seed.batchId}"]`);
  await expect(lote.locator('[data-batch-status="SUCCEEDED"]')).toBeVisible();
  await expect(lote).toContainText(dnd["knowledge.batch.trigger.manual"]);
  await expect(lote.locator("[data-batch-counts]")).toContainText("4 candidatos");
  await expect(lote.locator("[data-batch-summary]")).toBeVisible();
  await expect(lote.locator(`[data-batch-forged="${seed.forgedId}"]`)).toBeVisible();

  // ------------------------------------------------ o cockpit mostra o que o Escriba decidiu
  await page.goto(`/runs/${cenario.runId}`);
  const desfecho = page.locator("[data-run-outcome]");
  await expect(desfecho.locator("[data-run-outcome-knowledge]")).toHaveAttribute(
    "data-run-outcome-knowledge",
    "4",
  );
  await expect(desfecho.locator('[data-candidate-status="PROMOTED"]')).toHaveCount(2);
  await expect(desfecho.locator('[data-candidate-status="REJECTED"]')).toHaveCount(1);
  await expect(desfecho.locator('[data-candidate-status="MERGED"]')).toHaveCount(1);
  await expect(desfecho.locator("[data-run-outcome-candidate-reason]").first()).toBeVisible();
  await expect(
    desfecho.locator(`[data-run-outcome-candidate-item="${seed.pendingFactId}"]`),
  ).toHaveAttribute(
    "href",
    new RegExp(`/projects/${seed.projectId}/knowledge\\?.*item=${seed.pendingFactId}`),
  );
  await desfecho.locator(`[data-run-outcome-candidate-item="${seed.pendingFactId}"]`).click();
  await expect(page.locator(`[data-knowledge-sheet="${seed.pendingFactId}"]`)).toContainText(
    seed.titles.pendingFact,
  );

  // ------------------------------------------------ chamar o Escriba: 202 e o toast
  await page.keyboard.press("Escape");
  await expect(page.locator(`[data-knowledge-sheet="${seed.pendingFactId}"]`)).toHaveCount(0);
  await page.locator("[data-knowledge-distill]").first().click();
  await expect(page.getByText(dnd["knowledge.distill.nothing"])).toBeVisible();
});

test("a forja: reescrever e pendurar no Hall, ou descartar com confirmação", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());

  const primeira = await prepararCenario(request, `${sufixo}a`);
  const seedA = await seedKnowledge({ runId: primeira.runId, suffix: `${sufixo}a` });
  const segunda = await prepararCenario(request, `${sufixo}b`);
  const seedB = await seedKnowledge({ runId: segunda.runId, suffix: `${sufixo}b` });

  await page.goto("/hall");
  const forja = page.locator("[data-forge]");
  await expect(forja).toContainText(dnd["forged.section.title"]);
  const cartaA = forja.locator(`[data-forged="${seedA.forgedId}"]`);
  const cartaB = forja.locator(`[data-forged="${seedB.forgedId}"]`);
  await expect(cartaA.locator("[data-forged-name]")).toHaveText(seedA.titles.forged);
  await expect(cartaA).toContainText(dnd["forged.kind.victoryStreak"]);
  await expect(cartaA.locator(`[data-forged-run="${primeira.runId}"]`)).toHaveAttribute(
    "href",
    `/runs/${primeira.runId}`,
  );
  // A forjada em revisão não é uma carta do Hall.
  await expect(page.locator(`[data-achievement="${seedA.forgedId}"]`)).toHaveCount(0);

  // ------------------------------------------------ reescrever
  const novoNome = `Domadora de Sequências ${sufixo}`;
  await cartaA.locator('[data-forged-decision="rename"]').click();
  const reescrita = page.locator(`[data-rename-forged="${seedA.forgedId}"]`);
  await expect(reescrita).toContainText(dnd["forged.rename.title"]);
  await expect(reescrita.locator("[data-rename-forged-plain]")).toContainText(
    "Sequência de 3 Runs bem-sucedidos",
  );
  await reescrita.getByLabel(dnd["forged.rename.name"]).fill(novoNome);
  await reescrita.locator('[data-forged-confirm="rename"]').click();
  await expect(page.getByText(dnd["forged.rename.done"])).toBeVisible();
  await expect(cartaA.locator("[data-forged-name]")).toHaveText(novoNome);

  // ------------------------------------------------ pendurar no Hall: aparece na grade, desbloqueada
  await cartaA.locator('[data-forged-decision="approve"]').click();
  await expect(page.getByText(dnd["forged.approve.done"])).toBeVisible();
  await expect(cartaA).toHaveCount(0);
  const cartaNoHall = page.locator(`[data-achievement="${seedA.forgedId}"]`);
  await expect(cartaNoHall).toHaveAttribute("data-state", "UNLOCKED");
  await expect(cartaNoHall.getByRole("heading")).toContainText(novoNome);
  await expect(cartaNoHall).toContainText(dnd["achievement.origin.forged"]);

  const aprovada = await request.get("/api/v1/achievements/forged?reviewStatus=APPROVED");
  const aprovadas = (await aprovada.json()) as { items: { id: string; name: string }[] };
  expect(aprovadas.items.find((item) => item.id === seedA.forgedId)?.name).toBe(novoNome);

  // Com o tema desligado, a carta pendurada mostra o nome sóbrio e nenhuma fala.
  await setTheme(page, false);
  await page.goto("/hall");
  await expect(
    page.locator(`[data-achievement="${seedA.forgedId}"]`).getByRole("heading"),
  ).toContainText("Sequência de 3 Runs bem-sucedidos");
  await expect(page.locator("[data-forge]")).toContainText(plain["forged.section.title"]);
  await expect(cartaB.locator("[data-forged-name]")).toHaveText(
    `Sequência de 3 Runs bem-sucedidos ${sufixo}b`,
  );
  await setTheme(page, true);

  // ------------------------------------------------ descartar com confirmação
  await page.goto("/hall");
  await cartaB.locator('[data-forged-decision="discard"]').click();
  const descarte = page.locator(`[data-discard-forged="${seedB.forgedId}"]`);
  await expect(descarte).toContainText(dnd["forged.discard.title"]);
  await descarte.getByRole("button", { name: "Voltar" }).click();
  await expect(descarte).toHaveCount(0);
  await expect(cartaB).toBeVisible();

  await cartaB.locator('[data-forged-decision="discard"]').click();
  await page
    .locator(`[data-discard-forged="${seedB.forgedId}"]`)
    .locator('[data-forged-confirm="discard"]')
    .click();
  await expect(page.getByText(dnd["forged.discard.done"])).toBeVisible();
  await expect(cartaB).toHaveCount(0);
  await expect(page.locator(`[data-achievement="${seedB.forgedId}"]`)).toHaveCount(0);

  const descartada = await request.get("/api/v1/achievements/forged?reviewStatus=DISCARDED");
  const descartadas = (await descartada.json()) as { items: { id: string }[] };
  expect(descartadas.items.some((item) => item.id === seedB.forgedId)).toBe(true);
});

test("Settings: o bloco do Grimório valida, salva e recarrega", async ({ page, request }) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  // O cenário existe pelo Equipamento "Lanterna", que o seletor do Escriba vai escolher.
  await prepararCenario(request, sufixo);

  await page.goto("/settings");
  const bloco = page.locator("[data-settings-knowledge]");
  await expect(bloco).toContainText(dnd["settings.knowledge.title"]);

  const every = bloco.locator('[data-knowledge-field="every"]');
  const forgeEvery = bloco.locator('[data-knowledge-field="forge-every"]');
  const salvar = bloco.locator("[data-knowledge-save]");
  await expect(every).toHaveValue("10");
  await expect(forgeEvery).toHaveValue("20");
  await expect(salvar).toBeDisabled();

  // Fora do intervalo: o aviso aparece e salvar continua desabilitado.
  await every.fill("0");
  await expect(bloco.locator('[data-knowledge-field-error="every"]')).toBeVisible();
  await expect(salvar).toBeDisabled();

  await every.fill("15");
  await forgeEvery.fill("7");
  await bloco.locator("[data-knowledge-human-review]").click();
  await escolher(page, dnd["settings.knowledge.loadout"], `Lanterna ${sufixo}`);
  await expect(salvar).toBeEnabled();
  await salvar.click();
  await expect(page.getByText(dnd["settings.knowledge.saved"])).toBeVisible();

  const settings = await request.get("/api/v1/settings");
  const gravado = (await settings.json()) as Record<string, unknown>;
  expect(gravado["knowledge.humanReview"]).toBe(false);
  expect(gravado["knowledge.distillEveryMinutes"]).toBe(15);
  expect(gravado["achievements.forgeEveryNRuns"]).toBe(7);
  expect(typeof gravado["knowledge.loadoutId"]).toBe("string");

  // Recarrega: os valores vieram do banco, não da memória da aba.
  await page.reload();
  await expect(bloco.locator('[data-knowledge-field="every"]')).toHaveValue("15");
  await expect(bloco.locator('[data-knowledge-field="forge-every"]')).toHaveValue("7");
  await expect(bloco.locator("[data-knowledge-human-review]")).toHaveAttribute(
    "data-state",
    "unchecked",
  );
  await expect(bloco.locator("[data-knowledge-loadout]")).toContainText(`Lanterna ${sufixo}`);

  // Voltar ao semeado grava `null` de verdade, e a revisão volta a ligada.
  await escolher(
    page,
    dnd["settings.knowledge.loadout"],
    dnd["settings.knowledge.loadout.default"].replace("{name}", dnd["knowledge.scribe"]),
  );
  await bloco.locator("[data-knowledge-human-review]").click();
  await bloco.locator("[data-knowledge-save]").click();
  await expect(page.getByText(dnd["settings.knowledge.saved"])).toBeVisible();

  const depois = (await (await request.get("/api/v1/settings")).json()) as Record<string, unknown>;
  expect(depois["knowledge.loadoutId"]).toBeNull();
  expect(depois["knowledge.humanReview"]).toBe(true);
});
