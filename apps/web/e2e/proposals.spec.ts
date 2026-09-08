import { dnd } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { seedRunOutcome, setTheme } from "./helpers";

/**
 * Pistas e o Mapa da Campanha de ponta a ponta, sem Worker no ar (Fase 5B).
 *
 * Quem grava as propostas é o Worker, no desfecho de uma Expedição, e ele não
 * está de pé; a fixture `seedRunOutcome` escreve no banco o que ele
 * escreveria, e daí em diante tudo é pela interface e pela API de verdade: o
 * toast pelo SSE, o contador na navegação, a aprovação que cria a Missão filha
 * com a dependência escolhida, a aresta no Mapa, a recusa com confirmação, e a
 * segunda decisão perdendo a corrida com o `409` que traz a proposta como
 * ficou.
 *
 * O segundo teste é o Mapa sozinho: ligar dois nós arrastando, o ciclo
 * recusado pelo servidor com o caminho no toast, e desfazer a ligação atrás
 * do diálogo de confirmação.
 */

/** Um diretório que existe na máquina que roda a API. */
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface Cenario {
  readonly projectId: string;
  readonly originTaskId: string;
  readonly originTitle: string;
  readonly forgeTaskId: string;
  readonly gateTaskId: string;
  readonly loadoutId: string;
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
 * Campanha com workspace, três Missões, Herói e Equipamento pela API.
 *
 * O que estes testes provam são as propostas e o Mapa; o resto do cenário já
 * foi provado pela tela em `runs.spec`.
 */
async function prepararCenario(request: APIRequestContext, sufixo: string): Promise<Cenario> {
  const project = await criar<{ id: string }>(request, "/api/v1/projects", {
    title: `Campanha das Pistas ${sufixo}`,
  });
  const workspace = await request.patch(`/api/v1/projects/${project.id}`, {
    data: { workspacePath: WORKSPACE },
  });
  expect(workspace.ok()).toBe(true);

  const originTitle = `Mapear a masmorra ${sufixo}`;
  const origin = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: originTitle,
    kind: "RESEARCH",
    priority: "HIGH",
  });
  const forge = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: `Forjar a chave ${sufixo}`,
  });
  const gate = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: `Abrir o portão ${sufixo}`,
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
    instructions: "Mapeia e anota o que encontra.",
  });
  const loadout = await criar<{ id: string }>(request, "/api/v1/loadouts", {
    name: `Lanterna ${sufixo}`,
    agentId: agent.id,
    harnessId: harness!.id,
    executionProfileId: profile!.id,
  });

  return {
    projectId: project.id,
    originTaskId: origin.id,
    originTitle,
    forgeTaskId: forge.id,
    gateTaskId: gate.id,
    loadoutId: loadout.id,
  };
}

/** Abre um `Select` do Radix e escolhe a opção pelo nome. */
async function escolher(page: Page, rotulo: string, opcao: RegExp | string): Promise<void> {
  await page.getByLabel(rotulo, { exact: true }).first().click();
  await page.getByRole("option", { name: opcao }).click();
}

/** Arrasta da alça direita de um nó do Mapa até a alça esquerda de outro. */
async function ligar(page: Page, fromId: string, toId: string): Promise<void> {
  const source = page.locator(`[data-task-node="${fromId}"] [data-task-handle="source"]`);
  const target = page.locator(`[data-task-node="${toId}"] [data-task-handle="target"]`);
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error("as alças do Mapa não estão visíveis");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 24, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
  await page.mouse.up();
}

async function dependenciasDe(request: APIRequestContext, taskId: string): Promise<string[]> {
  const response = await request.get(`/api/v1/tasks/${taskId}`);
  expect(response.ok()).toBe(true);
  const detail = (await response.json()) as { dependencies: { id: string }[] };
  return detail.dependencies.map((task) => task.id);
}

