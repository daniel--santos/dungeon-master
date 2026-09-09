import { dnd } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { seedRegistry, setTheme } from "./helpers";

/**
 * O Arsenal e o Equipamento por referência de ponta a ponta (Fase 8C), sem
 * Worker no ar.
 *
 * A fixture `seedRegistry` escreve no banco uma Habilidade com duas versões,
 * um Item, uma Relíquia e um Patronato; daí em diante tudo é pela interface
 * e pela API de verdade: a lista e a página da Habilidade com o diff e a
 * publicação de uma versão nova, os Itens, as Relíquias com a `builtIn` que
 * não se apaga, os Patronatos só com nomes de variáveis, o Equipamento
 * montado por referência fixando a v1, a compatibilidade pela Guilda do
 * Claude Code e pela do Pi, a Expedição bloqueada (Antigravity na Masmorra
 * selada) com "Partir" desabilitado, e a restauração de uma versão que
 * aparece como versão nova no histórico.
 *
 * O preflight mede a CLI na hora, com teto de 15 s por adapter, e em
 * `DOCKER` ainda pergunta ao daemon: as esperas dele são mais largas do que
 * o padrão de 10 s.
 */

/** Um diretório que existe na máquina que roda a API. */
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** O preflight sobe a CLI e, em container, o daemon: espera mais que o resto. */
const PREFLIGHT_TIMEOUT = 60_000;

async function criar<T extends { id: string }>(
  request: APIRequestContext,
  path: string,
  data: unknown,
): Promise<T> {
  const response = await request.post(path, { data });
  expect(response.ok(), `${path}: ${String(response.status())}`).toBe(true);
  return (await response.json()) as T;
}

interface Harness {
  readonly id: string;
  readonly key: string;
  readonly enabled: boolean;
}

interface Profile {
  readonly id: string;
  readonly mode: string;
  readonly enabled: boolean;
}

async function lerHarnesses(request: APIRequestContext): Promise<Harness[]> {
  const response = await request.get("/api/v1/harnesses");
  return ((await response.json()) as { items: Harness[] }).items;
}

async function lerPerfis(request: APIRequestContext): Promise<Profile[]> {
  const response = await request.get("/api/v1/execution-profiles");
  return ((await response.json()) as { items: Profile[] }).items;
}

/** Abre um `Select` do Radix e escolhe a opção pelo nome. */
async function escolher(page: Page, rotulo: string, opcao: RegExp | string): Promise<void> {
  await page.getByLabel(rotulo, { exact: true }).first().click();
  await page.getByRole("option", { name: opcao }).click();
}

