import { dnd } from "@dungeon-master/glossary";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openApprovalGate, setTheme } from "./helpers";

/**
 * Rituais e Selos de ponta a ponta, sem Worker no ar (Fase 4C).
 *
 * O primeiro teste é o caminho da tela: escrever um Ritual em YAML, ligá-lo
 * a uma Missão, partir e ver os passos nascerem `PENDING` no cockpit — sem
 * Worker o Run fica `QUEUED`, que é exatamente o que a Fase 4A garante
 * sozinha: a captura congelada e os RunSteps na mesma transação.
 *
 * O segundo é o Selo. Quem para o Run num gate é o motor, e ele não está de
 * pé; a fixture `openApprovalGate` escreve no banco o que ele escreveria, e
 * daí em diante tudo é pela interface e pela API de verdade: o toast pelo
 * SSE, a pendência na lista e na navegação, a decisão pelo CAS, e a segunda
 * decisão perdendo a corrida com o `409` que traz o gate como ficou.
 */

/** Um diretório que existe na máquina que roda a API. */
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const GATE_TITLE = "Confirmar o plano do e2e";

function yamlDefinition(name: string): string {
  return `name: ${name}
description: Escrito no e2e, em YAML.
steps:
  - type: agent
    key: analyze
    name: Analisar
    prompt: Analise a tarefa.
  - type: agent
    key: plan
    name: Planejar
    dependsOn: [analyze]
    includeOutputsOf: [analyze]
    prompt: Escreva um plano.
  - type: approval
    key: approve-plan
    name: Revisar o plano
    dependsOn: [plan]
    gateKey: plan
    title: ${GATE_TITLE}
    description: O plano precisa de confirmação antes da execução.
  - type: agent
    key: execute
    name: Executar
    dependsOn: [approve-plan]
    when:
      - kind: stepSucceeded
        step: approve-plan
    prompt: Implemente o plano.
  - type: validation
    key: validate
    name: Validar
    dependsOn: [execute]
    argv: [git, status, --porcelain]
`;
}

