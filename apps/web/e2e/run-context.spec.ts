import { dnd, plain } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { seedKnowledge, seedRunContext, setTheme } from "./helpers";

/**
 * As provisões da Expedição de ponta a ponta, sem Worker no ar (Fase 7C).
 *
 * Quem monta o contexto é o Worker, ao reclamar o Run, e ele não está de pé;
 * a fixture `seedRunContext` escreve no banco o que o montador escreveria, e
 * daí em diante tudo é pela interface e pela API de verdade: o painel com o
 * medidor e os itens, o link que abre a gaveta do Grimório, a nota de
 * herança apontando para a Expedição de origem, a consulta ao Grimório
 * destacada no Diário e contada no cabeçalho, o estado "ainda não montado"
 * de uma Expedição na fila, e o bloco de Settings salvando e recarregando.
 *
 * O arquivo se chama `run-context` e não `context` também pela ordem: as
 * suítes rodam em série sobre um banco só, em ordem alfabética, e `hall.spec`
 * e `knowledge.spec` contam cartas e Páginas pendentes do banco inteiro. Esta
 * suíte deixa Expedições vitoriosas e Páginas em revisão para trás, então
 * precisa rodar depois delas.
 */

/** Um diretório que existe na máquina que roda a API. */
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface Cenario {
  readonly projectId: string;
  readonly loadoutId: string;
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

/** Uma Missão nova na Campanha, com um Run em QUEUED. */
async function partir(
  request: APIRequestContext,
  projectId: string,
  loadoutId: string,
  title: string,
): Promise<{ taskId: string; runId: string }> {
  const task = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId,
    title,
    description: "O portão da sala norte só abre com ritmo.",
    kind: "RESEARCH",
  });
  const run = await criar<{ id: string; status: string }>(
    request,
    `/api/v1/tasks/${task.id}/runs`,
    { loadoutId, prompt: "Explore a sala norte." },
  );
  expect(run.status).toBe("QUEUED");
  return { taskId: task.id, runId: run.id };
}

/** Campanha com workspace, Herói, Equipamento e uma Missão com Run em QUEUED. */
async function prepararCenario(request: APIRequestContext, sufixo: string): Promise<Cenario> {
  const project = await criar<{ id: string }>(request, "/api/v1/projects", {
    title: `Campanha das provisões ${sufixo}`,
  });
  const workspace = await request.patch(`/api/v1/projects/${project.id}`, {
    data: { workspacePath: WORKSPACE },
  });
  expect(workspace.ok()).toBe(true);

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
    name: `Batedora ${sufixo}`,
    role: "EXPLORER",
    instructions: "Explora e anota o que encontra.",
  });
  const loadout = await criar<{ id: string }>(request, "/api/v1/loadouts", {
    name: `Mochila ${sufixo}`,
    agentId: agent.id,
    harnessId: harness!.id,
    executionProfileId: profile!.id,
  });
  const first = await partir(request, project.id, loadout.id, `Explorar a sala norte ${sufixo}`);

  return { projectId: project.id, loadoutId: loadout.id, ...first };
}

