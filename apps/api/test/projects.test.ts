import {
  ActivityPageSchema,
  ProblemDetailsSchema,
  ProjectDetailSchema,
  ProjectPageSchema,
  ProjectSchema,
} from "@dungeon-master/contracts";
import { createDatabase, type DatabaseHandle } from "@dungeon-master/database";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import { criarApp, limparTudo, pedir, tiposDeActivity, tiposDeEvento } from "./support.js";

let handle: DatabaseHandle;
let app: App;

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 5,
    applicationName: "vitest-projects",
  });
  app = criarApp(handle);
});

beforeEach(async () => {
  await limparTudo(handle);
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
});

async function criarProjeto(title = "Dungeon Master", description?: string) {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: description === undefined ? { title } : { title, description },
  });

  expect(response.status).toBe(201);
  return ProjectSchema.parse(await response.json());
}

describe(`POST ${API_BASE_PATH}/projects`, () => {
  it("cria ativo e grava activity e dashboard_event na mesma transação", async () => {
    const project = await criarProjeto("Campanha do ano", "descrição");

    expect(project.status).toBe("ACTIVE");
    expect(project.archivedAt).toBeNull();
    expect(project.description).toBe("descrição");

    expect(await tiposDeActivity(handle)).toEqual(["project.created"]);
    expect(await tiposDeEvento(handle)).toEqual(["project.created"]);
  });

  it("recusa título vazio com 400 e errors[]", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/projects`,
      body: { title: "   " },
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.errors?.[0]?.path).toBe("title");

    // Nada foi gravado: a validação recusa antes de tocar o banco.
    expect(await tiposDeEvento(handle)).toEqual([]);
  });
});

describe(`GET ${API_BASE_PATH}/projects`, () => {
  it("lista do último editado para o mais antigo, com total", async () => {
    const primeiro = await criarProjeto("primeiro");
    const segundo = await criarProjeto("segundo");

    const response = await app.request(`${API_BASE_PATH}/projects`);
    const body = ProjectPageSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.id)).toEqual([segundo.id, primeiro.id]);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
  });

  it("filtra por status", async () => {
    const ativo = await criarProjeto("ativo");
    const arquivado = await criarProjeto("arquivado");

    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/projects/${arquivado.id}/archive`,
    });

    const resposta = await app.request(`${API_BASE_PATH}/projects?status=ACTIVE`);
    const body = ProjectPageSchema.parse(await resposta.json());

    expect(body.items.map((item) => item.id)).toEqual([ativo.id]);
    expect(body.total).toBe(1);
  });

  it("pagina e mantém o total da consulta inteira", async () => {
    for (let i = 0; i < 5; i += 1) await criarProjeto(`projeto ${String(i)}`);

    const response = await app.request(`${API_BASE_PATH}/projects?page=2&pageSize=2`);
    const body = ProjectPageSchema.parse(await response.json());

    expect(body.items).toHaveLength(2);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.total).toBe(5);
  });

  it("recusa uma página não numérica com 400", async () => {
    const response = await app.request(`${API_BASE_PATH}/projects?page=abacate`);

    expect(response.status).toBe(400);
  });
});

describe(`GET ${API_BASE_PATH}/projects/{id}`, () => {
  it("traz a contagem de Tasks por estado", async () => {
    const project = await criarProjeto();

    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: project.id, title: "uma" },
    });
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: project.id, title: "outra" },
    });

    const response = await app.request(`${API_BASE_PATH}/projects/${project.id}`);
    const body = ProjectDetailSchema.parse(await response.json());

    expect(body.taskCounts.READY).toBe(2);
    expect(body.taskCounts.COMPLETED).toBe(0);
    // Todas as chaves presentes, mesmo zeradas.
    expect(Object.keys(body.taskCounts)).toHaveLength(9);
  });

  it("um id que não existe é 404 em problem details", async () => {
    const response = await app.request(
      `${API_BASE_PATH}/projects/01996d00-0000-7000-8000-0000000000ff`,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toBe("Project não encontrado");
  });

  it("um id malformado não chega ao handler e vira 400", async () => {
    const response = await app.request(`${API_BASE_PATH}/projects/nao-e-uuid`);

    expect(response.status).toBe(400);
  });
});