test("as Pistas: toast, contador, aprovar com dependência, recusar e a segunda decisão perde", async ({
  page,
  context,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const cenario = await prepararCenario(request, sufixo);
  const run = await criar<{ id: string; status: string }>(
    request,
    `/api/v1/tasks/${cenario.originTaskId}/runs`,
    { loadoutId: cenario.loadoutId, prompt: "Mapeie a masmorra." },
  );
  expect(run.status).toBe("QUEUED");

  const primeira = `Cobrir o poço da sala norte ${sufixo}`;
  const segunda = `Anotar as runas do portão ${sufixo}`;

  // ------------------------------------------------ o desfecho chega por SSE, em outra tela
  await page.goto("/workflows");
  await expect(page.getByRole("heading", { level: 1, name: dnd["nav.workflows"] })).toBeVisible();
  await expect(page.locator("[data-open-proposals-count]")).toHaveCount(0);

  const { proposedTaskIds } = await seedRunOutcome({
    runId: run.id,
    proposals: [
      {
        title: primeira,
        description: "O poço fica aberto depois da armadilha.",
        rationale: "Vi o poço enquanto mapeava; ninguém pediu para cobri-lo.",
      },
      { title: segunda, rationale: "As runas mudam a cada visita." },
    ],
    knowledge: [
      {
        title: "A sala norte alaga",
        content: "Depois da chuva o piso fica sob água.",
        kind: "gotcha",
      },
    ],
  });
  const [idPrimeira, idSegunda] = proposedTaskIds as [string, string];

  const toast = page.locator(`[data-proposal-toast="${run.id}"]`);
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(dnd["proposal.toast.many"].replace("{n}", "2"));
  await expect(page.locator("[data-open-proposals-count]")).toHaveText("2");

  await toast.getByRole("link").click();
  await expect(page).toHaveURL((url) => url.pathname === `/projects/${cenario.projectId}`);

  // ------------------------------------------------ a caixa de Pistas na Campanha
  const caixa = page.locator("[data-proposals]");
  await expect(caixa).toHaveAttribute("data-proposals", "2");
  await expect(caixa).toContainText(dnd["proposal.open.title"]);
  await expect(page.locator(`[data-project-open-proposals="2"]`)).toBeVisible();

  const linha = page.locator(`[data-proposal="${idPrimeira}"]`);
  await expect(linha).toContainText(primeira);
  await expect(linha).toContainText("Vi o poço enquanto mapeava");
  await expect(linha).toContainText(cenario.originTitle);
  await expect(linha.locator(`[data-proposal-origin-run="${run.id}"]`)).toHaveAttribute(
    "href",
    `/runs/${run.id}`,
  );

  // ------------------------------------------------ seguir a primeira, com dependência
  await linha.locator('[data-proposal-decision="approve"]').click();
  const dialogo = page.locator(`[data-approve-proposal="${idPrimeira}"]`);
  await expect(dialogo).toContainText(dnd["proposal.approve.title"]);
  await expect(dialogo).toContainText(dnd["proposal.approve.parent.origin"]);

  // A origem é a mãe por padrão, então não pode ser dependência.
  await expect(
    dialogo.locator(
      `[data-approve-proposal-dependency="${cenario.originTaskId}"] [role="checkbox"]`,
    ),
  ).toBeDisabled();
  await dialogo
    .locator(`[data-approve-proposal-dependency="${cenario.forgeTaskId}"] [role="checkbox"]`)
    .click();
  await escolher(page, "Prioridade", dnd["task.priority.high"]);
  await dialogo.getByLabel("Nota (opcional)").fill("Faz sentido depois da chave.");
  await dialogo.locator('[data-proposal-confirm="approve"]').click();

  await expect(page.getByText(dnd["proposal.approve.done"])).toBeVisible();
  await expect(page.locator(`[data-proposal="${idPrimeira}"]`)).toHaveCount(0);
  await expect(caixa).toHaveAttribute("data-proposals", "1");
  await expect(page.locator("[data-open-proposals-count]")).toHaveText("1");

  // A Missão criada é filha da origem e espera pela chave.
  const lista = await request.get(
    `/api/v1/tasks?projectId=${cenario.projectId}&q=${encodeURIComponent("Cobrir o poço")}`,
  );
  const criada = (
    (await lista.json()) as {
      items: { id: string; parentTaskId: string | null; priority: string }[];
    }
  ).items[0];
  expect(criada).toBeDefined();
  expect(criada!.parentTaskId).toBe(cenario.originTaskId);
  expect(criada!.priority).toBe("HIGH");
  expect(await dependenciasDe(request, criada!.id)).toEqual([cenario.forgeTaskId]);

  await page.goto(`/tasks/${criada!.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(primeira);
  await expect(page.getByRole("link", { name: `Forjar a chave ${sufixo}` })).toBeVisible();

  // ------------------------------------------------ o Mapa mostra a filha e a aresta
  await page.goto(`/projects/${cenario.projectId}/graph`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(dnd["entity.taskGraph"]);
  await expect(page.locator(`[data-task-node="${criada!.id}"]`)).toBeVisible();
  await expect(
    page.locator(`[data-remove-edge="dep:${cenario.forgeTaskId}->${criada!.id}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`.react-flow__edge[data-id="parent:${cenario.originTaskId}->${criada!.id}"]`),
  ).toBeAttached();
  // A origem ainda tem uma Pista em aberto, e o Mapa marca isso.
  await expect(
    page.locator(`[data-task-node="${cenario.originTaskId}"] [data-task-node-proposals]`),
  ).toBeAttached();

  // ------------------------------------------------ uma segunda aba hesita com a recusa aberta
  const outraAba = await context.newPage();
  await outraAba.goto(`/projects/${cenario.projectId}`);
  await outraAba
    .locator(`[data-proposal="${idSegunda}"] [data-proposal-decision="reject"]`)
    .click();
  const hesitacao = outraAba.locator(`[data-reject-proposal="${idSegunda}"]`);
  await expect(hesitacao).toContainText(dnd["proposal.reject.title"]);

  // ------------------------------------------------ a primeira aba descarta, com nota
  await page.goto(`/projects/${cenario.projectId}`);
  await page.locator(`[data-proposal="${idSegunda}"] [data-proposal-decision="reject"]`).click();
  const confirmacao = page.locator(`[data-reject-proposal="${idSegunda}"]`);
  await expect(confirmacao).toContainText(dnd["proposal.reject.body"]);
  await confirmacao.getByLabel("Nota (opcional)").fill("As runas já estão no Grimório.");
  await confirmacao.locator('[data-proposal-confirm="reject"]').click();

  await expect(page.locator(`[data-proposal="${idSegunda}"]`)).toHaveCount(0);
  await expect(page.locator("[data-proposals]")).toHaveAttribute("data-proposals", "0");
  await expect(page.locator("[data-open-proposals-count]")).toHaveCount(0);

  // ------------------------------------------------ a segunda decisão perde a corrida
  await hesitacao.locator('[data-proposal-confirm="reject"]').click();
  const conflito = outraAba.locator('[data-proposal-conflict="REJECTED"]');
  await expect(conflito).toBeVisible();
  await expect(conflito).toContainText(dnd["proposal.status.rejected"].toLowerCase());
  await expect(conflito).toContainText("As runas já estão no Grimório.");
  await outraAba.getByRole("button", { name: "Entendi" }).click();
  await expect(outraAba.locator(`[data-reject-proposal="${idSegunda}"]`)).toHaveCount(0);
  await outraAba.close();

  // ------------------------------------------------ o cockpit resume o que a Expedição trouxe
  await page.goto(`/runs/${run.id}`);
  const desfecho = page.locator("[data-run-outcome]");
  await expect(desfecho).toBeVisible();
  await expect(desfecho.locator("[data-run-outcome-proposals]")).toHaveAttribute(
    "data-run-outcome-proposals",
    "2",
  );
  await expect(desfecho.locator(`[data-run-outcome-proposal="${idPrimeira}"]`)).toContainText(
    dnd["proposal.status.approved"],
  );
  await expect(desfecho.locator(`[data-run-outcome-proposal="${idPrimeira}"] a`)).toHaveAttribute(
    "href",
    `/tasks/${criada!.id}`,
  );
  await expect(desfecho.locator(`[data-run-outcome-proposal="${idSegunda}"]`)).toContainText(
    dnd["proposal.status.rejected"],
  );
  await expect(desfecho.locator("[data-run-outcome-knowledge]")).toHaveAttribute(
    "data-run-outcome-knowledge",
    "1",
  );
});

test("o Mapa: ligar dois nós, o ciclo é recusado com o caminho, e desfazer pede confirmação", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());

  // ------------------------------------------------ o Mapa em branco chama a primeira Missão
  const vazia = await criar<{ id: string }>(request, "/api/v1/projects", {
    title: `Campanha em branco ${sufixo}`,
  });
  await page.goto(`/projects/${vazia.id}/graph`);
  await expect(page.getByText(dnd["graph.empty.title"])).toBeVisible();
  await page
    .getByRole("button", { name: `Nova ${dnd["entity.task"]}` })
    .last()
    .click();
  await expect(page.getByRole("dialog")).toContainText(`Nova ${dnd["entity.task"]}`);
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

  // ------------------------------------------------ a Campanha com três Missões
  const cenario = await prepararCenario(request, sufixo);
  await page.goto(`/projects/${cenario.projectId}`);
  await page.locator("[data-project-graph-link]").click();
  await expect(page).toHaveURL((url) => url.pathname === `/projects/${cenario.projectId}/graph`);
  await expect(page.locator("[data-task-graph]")).toHaveAttribute("data-task-graph", "3");
  await expect(page.locator("[data-remove-edge]")).toHaveCount(0);

  // ------------------------------------------------ ligar: a chave termina antes do portão
  await ligar(page, cenario.forgeTaskId, cenario.gateTaskId);
  const aresta = page.locator(
    `[data-remove-edge="dep:${cenario.forgeTaskId}->${cenario.gateTaskId}"]`,
  );
  await expect(aresta).toBeVisible();
  await expect
    .poll(() => dependenciasDe(request, cenario.gateTaskId))
    .toEqual([cenario.forgeTaskId]);

  // A releitura do grafo redesenha o Mapa com a aresta nova: o portão vai
  // para a direita da chave. Esperar o redesenho assentar é o que impede o
  // segundo arrasto de mirar numa alça que ainda está se movendo.
  await expect
    .poll(async () => {
      const chave = await page.locator(`[data-task-node="${cenario.forgeTaskId}"]`).boundingBox();
      const portao = await page.locator(`[data-task-node="${cenario.gateTaskId}"]`).boundingBox();
      return chave !== null && portao !== null && portao.x > chave.x + 100;
    })
    .toBe(true);

  // ------------------------------------------------ o inverso fecharia um ciclo: recusado, com o caminho
  await ligar(page, cenario.gateTaskId, cenario.forgeTaskId);
  const ciclo = page.getByText(dnd["graph.cycle"].split("{path}")[0]!.trim(), { exact: false });
  await expect(ciclo).toBeVisible();
  await expect(ciclo).toContainText(`Abrir o portão ${sufixo}`);
  await expect(ciclo).toContainText(`Forjar a chave ${sufixo}`);
  await expect(
    page.locator(`[data-remove-edge="dep:${cenario.gateTaskId}->${cenario.forgeTaskId}"]`),
  ).toHaveCount(0);
  expect(await dependenciasDe(request, cenario.forgeTaskId)).toEqual([]);

  // ------------------------------------------------ o filtro por estado esconde e mostra
  await page.locator('[data-task-graph-status="COMPLETED"]').click();
  await expect(page).toHaveURL(/status=.*COMPLETED/);
  await expect(page.locator("[data-task-graph]")).toHaveAttribute("data-task-graph", "0");
  await page.getByRole("button", { name: "Limpar" }).click();
  await expect(page.locator("[data-task-graph]")).toHaveAttribute("data-task-graph", "3");

  // ------------------------------------------------ desfazer pede confirmação
  await aresta.click();
  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao).toContainText(dnd["graph.removeEdge.title"]);
  await expect(confirmacao).toContainText(`Forjar a chave ${sufixo}`);
  await confirmacao.getByRole("button", { name: "Voltar" }).click();
  await expect(aresta).toBeVisible();

  await aresta.click();
  await page.getByRole("alertdialog").locator("[data-remove-edge-confirm]").click();
  await expect(aresta).toHaveCount(0);
  await expect.poll(() => dependenciasDe(request, cenario.gateTaskId)).toEqual([]);

  // ------------------------------------------------ clicar num nó abre a Missão
  await page.locator(`[data-task-node="${cenario.forgeTaskId}"]`).click();
  await expect(page).toHaveURL((url) => url.pathname === `/tasks/${cenario.forgeTaskId}`);
});