interface Cenario {
  readonly projectId: string;
  readonly taskId: string;
  readonly taskTitle: string;
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
 * Campanha com workspace, Missão, Herói e Equipamento pela API.
 *
 * O que estes testes provam é o Ritual e o Selo; o resto do cenário já foi
 * provado pela tela em `runs.spec`.
 */
async function prepararCenario(
  request: APIRequestContext,
  sufixo: string,
  workflowId: string | null,
): Promise<Cenario> {
  const project = await criar<{ id: string }>(request, "/api/v1/projects", {
    title: `Campanha dos Rituais ${sufixo}`,
  });
  const workspace = await request.patch(`/api/v1/projects/${project.id}`, {
    data: { workspacePath: WORKSPACE },
  });
  expect(workspace.ok()).toBe(true);

  const taskTitle = `Seguir o Ritual ${sufixo}`;
  const task = await criar<{ id: string }>(request, "/api/v1/tasks", {
    projectId: project.id,
    title: taskTitle,
    kind: "FEATURE",
    priority: "HIGH",
    ...(workflowId === null ? {} : { workflowId }),
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
    name: `Oficiante ${sufixo}`,
    role: "ENGINEER",
    instructions: "Segue o Ritual passo a passo.",
  });
  const loadout = await criar<{ id: string }>(request, "/api/v1/loadouts", {
    name: `Paramentos ${sufixo}`,
    agentId: agent.id,
    harnessId: harness!.id,
    executionProfileId: profile!.id,
  });

  return { projectId: project.id, taskId: task.id, taskTitle, loadoutId: loadout.id };
}

/** Abre um `Select` do Radix e escolhe a opção pelo nome. */
async function escolher(page: Page, rotulo: string, opcao: RegExp | string): Promise<void> {
  await page.getByLabel(rotulo, { exact: true }).first().click();
  await page.getByRole("option", { name: opcao }).click();
}

test("escreve o Ritual em YAML, liga à Missão e vê os passos nascerem na Expedição", async ({
  page,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const nome = `Ritual do e2e ${sufixo}`;

  // ------------------------------------------------ criar por texto
  await page.goto("/workflows");
  await page.getByRole("button", { name: `Novo ${dnd["entity.workflow"]}` }).click();

  const editor = page.getByRole("dialog");
  await editor.getByLabel("Definição").fill(yamlDefinition(nome));
  await editor.getByRole("button", { name: "Criar" }).click();

  // ------------------------------------------------ detalhe: grafo e versões
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
  const urlDoRitual = page.url();
  const workflowId = urlDoRitual.slice(-36);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(nome);

  await expect(page.locator("[data-step-node]")).toHaveCount(5);
  await expect(page.locator('[data-step-node="approve-plan"]')).toContainText(
    dnd["workflowStep.type.approval"],
  );
  await expect(page.locator('[data-step-node="execute"]')).toContainText("1 condição");
  await expect(page.locator("[data-workflow-latest-version='0']")).toBeVisible();
  await expect(page.locator("[data-workflow-version]")).toHaveCount(0);

  // A definição é mostrada em YAML e pode ser lida em JSON.
  await expect(page.locator('[data-definition-text="yaml"] pre')).toContainText(`name: ${nome}`);
  await page.getByRole("radio", { name: "JSON" }).click();
  await expect(page.locator('[data-definition-text="json"] pre')).toContainText('"key": "analyze"');

  // ------------------------------------------------ lista
  await page.goto("/workflows");
  const linha = page.locator(`[data-workflow="${nome}"]`);
  await expect(linha).toBeVisible();
  await expect(linha.locator("[data-workflow-versions='0']")).toBeVisible();

  // ------------------------------------------------ ligar à Missão pela tela
  const cenario = await prepararCenario(request, sufixo, null);

  await page.goto(`/tasks/${cenario.taskId}`);
  await expect(page.locator('[data-task-workflow=""]')).toHaveText(dnd["workflow.none"]);

  await page.getByRole("button", { name: "Editar" }).click();
  await escolher(page, dnd["entity.workflow"], nome);
  await expect(page.getByText(dnd["workflow.captureNote"])).toBeVisible();
  await page.getByRole("button", { name: "Salvar" }).click();

  await expect(page.locator(`[data-task-workflow="${workflowId}"]`)).toHaveText(nome);

  // ------------------------------------------------ partir
  await page.getByRole("button", { name: `Nova ${dnd["entity.run"]}` }).click();
  const partida = page.getByRole("dialog");
  await expect(partida.locator(`[data-run-workflow="${workflowId}"]`)).toContainText(nome);
  await expect(partida.locator(`[data-run-workflow="${workflowId}"]`)).toContainText(
    dnd["workflow.captureNote"],
  );
  await escolher(page, dnd["entity.loadout"], new RegExp(`Paramentos ${sufixo}`));
  await partida.getByLabel(`Aceito executar ${dnd["env.host.warning"]}`).check();
  await partida.getByRole("button", { name: "Partir" }).click();

  // ------------------------------------------------ cockpit: passos PENDING
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}/);
  await expect(page.locator("[data-run-status]").first()).toHaveText(dnd["run.status.queued"]);
  await expect(page.locator(`[data-run-workflow="${workflowId}"]`)).toContainText(`${nome} · v1`);

  const passos = page.locator("[data-run-steps]");
  await expect(passos).toContainText(dnd["entity.workflowStep.plural"]);
  await expect(passos.locator("[data-run-step]")).toHaveCount(5);
  await expect(passos.locator('[data-run-step-status="PENDING"]')).toHaveCount(5);
  await expect(passos.locator('[data-run-step="approve-plan"]')).toContainText(
    dnd["runStep.status.pending"],
  );

  // ------------------------------------------------ a versão foi congelada
  await page.goto(urlDoRitual);
  await expect(page.locator("[data-workflow-latest-version='1']")).toBeVisible();
  await expect(page.locator('[data-workflow-version="1"]')).toBeVisible();

  // ------------------------------------------------ apagar é recusado: já foi usado
  await page.getByRole("button", { name: "Apagar" }).click();
  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao).toContainText(dnd["workflow.delete.title"]);
  await confirmacao.getByRole("button", { name: `Apagar ${dnd["entity.workflow"]}` }).click();