describe(`PATCH ${API_BASE_PATH}/projects/{id}`, () => {
  it("edita e grava project.updated com os campos que mudaram", async () => {
    const project = await criarProjeto("antes");

    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/projects/${project.id}`,
      body: { title: "depois" },
    });

    expect(response.status).toBe(200);
    expect(ProjectDetailSchema.parse(await response.json()).title).toBe("depois");
    expect(await tiposDeActivity(handle)).toEqual(["project.created", "project.updated"]);
  });

  it("um PATCH que não muda nada não vira linha no diário", async () => {
    const project = await criarProjeto("igual");

    await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/projects/${project.id}`,
      body: { title: "igual" },
    });

    expect(await tiposDeActivity(handle)).toEqual(["project.created"]);
  });

  it("description null apaga a descrição", async () => {
    const project = await criarProjeto("com descrição", "texto");

    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/projects/${project.id}`,
      body: { description: null },
    });

    expect(ProjectDetailSchema.parse(await response.json()).description).toBeNull();
  });
});

describe("arquivar e desarquivar", () => {
  it("arquiva, escreve archived_at e impede criar Task", async () => {
    const project = await criarProjeto();

    const arquivada = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/projects/${project.id}/archive`,
    });
    const body = ProjectDetailSchema.parse(await arquivada.json());

    expect(body.status).toBe("ARCHIVED");
    expect(body.archivedAt).not.toBeNull();

    const recusada = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: project.id, title: "não deveria entrar" },
    });

    expect(recusada.status).toBe(409);
    expect(recusada.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);

    const problem = ProblemDetailsSchema.parse(await recusada.json());
    expect(problem.title).toBe("Project arquivado");
    expect(problem.detail).toContain(project.id);
  });

  it("é idempotente e não grava um segundo fato", async () => {
    const project = await criarProjeto();

    await pedir({ app, method: "POST", path: `${API_BASE_PATH}/projects/${project.id}/archive` });
    await pedir({ app, method: "POST", path: `${API_BASE_PATH}/projects/${project.id}/archive` });

    expect(await tiposDeActivity(handle)).toEqual(["project.created", "project.updated"]);
  });

  it("desarquivar limpa archived_at e libera a criação de Task", async () => {
    const project = await criarProjeto();

    await pedir({ app, method: "POST", path: `${API_BASE_PATH}/projects/${project.id}/archive` });
    const resposta = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/projects/${project.id}/unarchive`,
    });

    const body = ProjectDetailSchema.parse(await resposta.json());
    expect(body.status).toBe("ACTIVE");
    expect(body.archivedAt).toBeNull();

    const criada = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: project.id, title: "agora vai" },
    });

    expect(criada.status).toBe(201);
  });
});

describe(`GET ${API_BASE_PATH}/projects/{id}/activity`, () => {
  it("lista do mais recente para o mais antigo, paginado", async () => {
    const project = await criarProjeto("com diário");

    await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/projects/${project.id}`,
      body: { title: "editado" },
    });
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: project.id, title: "uma Task" },
    });

    const response = await app.request(`${API_BASE_PATH}/projects/${project.id}/activity`);
    const body = ActivityPageSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.items.map((item) => item.type)).toEqual([
      "task.created",
      "project.updated",
      "project.created",
    ]);
    expect(body.items[0]?.taskId).not.toBeNull();

    const pagina2 = await app.request(
      `${API_BASE_PATH}/projects/${project.id}/activity?page=2&pageSize=2`,
    );
    const corpo2 = ActivityPageSchema.parse(await pagina2.json());

    expect(corpo2.items.map((item) => item.type)).toEqual(["project.created"]);
    expect(corpo2.total).toBe(3);
  });

  it("a captura promovida aparece no diário desde a criação", async () => {
    const project = await criarProjeto("destino da captura");

    const capturada = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox`,
      body: { text: "anotar a ideia do relatório" },
    });
    expect(capturada.status).toBe(201);
    const captura = (await capturada.json()) as { id: string };

    // A captura nasce sem Project: o `task.created` dela foi gravado com
    // `project_id` nulo, e é justamente esse fato que a promoção não reescreve.
    const antes = ActivityPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/projects/${project.id}/activity`)).json(),
    );
    expect(antes.items.map((item) => item.type)).toEqual(["project.created"]);

    const promovida = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/inbox/${captura.id}/promote`,
      body: { projectId: project.id },
    });
    expect(promovida.status).toBe(200);

    const depois = ActivityPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/projects/${project.id}/activity`)).json(),
    );

    expect(depois.items.map((item) => item.type)).toEqual([
      "task.status_changed",
      "task.updated",
      "task.created",
      "project.created",
    ]);
    expect(depois.total).toBe(4);

    // A linha da criação continua com `project_id` nulo na tabela: ela entrou
    // no diário pelo vínculo da Task, e não porque alguém a reescreveu.
    const criacao = depois.items.find((item) => item.type === "task.created");
    expect(criacao?.projectId).toBeNull();
    expect(criacao?.taskId).toBe(captura.id);
  });

  it("o diário não mistura as Tasks de outro Project", async () => {
    const meu = await criarProjeto("meu");
    const outro = await criarProjeto("outro");

    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: outro.id, title: "task do outro" },
    });

    const diario = ActivityPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/projects/${meu.id}/activity`)).json(),
    );

    expect(diario.items.map((item) => item.type)).toEqual(["project.created"]);
  });

  it("o diário de um Project inexistente é 404, e não uma página vazia", async () => {
    const response = await app.request(
      `${API_BASE_PATH}/projects/01996d00-0000-7000-8000-0000000000ff/activity`,
    );

    expect(response.status).toBe(404);
  });
});