test("o Arsenal: a Habilidade com versões e diff, o Item, a Relíquia e o Patronato", async ({
  page,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const seed = await seedRegistry({ suffix: sufixo });

  // ------------------------------------------------ a lista e a página da Habilidade
  await page.goto("/skills");
  await expect(page.getByRole("heading", { level: 1, name: dnd["nav.registry"] })).toBeVisible();
  const linha = page.locator(`[data-skill="${seed.names.skill}"]`);
  await expect(linha).toBeVisible();
  await expect(linha.locator("[data-skill-latest-version]")).toHaveAttribute(
    "data-skill-latest-version",
    "2",
  );

  await linha.getByRole("link", { name: seed.names.skill }).click();
  await expect(page).toHaveURL(new RegExp(`/skills/${seed.skillId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(seed.names.skill);

  // O texto da v2, como texto, e as duas versões no histórico.
  await expect(page.locator("[data-skill-text]")).toContainText("Prove que o vermelho é vermelho.");
  await expect(page.locator("[data-skill-changelog]")).toContainText("Acrescenta a prova");
  await expect(page.locator('[data-skill-version="1"]')).toBeVisible();
  await expect(page.locator('[data-skill-version="2"]')).toBeVisible();

  // Clicar na v1 mostra o texto dela; o diff v1 → v2 tem uma linha a mais.
  await page.locator('[data-skill-version="1"] button').click();
  await expect(page.locator("[data-skill-content]")).toHaveAttribute("data-skill-content", "1");
  await expect(page.locator("[data-skill-text]")).not.toContainText("Prove que o vermelho");
  const diff = page.locator("[data-skill-diff]");
  await expect(diff).toBeVisible();
  await expect(diff.locator("[data-skill-diff-added]")).toHaveAttribute(
    "data-skill-diff-added",
    "1",
  );
  await expect(diff.locator('[data-diff-line="added"]')).toContainText("Prove que o vermelho");

  // ------------------------------------------------ publicar a v3
  await page.locator("[data-skill-publish]").click();
  const publicar = page.getByRole("dialog");
  await expect(publicar).toContainText("Publicar a v3");
  const texto = publicar.getByLabel(dnd["skill.content.title"]);
  await expect(texto).toHaveValue(seed.contents.v2);
  const confirmar = publicar.getByRole("button", { name: "Publicar v3" });
  await expect(confirmar).toBeDisabled();
  await texto.fill(`${seed.contents.v2}\nE deixe o worktree limpo.`);
  await publicar.getByLabel(dnd["skill.publish.changelog"]).fill("Acrescenta a limpeza.");
  await expect(confirmar).toBeEnabled();
  await confirmar.click();

  await expect(page.locator("[data-skill-latest-version]").first()).toHaveAttribute(
    "data-skill-latest-version",
    "3",
  );
  await expect(page.locator('[data-skill-version="3"]')).toContainText("Acrescenta a limpeza.");
  await expect(page.locator("[data-skill-text]")).toContainText("E deixe o worktree limpo.");

  // ------------------------------------------------ os Itens
  await page.goto("/tools");
  const item = page.locator(`[data-tool="${seed.names.tool}"]`);
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute("data-tool-kind", "COMMAND");
  await expect(item).toContainText(dnd["tool.kind.command"]);
  await expect(item).toContainText("git status");

  // ------------------------------------------------ as Relíquias
  await page.goto("/mcp-servers");
  const reliquia = page.locator(`[data-mcp-server="${seed.names.mcpServer}"]`);
  await expect(reliquia).toBeVisible();
  // O caminho com espaço sobrevive, e a variável aparece só pelo nome.
  await expect(reliquia).toContainText("C:\\Program Files\\reliquia\\server.js --porta 0");
  await expect(reliquia.locator('[data-mcp-env-key="RELIQUIA_TOKEN"]')).toBeVisible();
  await expect(reliquia).toContainText(dnd["mcpServer.readOnly"]);

  // A do Grimório nasce com o sistema e não se apaga.
  const grimorio = page.locator('[data-mcp-server="knowledge"]');
  await expect(grimorio).toHaveAttribute("data-mcp-server-built-in", "true");
  await expect(grimorio.locator("[data-mcp-built-in-badge]")).toContainText(
    dnd["mcpServer.builtIn"],
  );
  await expect(grimorio.getByRole("button", { name: "Excluir knowledge" })).toBeDisabled();

  // ------------------------------------------------ os Patronatos
  await page.goto("/providers");
  const patronato = page.locator(`[data-provider="${seed.names.provider}"]`);
  await expect(patronato).toBeVisible();
  await expect(patronato).toContainText(dnd["provider.kind.apiKey"]);
  await expect(patronato.locator('[data-provider-env-key="DM_E2E_ORACULO_KEY"]')).toBeVisible();
  await expect(patronato.locator('[data-provider-auth="UNKNOWN"]')).toContainText(
    dnd["provider.auth.unknown"],
  );
  // Nenhum campo de valor de credencial existe no formulário.
  await patronato.getByRole("button", { name: `Editar ${seed.names.provider}` }).click();
  const formulario = page.getByRole("dialog");
  await expect(formulario.locator("[data-provider-env-keys]")).toContainText("DM_E2E_ORACULO_KEY");
  await expect(formulario.locator('input[type="password"]')).toHaveCount(0);
  await formulario.getByRole("button", { name: "Cancelar" }).click();
});

test("o Equipamento por referência: pin na v1, compatibilidade por Guilda, histórico e restaurar", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const seed = await seedRegistry({ suffix: sufixo });
  await criar<{ id: string }>(request, "/api/v1/agents", {
    name: `Ferreiro ${sufixo}`,
    role: "ENGINEER",
    instructions: "Implementa e testa no mesmo passo.",
  });
  const nome = `Forja por referência ${sufixo}`;

  // ------------------------------------------------ montar, fixando a v1
  await page.goto("/loadouts");
  await page
    .getByRole("button", { name: `Novo ${dnd["entity.loadout"]}` })
    .first()
    .click();
  await page.getByLabel("Nome", { exact: true }).fill(nome);
  await escolher(page, dnd["entity.agent"], new RegExp(`Ferreiro ${sufixo}`));

  await escolher(page, `Adicionar ${dnd["entity.skill"]}`, seed.names.skill);
  const chip = page.locator(`[data-skill-ref="${seed.names.skill}"]`);
  await expect(chip.locator("[data-skill-pin]")).toHaveAttribute("data-skill-pin", "latest");
  await chip.getByLabel(`Versão de ${seed.names.skill}`).click();
  await page.getByRole("option", { name: "Fixar na v1" }).click();
  await expect(chip.locator("[data-skill-pin]")).toHaveAttribute("data-skill-pin", "1");

  await escolher(page, `Adicionar ${dnd["entity.tool"]}`, seed.names.tool);
  await escolher(page, `Adicionar ${dnd["entity.mcpServer"]}`, seed.names.mcpServer);

  // Um Equipamento novo só tem a prévia pela matriz: Claude Code declara tudo.
  await expect(page.locator("[data-loadout-compat]")).toHaveAttribute(
    "data-loadout-compat",
    "preview",
  );
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator(`[data-loadout="${nome}"]`)).toBeVisible();

  // ------------------------------------------------ compatibilidade com o Claude Code
  const compat = page.locator("[data-loadout-compat]");
  await expect(compat.locator("[data-loadout-compat-report]")).toBeVisible({
    timeout: PREFLIGHT_TIMEOUT,
  });
  await expect(compat.locator('[data-capability-severity="BLOCKER"]')).toHaveCount(0);
  await expect(compat.locator("[data-loadout-compat-cli]")).toContainText("claude-code@host");
  await expect(compat.locator("[data-loadout-compat-provider]")).toBeVisible();
  await expect(compat.locator("[data-loadout-compat-checked-at]")).toBeVisible();

  // O pin sobreviveu à gravação e à releitura.
  await expect(
    page.locator(`[data-skill-ref="${seed.names.skill}"] [data-skill-pin]`),
  ).toHaveAttribute("data-skill-pin", "1");

  // ------------------------------------------------ e com o Pi, antes e depois de salvar
  await escolher(page, dnd["entity.harness"], "Pi");
  // Sem salvar, a prévia pela matriz já avisa: o Pi não ergue Relíquias e não
  // impõe permissão por comando.
  const previa = compat.locator("[data-loadout-compat-preview]");
  await expect(previa).toBeVisible();
  await expect(previa.locator('[data-capability-issue="MCP_UNSUPPORTED"]')).toBeVisible();
  await expect(previa.locator('[data-capability-issue="COMMAND_TOOLS_ADVISORY"]')).toBeVisible();
  await expect(previa).toContainText(dnd["loadout.compat.unsaved"]);

  await page.getByRole("button", { name: "Salvar" }).click();
  const relatorio = compat.locator("[data-loadout-compat-report]");
  await expect(relatorio).toBeVisible({ timeout: PREFLIGHT_TIMEOUT });
  await expect(relatorio.locator('[data-capability-issue="MCP_UNSUPPORTED"]')).toHaveAttribute(
    "data-capability-severity",
    "WARNING",
  );
  await expect(relatorio.locator('[data-capability-severity="BLOCKER"]')).toHaveCount(0);
  await expect(compat).toHaveAttribute("data-loadout-compat", "pending");

  // ------------------------------------------------ o histórico diz o que mudou
  const historico = page.locator("[data-loadout-history]");
  await expect(
    historico.locator('[data-loadout-version="2"] [data-loadout-version-current]'),
  ).toBeVisible();
  await expect(
    historico.locator('[data-loadout-version="2"] [data-loadout-change="harness"]'),
  ).toContainText("Claude Code");
  await expect(
    historico.locator('[data-loadout-version="2"] [data-loadout-change="harness"]'),
  ).toContainText("Pi");
  await expect(historico.locator('[data-loadout-version="1"]')).toContainText(
    dnd["loadout.history.first"],
  );

  // ------------------------------------------------ restaurar a v1 vira a v3
  await historico.locator('[data-loadout-restore="1"]').click();
  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao).toContainText("Restaurar a v1?");
  await expect(confirmacao).toContainText("versão nova");
  await confirmacao.getByRole("button", { name: dnd["loadout.restore.action"] }).click();

  await expect(
    historico.locator('[data-loadout-version="3"] [data-loadout-version-current]'),
  ).toBeVisible();
  await expect(
    historico.locator('[data-loadout-version="3"] [data-loadout-change="harness"]'),
  ).toContainText("Claude Code");
  await expect(page.getByLabel(dnd["entity.harness"], { exact: true }).first()).toContainText(
    "Claude Code",
  );
});

test("uma Expedição bloqueada: Antigravity na Masmorra selada não parte", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());

  const project = await criar<{ id: string }>(request, "/api/v1/projects", {
    title: `Campanha bloqueada ${sufixo}`,
  });
  const workspace = await request.patch(`/api/v1/projects/${project.id}`, {
    data: { workspacePath: WORKSPACE },
  });
  expect(workspace.ok()).toBe(true);
  const task = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: `Tentar partir sem poder ${sufixo}`,
    kind: "CHORE",
  });
  const agent = await criar<{ id: string }>(request, "/api/v1/agents", {
    name: `Batedor bloqueado ${sufixo}`,
    role: "EXPLORER",
    instructions: "Explora e anota o que encontra.",
  });

  const antigravity = (await lerHarnesses(request)).find((item) => item.key === "ANTIGRAVITY");
  const docker = (await lerPerfis(request)).find((item) => item.mode === "DOCKER" && item.enabled);
  expect(antigravity).toBeDefined();
  expect(docker).toBeDefined();

  // O Equipamento aponta para a Masmorra selada com uma Guilda que não roda
  // em container: a API aceita a montagem e recusa a partida.
  const nome = `Equipamento bloqueado ${sufixo}`;
  await criar<{ id: string }>(request, "/api/v1/loadouts", {
    name: nome,
    agentId: agent.id,
    harnessId: antigravity!.id,
    executionProfileId: docker!.id,
  });

  await page.goto(`/tasks/${task.id}`);
  await page.getByRole("button", { name: `Nova ${dnd["entity.run"]}` }).click();
  const dialog = page.getByRole("dialog");
  await escolher(page, dnd["entity.loadout"], nome);
  await expect(dialog.getByText(nome).first()).toBeVisible();

  // No ambiente do Equipamento (a Masmorra selada), o preflight bloqueia. O
  // rádio é visualmente escondido (`sr-only`); o clique vai no rótulo.
  await dialog.locator('[data-mode-option="DOCKER"]').click();
  await expect(dialog.locator('[data-mode-option="DOCKER"] input')).toBeChecked();
  const preflight = dialog.locator("[data-run-preflight]");
  await expect(preflight).toHaveAttribute("data-run-preflight", "blocked", {
    timeout: PREFLIGHT_TIMEOUT,
  });
  await expect(preflight).toContainText(dnd["run.preflight.blocked"]);
  const bloqueio = preflight.locator('[data-capability-issue="DOCKER_UNSUPPORTED"]');
  await expect(bloqueio).toHaveAttribute("data-capability-severity", "BLOCKER");
  await expect(bloqueio).toContainText(dnd["capability.code.dockerUnsupported"]);
  await expect(dialog.getByRole("button", { name: "Partir" })).toBeDisabled();
});
