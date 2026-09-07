import {
  InboxPageSchema,
  ProblemDetailsSchema,
  type Project,
  ProjectSchema,
  type Task,
  TaskSchema,
} from "@dungeon-master/contracts";
import { createDatabase, type DatabaseHandle, LOCAL_USER_ID } from "@dungeon-master/database";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import { criarApp, limparTudo, pedir, tiposDeActivity, tiposDeEvento } from "./support.js";

let handle: DatabaseHandle;
let app: App;
let project: Project;

const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

beforeAll(() => {
  handle = createDatabase({ url: inject("databaseUrl"), max: 5, applicationName: "vitest-inbox" });
  app = criarApp(handle);
});

beforeEach(async () => {
  await limparTudo(handle);

  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Destino das capturas" },
  });
  project = ProjectSchema.parse(await response.json());
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
});

async function capturar(text: string): Promise<Task> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/inbox`,
    body: { text },
  });

  expect(response.status).toBe(201);
  return TaskSchema.parse(await response.json());
}

describe(`POST ${API_BASE_PATH}/inbox`, () => {
  it("cria uma Task em INBOX, sem Project, com o texto no título", async () => {
    const task = await capturar("ver por que a autenticação quebra no módulo X");

    expect(task.status).toBe("INBOX");
    expect(task.projectId).toBeNull();
    expect(task.parentTaskId).toBeNull();
    expect(task.title).toBe("ver por que a autenticação quebra no módulo X");

    expect(await tiposDeActivity(handle)).toEqual(["project.created", "task.created"]);
    expect(await tiposDeEvento(handle)).toEqual(["project.created", "task.created"]);
  });

  it("recusa texto vazio com 400", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox`,
      body: { text: "   " },
    });

    expect(response.status).toBe(400);
  });
});

describe(`GET ${API_BASE_PATH}/inbox`, () => {
  it("lista da captura mais recente para a mais antiga", async () => {
    const primeira = await capturar("primeira");
    const segunda = await capturar("segunda");

    const response = await app.request(`${API_BASE_PATH}/inbox`);
    const body = InboxPageSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.items.map((item) => item.id)).toEqual([segunda.id, primeira.id]);
    expect(body.total).toBe(2);
  });

  it("não mostra o que já saiu da Inbox", async () => {
    const promovida = await capturar("vira trabalho");
    const ficou = await capturar("continua na Inbox");

    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${promovida.id}/promote`,
      body: { projectId: project.id },
    });

    const body = InboxPageSchema.parse(await (await app.request(`${API_BASE_PATH}/inbox`)).json());

    expect(body.items.map((item) => item.id)).toEqual([ficou.id]);
  });
});

describe(`POST ${API_BASE_PATH}/inbox/{id}/promote`, () => {
  it("dá Project, vai para READY e grava os dois fatos", async () => {
    const captura = await capturar("promover isto");

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${captura.id}/promote`,
      body: { projectId: project.id, title: "Título revisado", kind: "BUG", priority: "HIGH" },
    });

    expect(response.status).toBe(200);

    const task = TaskSchema.parse(await response.json());
    expect(task.status).toBe("READY");
    expect(task.projectId).toBe(project.id);
    expect(task.title).toBe("Título revisado");
    expect(task.kind).toBe("BUG");
    expect(task.priority).toBe("HIGH");

    expect(await tiposDeActivity(handle)).toEqual([
      "project.created",
      "task.created",
      "task.updated",
      "task.status_changed",
    ]);
  });

  it("sem projectId vira 400: READY sem Project é um estado que o banco recusa", async () => {
    const captura = await capturar("sem destino");

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${captura.id}/promote`,
      body: {},
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.errors?.some((issue) => issue.path === "projectId")).toBe(true);

    // A captura continua onde estava.
    const depois = await handle.pool.query<{ status: string; project_id: string | null }>(
      "select status, project_id from task where id = $1",
      [captura.id],
    );
    expect(depois.rows[0]?.status).toBe("INBOX");
    expect(depois.rows[0]?.project_id).toBeNull();
  });

  it("um Project que não existe vira 404 e um arquivado vira 409", async () => {
    const captura = await capturar("destino ruim");

    const inexistente = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${captura.id}/promote`,
      body: { projectId: ID_INEXISTENTE },
    });
    expect(inexistente.status).toBe(404);

    await pedir({ app, method: "POST", path: `${API_BASE_PATH}/projects/${project.id}/archive` });

    const arquivado = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${captura.id}/promote`,
      body: { projectId: project.id },
    });
    expect(arquivado.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await arquivado.json()).title).toBe("Project arquivado");
  });

  it("promover o que já saiu da Inbox vira 409", async () => {
    const captura = await capturar("promovida uma vez");

    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${captura.id}/promote`,
      body: { projectId: project.id },
    });

    const segunda = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${captura.id}/promote`,
      body: { projectId: project.id },
    });

    expect(segunda.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await segunda.json()).title).toBe("Task fora da Inbox");
  });

  it("um id que não existe vira 404", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${ID_INEXISTENTE}/promote`,
      body: { projectId: project.id },
    });

    expect(response.status).toBe(404);
  });
});

