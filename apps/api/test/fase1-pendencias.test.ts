import {
  ActivityPageSchema,
  ProblemDetailsSchema,
  type Project,
  ProjectDetailSchema,
  ProjectPageSchema,
  ProjectSchema,
  TaskPageSchema,
  TaskSchema,
} from "@dungeon-master/contracts";
import { createDatabase, type DatabaseHandle } from "@dungeon-master/database";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { criarApp, limparTudo, linhasDeActivity, pedir } from "./support.js";

/**
 * As quatro pendências registradas no fechamento da Fase 1, mais o campo de
 * workspace que a Fase 2A acrescenta ao Project.
 */

let handle: DatabaseHandle;
let app: App;
let project: Project;
let workspace: string;

beforeAll(() => {
  handle = createDatabase({ url: inject("databaseUrl"), max: 5, applicationName: "vitest-fase1" });
  app = criarApp(handle);
  workspace = mkdtempSync(join(tmpdir(), "dm-workspace-fase1-"));
});

beforeEach(async () => {
  await limparTudo(handle);

  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Campanha de teste" },
  });
  project = ProjectSchema.parse(await response.json());
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
  rmSync(workspace, { recursive: true, force: true });
});

async function criarTask(body: Record<string, unknown>): Promise<{ id: string }> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks`,
    body: { projectId: project.id, ...body },
  });
  expect(response.status).toBe(201);
  return TaskSchema.parse(await response.json());
}

describe(`GET ${API_BASE_PATH}/projects — taskCounts`, () => {
  it("cada Project da página traz a contagem por estado", async () => {
    const pronta = await criarTask({ title: "Pronta" });
    await criarTask({ title: "Outra pronta" });

    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks/${pronta.id}/status`,
      body: { to: "COMPLETED" },
    });

    const response = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/projects` });
    const pagina = ProjectPageSchema.parse(await response.json());

    expect(response.status).toBe(200);
    const carta = pagina.items.find((item) => item.id === project.id);
    expect(carta?.taskCounts.READY).toBe(1);
    expect(carta?.taskCounts.COMPLETED).toBe(1);
    expect(carta?.taskCounts.INBOX).toBe(0);
  });

  it("um Project sem Task nenhuma vem com todas as contagens zeradas", async () => {
    const pagina = ProjectPageSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/projects` })).json(),
    );

    const carta = pagina.items.find((item) => item.id === project.id);
    expect(Object.values(carta?.taskCounts ?? {}).every((total) => total === 0)).toBe(true);
  });
});

describe(`GET ${API_BASE_PATH}/tasks — excludeStatus`, () => {
  beforeEach(async () => {
    await criarTask({ title: "Trabalho de verdade" });

    // Uma captura: nasce em INBOX, sem Project.
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox`,
      body: { text: "Uma ideia solta" },
    });
  });

  it("tira um estado da lista sem precisar enumerar os outros oito", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/tasks?excludeStatus=INBOX`,
    });
    const pagina = TaskPageSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(pagina.items.map((task) => task.status)).toEqual(["READY"]);
  });

  it("aceita vários, repetindo o parâmetro", async () => {
    const concluida = await criarTask({ title: "Concluída" });
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks/${concluida.id}/status`,
      body: { to: "COMPLETED" },
    });

    const pagina = TaskPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/tasks?excludeStatus=INBOX&excludeStatus=COMPLETED`,
        })
      ).json(),
    );

    expect(pagina.items.map((task) => task.title)).toEqual(["Trabalho de verdade"]);
  });

  it("combina com status: os dois filtros valem, e a interseção é o resultado", async () => {
    const pagina = TaskPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/tasks?status=READY&status=INBOX&excludeStatus=INBOX`,
        })
      ).json(),
    );

    expect(pagina.items.map((task) => task.status)).toEqual(["READY"]);
  });

  it("400 com um estado que não existe", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/tasks?excludeStatus=EXPLODIU`,
    });

    expect(response.status).toBe(400);
  });
});

describe("taskTitle no payload de activity", () => {
  it("o diário diz qual Missão, e guarda o título do instante do fato", async () => {
    const task = await criarTask({ title: "Título original" });

    await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${task.id}`,
      body: { title: "Título novo" },
    });

    const linhas = await linhasDeActivity(handle);
    const criacao = linhas.find((linha) => linha.type === "task.created");
    const edicao = linhas.find((linha) => linha.type === "task.updated");

    // A linha de criação continua dizendo o nome de quando ela foi escrita: o
    // diário conta o que aconteceu, não o que a Task se chama hoje.
    expect(criacao?.payload?.["taskTitle"]).toBe("Título original");
    expect(edicao?.payload?.["taskTitle"]).toBe("Título novo");
  });

  it("chega até a resposta da rota de diário", async () => {
    await criarTask({ title: "Aparece no diário" });

    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/projects/${project.id}/activity`,
    });
    const pagina = ActivityPageSchema.parse(await response.json());

    const criacao = pagina.items.find((item) => item.type === "task.created");
    expect((criacao?.payload as { taskTitle?: string }).taskTitle).toBe("Aparece no diário");
  });
});

describe(`PATCH ${API_BASE_PATH}/projects/{id} — workspace`, () => {
  it("aceita um caminho absoluto de um diretório existente", async () => {
    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/projects/${project.id}`,
      body: { workspaceKind: "GIT_REPO", workspacePath: workspace },
    });
    const detalhe = ProjectDetailSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(detalhe.workspaceKind).toBe("GIT_REPO");
    expect(detalhe.workspacePath).toBe(workspace);
  });

  it("400 para caminho relativo", async () => {
    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/projects/${project.id}`,
      body: { workspacePath: "./repos/forja" },
    });

    expect(response.status).toBe(400);
    const problema = ProblemDetailsSchema.parse(await response.json());
    expect(problema.errors?.[0]?.path).toBe("workspacePath");
  });

  it("400 para um diretório que não existe", async () => {
    const inexistente = join(workspace, "nao-existe-mesmo");

    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/projects/${project.id}`,
      body: { workspacePath: inexistente },
    });

    expect(response.status).toBe(400);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toContain(
      "Workspace não encontrado",
    );
  });

  it("null desliga o workspace sem passar pela validação de caminho", async () => {
    await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/projects/${project.id}`,
      body: { workspacePath: workspace },
    });

    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/projects/${project.id}`,
      body: { workspacePath: null },
    });

    expect(ProjectDetailSchema.parse(await response.json()).workspacePath).toBeNull();
  });
});