  await expect(confirmacao.locator("[data-workflow-in-use]")).toContainText(
    dnd["workflow.delete.inUse"],
  );
  await confirmacao.getByRole("button", { name: "Voltar" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(nome);

  // ------------------------------------------------ um Ritual nunca usado pode ser apagado
  const descartavel = await criar<{ id: string }>(request, "/api/v1/workflows", {
    name: `Ritual descartável ${sufixo}`,
    steps: [{ type: "agent", key: "only", name: "Só um", prompt: "Faça." }],
  });
  await page.goto(`/workflows/${descartavel.id}`);
  await page.getByRole("button", { name: "Apagar" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: `Apagar ${dnd["entity.workflow"]}` })
    .click();

  await expect(page).toHaveURL(/\/workflows$/);
  await expect(page.locator(`[data-workflow="Ritual descartável ${sufixo}"]`)).toHaveCount(0);
});

test("o Selo: toast, pendência, decisão pela carta e a segunda decisão perde a corrida", async ({
  page,
  context,
  request,
}) => {
  await setTheme(page, true);
  const sufixo = String(Date.now());
  const nome = `Ritual selado ${sufixo}`;

  const workflow = await criar<{ id: string }>(request, "/api/v1/workflows", {
    name: nome,
    steps: [
      { type: "agent", key: "analyze", name: "Analisar", prompt: "Analise." },
      {
        type: "approval",
        key: "approve-plan",
        name: "Revisar o plano",
        dependsOn: ["analyze"],
        gateKey: "plan",
        title: GATE_TITLE,
        description: "O plano precisa de confirmação antes da execução.",
      },
      {
        type: "agent",
        key: "execute",
        name: "Executar",
        dependsOn: ["approve-plan"],
        when: [{ kind: "stepSucceeded", step: "approve-plan" }],
        prompt: "Implemente.",
      },
    ],
  });
  const cenario = await prepararCenario(request, sufixo, workflow.id);
  const run = await criar<{ id: string; status: string }>(
    request,
    `/api/v1/tasks/${cenario.taskId}/runs`,
    { loadoutId: cenario.loadoutId, prompt: "Siga o Ritual." },
  );
  expect(run.status).toBe("QUEUED");

  // ------------------------------------------------ o pedido chega por SSE, em outra tela
  await page.goto("/workflows");
  await expect(page.getByRole("heading", { level: 1, name: dnd["nav.workflows"] })).toBeVisible();
  await expect(page.locator("[data-pending-gates-count]")).toHaveCount(0);

  const { gateId } = await openApprovalGate({
    runId: run.id,
    stepKey: "approve-plan",
    gateKey: "plan",
    title: GATE_TITLE,
    description: "O plano precisa de confirmação antes da execução.",
  });

  const toast = page.locator(`[data-approval-toast="${gateId}"]`);
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(dnd["approval.toast.title"]);
  await expect(toast).toContainText(GATE_TITLE);
  await expect(page.locator("[data-pending-gates-count]")).toHaveText("1");

  await toast.getByRole("link").click();
  await expect(page).toHaveURL((url) => url.pathname === `/runs/${run.id}`);

  // ------------------------------------------------ a pendência na lista de Expedições
  await page.goto("/runs");
  const pendencia = page.locator(`[data-pending-gate="${gateId}"]`);
  await expect(pendencia).toContainText(GATE_TITLE);
  await expect(pendencia).toContainText(cenario.taskTitle);
  await expect(pendencia).toContainText(`${nome} · v1`);
  await pendencia.getByRole("link", { name: `Abrir o ${dnd["run.cockpit"]}` }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/runs/${run.id}`);

  // ------------------------------------------------ o cockpit parado no Selo
  await expect(page.locator("[data-run-status]").first()).toHaveText(
    dnd["run.status.waitingApproval"],
  );
  const carta = page.locator("[data-approval-card]");
  await expect(carta).toContainText(dnd["approval.card.title"]);
  await expect(carta).toContainText(GATE_TITLE);
  await expect(carta.locator('[data-gate-status="PENDING"]')).toBeVisible();

  const passos = page.locator("[data-run-steps]");
  await expect(
    passos.locator('[data-run-step="analyze"] [data-run-step-status="SUCCEEDED"]'),
  ).toBeVisible();
  await expect(
    passos.locator('[data-run-step="approve-plan"] [data-run-step-status="WAITING_APPROVAL"]'),
  ).toBeVisible();
  await expect(page.locator('[data-event-type="ApprovalRequested"]')).toBeVisible();

  // ------------------------------------------------ uma segunda aba hesita com a carta aberta
  const outraAba = await context.newPage();
  await outraAba.goto(`/runs/${run.id}`);
  await outraAba.getByRole("button", { name: dnd["approval.decision.reject"] }).click();
  const hesitacao = outraAba.getByRole("alertdialog");
  await expect(hesitacao).toContainText(dnd["approval.confirm.reject.title"]);

  // ------------------------------------------------ a primeira concede, com nota
  await page.getByLabel("Nota (opcional)").fill("Pode seguir.");
  await page.getByRole("button", { name: dnd["approval.decision.approve"] }).click();

  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao).toContainText(dnd["approval.confirm.approve.title"]);
  await expect(confirmacao).toContainText(dnd["approval.confirm.approve.body"]);
  await confirmacao.locator('[data-approval-confirm="approve"]').click();

  // O Run volta à fila, a carta some e o passo assenta com a decisão e a nota.
  await expect(page.locator("[data-run-status]").first()).toHaveText(dnd["run.status.queued"]);
  await expect(page.locator("[data-approval-card]")).toHaveCount(0);
  const passoDoSelo = passos.locator('[data-run-step="approve-plan"]');
  await expect(passoDoSelo.locator('[data-run-step-status="SUCCEEDED"]')).toBeVisible();
  await expect(passoDoSelo.locator('[data-step-result="approval"]')).toContainText(
    dnd["approval.status.granted"],
  );
  await expect(passoDoSelo.locator('[data-step-result="approval"]')).toContainText("Pode seguir.");
  await expect(page.locator('[data-event-type="ApprovalGranted"]')).toBeVisible();
  await expect(page.locator("[data-pending-gates-count]")).toHaveCount(0);

  // ------------------------------------------------ a segunda decisão perde a corrida
  await hesitacao.locator('[data-approval-confirm="reject"]').click();

  const conflito = outraAba.locator('[data-approval-conflict="GRANTED"]');
  await expect(conflito).toBeVisible();
  await expect(conflito).toContainText(dnd["approval.status.granted"].toLowerCase());
  await expect(conflito).toContainText("Pode seguir.");
  await expect(outraAba.locator('[data-gate-status="GRANTED"]')).toBeVisible();

  await outraAba.getByRole("button", { name: "Entendi" }).click();
  await expect(outraAba.locator("[data-approval-card]")).toHaveCount(0);
  await expect(outraAba.locator("[data-run-status]").first()).toHaveText(dnd["run.status.queued"]);
  await outraAba.close();
});