test("as provisões no cockpit: medidor, itens, gaveta do Grimório, Diário, herança e a fila", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const cenario = await prepararCenario(request, sufixo);

  // O Grimório da Campanha nasce da fixture da Fase 6B, que também termina
  // o primeiro Run; o contexto dele aponta para essas Páginas.
  const seed = await seedKnowledge({ runId: cenario.runId, suffix: sufixo });
  const contexto = await seedRunContext({
    runId: cenario.runId,
    summaryId: seed.summaryId,
    pageId: seed.activeItemId,
    excludedId: seed.pendingFactId,
    titles: {
      summary: seed.titles.summary,
      page: seed.titles.active,
      excluded: seed.titles.pendingFact,
    },
    withToolCalls: true,
  });

  // ------------------------------------------------ o painel, montado
  await page.goto(`/runs/${cenario.runId}`);
  const painel = page.locator("[data-run-context]");
  await expect(painel).toHaveAttribute("data-run-context", "ASSEMBLED");
  await expect(painel).toContainText(dnd["context.title"]);
  await expect(painel.locator('[data-context-status="ASSEMBLED"]')).toHaveText(
    dnd["context.status.assembled"],
  );
  await expect(painel.locator("[data-context-usage]")).toContainText("1.960 de 6.000 tokens");
  await expect(painel).toContainText(dnd["context.description"]);

  // O medidor: o total e cada seção, com a cortada marcada.
  await expect(painel.locator('[data-context-meter="total"]')).toHaveAttribute(
    "aria-valuenow",
    "1960",
  );
  await expect(painel.locator('[data-context-meter="KNOWLEDGE"]')).toHaveAttribute(
    "data-context-meter-percent",
    "88",
  );
  await expect(painel.locator("[data-context-section]")).toHaveCount(3);
  await expect(painel.locator('[data-context-section="SUMMARY"]')).toContainText(
    dnd["context.section.summary"],
  );

  // A Página cortada, com o motivo, o score e a marca.
  const pagina = painel.locator(`[data-context-item="${seed.activeItemId}"]`);
  await expect(pagina).toContainText(seed.titles.active);
  await expect(pagina.locator('[data-context-item-reason="FTS_MATCH"]')).toHaveText(
    dnd["context.reason.ftsMatch"],
  );
  await expect(pagina.locator("[data-context-item-score]")).toContainText("0,426");
  await expect(pagina.locator("[data-context-truncated]")).toBeVisible();

  // A própria Missão na linhagem, com o link para ela.
  await expect(
    painel.locator(`[data-context-item="${cenario.taskId}"] [data-context-item-link]`),
  ).toHaveAttribute("href", `/tasks/${cenario.taskId}`);

  // O que ficou de fora, e por quê.
  await expect(painel.locator("[data-context-excluded]")).toHaveAttribute(
    "data-context-excluded",
    "1",
  );
  const excluida = painel.locator(`[data-context-excluded-item="${seed.pendingFactId}"]`);
  await expect(excluida).toContainText(seed.titles.pendingFact);
  await expect(excluida).toContainText(dnd["context.excluded.totalBudget"]);

  // O texto do bloco, como texto.
  await expect(painel.locator("[data-context-text]")).toHaveCount(0);
  await painel.locator("[data-context-text-toggle]").click();
  await expect(painel.locator("[data-context-text]")).toContainText("<context>");
  await expect(painel.locator("[data-context-text]")).toContainText(
    `<knowledge-item id="${seed.activeItemId}"`,
  );

  // Sem herança neste Run.
  await expect(painel.locator("[data-context-inherited]")).toHaveCount(0);

  // ------------------------------------------------ o Diário destaca e o cabeçalho conta
  await expect(page.locator("[data-knowledge-tool-calls]")).toHaveAttribute(
    "data-knowledge-tool-calls",
    "1",
  );
  await expect(page.locator("[data-knowledge-tool-calls]")).toHaveText(
    dnd["context.toolCalls.one"].replace("{n}", "1"),
  );
  await page.locator('[data-event-filter="tools"]').click();
  const consulta = page.locator('[data-event-type="ToolCall"][data-knowledge-tool]');
  await expect(consulta).toContainText("search_knowledge");
  await expect(consulta.locator("[data-knowledge-tool-badge]")).toHaveText(
    dnd["context.toolCall.badge"],
  );
  await expect(page.locator('[data-event-type="ToolResult"][data-knowledge-tool]')).toHaveCount(1);
  // A chamada comum não ganha o destaque.
  await expect(page.locator('[data-event-type="ToolCall"]:not([data-knowledge-tool])')).toHaveCount(
    1,
  );

  // ------------------------------------------------ o link abre a gaveta do Grimório
  await pagina.locator(`[data-context-item-link="${seed.activeItemId}"]`).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${seed.projectId}/knowledge\\?.*item=${seed.activeItemId}`),
  );
  await expect(page.locator(`[data-knowledge-sheet="${seed.activeItemId}"]`)).toContainText(
    seed.titles.active,
  );

  // ------------------------------------------------ a segunda Expedição herda da primeira
  const segunda = await partir(
    request,
    cenario.projectId,
    cenario.loadoutId,
    `Voltar à sala norte ${sufixo}`,
  );
  await seedRunContext({
    runId: segunda.runId,
    summaryId: seed.summaryId,
    pageId: seed.activeItemId,
    excludedId: seed.pendingFactId,
    titles: {
      summary: seed.titles.summary,
      page: seed.titles.active,
      excluded: seed.titles.pendingFact,
    },
    inheritedFromRunId: cenario.runId,
  });

  await page.goto(`/runs/${segunda.runId}`);
  const heranca = page.locator("[data-context-inherited]");
  await expect(heranca).toHaveAttribute("data-context-inherited", cenario.runId);
  await expect(heranca).toContainText(dnd["context.inherited"]);
  await expect(heranca.locator("[data-context-inherited-open]")).toHaveAttribute(
    "href",
    `/runs/${cenario.runId}`,
  );
  await expect(page.locator("[data-knowledge-tool-calls]")).toHaveCount(0);

  // Com o tema desligado, o mesmo painel muda só de texto.
  await setTheme(page, false);
  await page.goto(`/runs/${segunda.runId}`);
  await expect(page.locator("[data-run-context]")).toContainText(plain["context.title"]);
  await expect(page.locator('[data-context-status="ASSEMBLED"]')).toHaveText(
    plain["context.status.assembled"],
  );
  await expect(page.locator("[data-context-inherited]")).toContainText(plain["context.inherited"]);
  await setTheme(page, true);

  // ------------------------------------------------ uma Expedição na fila: ainda não montado
  const terceira = await partir(
    request,
    cenario.projectId,
    cenario.loadoutId,
    `Ainda na fila ${sufixo}`,
  );
  await page.goto(`/runs/${terceira.runId}`);
  await expect(page.locator("[data-run-status]").first()).toHaveText(dnd["run.status.queued"]);
  const naFila = page.locator("[data-run-context]");
  await expect(naFila).toHaveAttribute("data-run-context", "PENDING");
  await expect(naFila.locator('[data-context-status="PENDING"]')).toHaveText(
    dnd["context.status.pending"],
  );
  await expect(naFila.locator("[data-context-pending]")).toHaveText(dnd["context.pending.hint"]);
  await expect(naFila.locator("[data-context-error]")).toHaveCount(0);
  expect(contexto.projectId).toBe(cenario.projectId);
});

test("Settings: as provisões salvam uma chave por PUT e recarregam", async ({
  page,
  playwright,
  baseURL,
}) => {
  await setTheme(page, true);

  // Um contexto de requisição próprio, aberto na hora de cada leitura: o
  // fixture `request` reaproveita a conexão keep-alive, e depois de alguns
  // segundos de interface a API já a fechou do lado dela; a releitura chegava
  // num socket morto e voltava ECONNRESET.
  const api = () => playwright.request.newContext({ baseURL: baseURL ?? undefined });

  const inicio = await api();
  const antes = await inicio.get("/api/v1/settings");
  expect(antes.ok()).toBe(true);
  const originais = (await antes.json()) as {
    "context.enabled": boolean;
    "context.budgetTokens": number;
    "context.maxDecisions": number;
  };
  await inicio.dispose();

  await page.goto("/settings");
  const bloco = page.locator("[data-settings-context]");
  await expect(bloco).toContainText(dnd["settings.context.title"]);
  const orcamento = bloco.locator('[data-context-field="budget-tokens"]');
  await expect(orcamento).toHaveValue(String(originais["context.budgetTokens"]));
  const salvar = bloco.locator("[data-context-save]");
  await expect(salvar).toBeDisabled();

  // Abaixo de 1000 a tela recusa antes do PUT.
  await orcamento.fill("999");
  await expect(bloco.locator('[data-context-field-error="budget-tokens"]')).toBeVisible();
  await expect(salvar).toBeDisabled();

  await orcamento.fill("7000");
  await bloco.locator('[data-context-field="max-decisions"]').fill("3");
  await bloco.locator("[data-context-enabled]").click();
  await expect(salvar).toBeEnabled();
  await salvar.click();
  await expect(page.getByText(dnd["settings.context.saved"])).toBeVisible();

  // Recarregar lê do servidor, e o servidor tem os três valores novos.
  await page.reload();
  await expect(page.locator('[data-context-field="budget-tokens"]')).toHaveValue("7000");
  await expect(page.locator('[data-context-field="max-decisions"]')).toHaveValue("3");
  await expect(page.locator("[data-context-enabled]")).toHaveAttribute(
    "data-state",
    originais["context.enabled"] ? "unchecked" : "checked",
  );

  const fim = await api();
  try {
    const depois = await fim.get("/api/v1/settings");
    const gravadas = (await depois.json()) as Record<string, unknown>;
    expect(gravadas["context.budgetTokens"]).toBe(7000);
    expect(gravadas["context.maxDecisions"]).toBe(3);
    expect(gravadas["context.enabled"]).toBe(!originais["context.enabled"]);

    // Devolve o que estava, para a suíte seguinte encontrar o padrão.
    for (const [key, value] of [
      ["context.budgetTokens", originais["context.budgetTokens"]],
      ["context.maxDecisions", originais["context.maxDecisions"]],
      ["context.enabled", originais["context.enabled"]],
    ] as const) {
      const restore = await fim.put(`/api/v1/settings/${key}`, { data: { value } });
      expect(restore.ok()).toBe(true);
    }
  } finally {
    await fim.dispose();
  }
});