describe(`POST ${API_BASE_PATH}/inbox/{id}/discard`, () => {
  it("leva para CANCELLED sem apagar a linha", async () => {
    const captura = await capturar("não vale a pena");

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${captura.id}/discard`,
    });

    expect(response.status).toBe(200);

    const task = TaskSchema.parse(await response.json());
    expect(task.status).toBe("CANCELLED");
    expect(task.projectId).toBeNull();

    const linhas = await handle.pool.query("select 1 from task where id = $1", [captura.id]);
    expect(linhas.rowCount).toBe(1);

    expect(await tiposDeActivity(handle)).toEqual([
      "project.created",
      "task.created",
      "task.status_changed",
    ]);
  });

  it("descartar o que já saiu da Inbox vira 409", async () => {
    const captura = await capturar("descartada");

    await pedir({ app, method: "POST", path: `${API_BASE_PATH}/inbox/${captura.id}/discard` });

    const segunda = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${captura.id}/discard`,
    });

    expect(segunda.status).toBe(409);
  });
});

describe("a captura não escapa das regras da Task", () => {
  it("sair de INBOX pela rota de status é recusado por falta de Project", async () => {
    const captura = await capturar("tentativa de atalho");

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks/${captura.id}/status`,
      body: { to: "READY" },
    });

    expect(response.status).toBe(409);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.title).toBe("Project obrigatório");
    expect(problem.detail).toContain("promote");
  });

  it("cancelar pela rota de status continua valendo, porque não exige Project", async () => {
    const captura = await capturar("cancelável");

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks/${captura.id}/status`,
      body: { to: "CANCELLED" },
    });

    expect(response.status).toBe(200);
  });

  it("uma captura não recebe Project por PATCH: promover é a única porta", async () => {
    const captura = await capturar("por fora");

    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${captura.id}`,
      body: { projectId: project.id },
    });

    expect(response.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toBe("Task na Inbox");
  });

  it("uma captura não entra no grafo de dependências", async () => {
    const captura = await capturar("solta");

    const outra = TaskSchema.parse(
      await (
        await pedir({
          app,
          method: "POST",
          path: `${API_BASE_PATH}/tasks`,
          body: { projectId: project.id, title: "de verdade" },
        })
      ).json(),
    );

    const response = await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/tasks/${outra.id}/dependencies/${captura.id}`,
    });

    expect(response.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toBe("Task na Inbox");
  });

  it("o usuário local é o dono de toda captura", async () => {
    const captura = await capturar("de quem é");

    const dono = await handle.pool.query<{ user_id: string }>(
      "select user_id from task where id = $1",
      [captura.id],
    );

    expect(dono.rows[0]?.user_id).toBe(LOCAL_USER_ID);
  });
});
