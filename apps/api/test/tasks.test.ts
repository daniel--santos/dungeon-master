import {
  ProblemDetailsSchema,
  type Project,
  ProjectSchema,
  type Task,
  TaskDetailSchema,
  TaskPageSchema,
  TaskReopeningListSchema,
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
  handle = createDatabase({ url: inject("databaseUrl"), max: 5, applicationName: "vitest-tasks" });
  app = criarApp(handle);
});

beforeEach(async () => {
  await limparTudo(handle);

  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Projeto de teste" },
  });
  project = ProjectSchema.parse(await response.json());
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
});

async function criarTask(body: Record<string, unknown>): Promise<Task> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks`,
    body: { projectId: project.id, ...body },
  });

  expect(response.status).toBe(201);
  return TaskSchema.parse(await response.json());
}

async function mover(taskId: string, to: string): Promise<Response> {
  return await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks/${taskId}/status`,
    body: { to },
  });
}

/** Leva a Task de `READY` até `RUNNING`, que é de onde se conclui. */
async function ateRunning(taskId: string): Promise<void> {
  for (const to of ["QUEUED", "RUNNING"]) {
    const response = await mover(taskId, to);
    expect(response.status, `transição para ${to}`).toBe(200);
  }
}

describe(`POST ${API_BASE_PATH}/tasks`, () => {
  it("nasce em READY, com os padrões de kind e priority", async () => {
    const task = await criarTask({ title: "primeira" });

    expect(task.status).toBe("READY");
    expect(task.kind).toBe("FEATURE");
    expect(task.priority).toBe("MEDIUM");
    expect(task.projectId).toBe(project.id);
    expect(task.completedAt).toBeNull();

    expect(await tiposDeActivity(handle)).toEqual(["project.created", "task.created"]);
    expect(await tiposDeEvento(handle)).toEqual(["project.created", "task.created"]);
  });

  it("um Project que não existe vira 404", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: ID_INEXISTENTE, title: "órfã" },
    });

    expect(response.status).toBe(404);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toBe("Project não encontrado");
  });

  it("sem projectId vira 400", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { title: "sem projeto" },
    });

    expect(response.status).toBe(400);
  });

  it("aceita Task mãe do mesmo Project e recusa de outro", async () => {
    const mae = await criarTask({ title: "mãe" });
    const filha = await criarTask({ title: "filha", parentTaskId: mae.id });

    expect(filha.parentTaskId).toBe(mae.id);

    const outro = ProjectSchema.parse(
      await (
        await pedir({
          app,
          method: "POST",
          path: `${API_BASE_PATH}/projects`,
          body: { title: "outro" },
        })
      ).json(),
    );

    const recusada = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: outro.id, title: "filha errada", parentTaskId: mae.id },
    });

    expect(recusada.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await recusada.json()).title).toBe(
      "Task mãe em outro Project",
    );
  });
});

describe(`PATCH ${API_BASE_PATH}/tasks/{id}`, () => {
  it("edita os campos editáveis e grava task.updated", async () => {
    const task = await criarTask({ title: "antes" });

    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${task.id}`,
      body: { title: "depois", priority: "URGENT", kind: "BUG" },
    });

    expect(response.status).toBe(200);

    const body = TaskDetailSchema.parse(await response.json());
    expect(body.title).toBe("depois");
    expect(body.priority).toBe("URGENT");
    expect(body.kind).toBe("BUG");

    expect(await tiposDeActivity(handle)).toEqual([
      "project.created",
      "task.created",
      "task.updated",
    ]);
  });

  it("nunca muda o status, mesmo com o campo no corpo", async () => {
    const task = await criarTask({ title: "imutável" });

    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${task.id}`,
      body: { title: "novo título", status: "COMPLETED" },
    });

    expect(TaskDetailSchema.parse(await response.json()).status).toBe("READY");
  });

  it("um id que não existe vira 404", async () => {
    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${ID_INEXISTENTE}`,
      body: { title: "nada" },
    });

    expect(response.status).toBe(404);
  });

  it("recusa fazer a Task descender de si mesma", async () => {
    const mae = await criarTask({ title: "mãe" });
    const filha = await criarTask({ title: "filha", parentTaskId: mae.id });

    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${mae.id}`,
      body: { parentTaskId: filha.id },
    });

    expect(response.status).toBe(409);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.title).toBe("Hierarquia em ciclo");
    expect(problem.detail).toContain(mae.id);
  });
});

describe(`POST ${API_BASE_PATH}/tasks/{id}/status`, () => {
  it("percorre o ciclo READY → QUEUED → RUNNING → COMPLETED", async () => {
    const task = await criarTask({ title: "ciclo" });

    await ateRunning(task.id);
    const concluida = await mover(task.id, "COMPLETED");

    expect(concluida.status).toBe(200);

    const body = TaskDetailSchema.parse(await concluida.json());
    expect(body.status).toBe("COMPLETED");
    expect(body.completedAt).not.toBeNull();

    expect(await tiposDeActivity(handle)).toEqual([
      "project.created",
      "task.created",
      "task.status_changed",
      "task.status_changed",
      "task.status_changed",
    ]);
  });

  it("conclui manualmente de READY para COMPLETED, sem passar por Run", async () => {
    const task = await criarTask({ title: "feito à mão" });

    const response = await mover(task.id, "COMPLETED");

    expect(response.status).toBe(200);
    const body = TaskSchema.parse(await response.json());
    expect(body.status).toBe("COMPLETED");
    expect(body.completedAt).not.toBeNull();
  });

  it("uma transição fora da máquina vira 409 dizendo o que era possível", async () => {
    const task = await criarTask({ title: "atalho" });

    // READY → RUNNING pula a fila; só o runtime leva uma Task a RUNNING.
    const response = await mover(task.id, "RUNNING");

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.title).toBe("Transição não permitida");
    expect(problem.detail).toContain("READY");
    expect(problem.detail).toContain("QUEUED");

    // Nada mudou, e nenhum evento foi gravado pela tentativa.
    expect(await tiposDeEvento(handle)).toEqual(["project.created", "task.created"]);
  });

  it("um estado terminal não tem saída", async () => {
    const task = await criarTask({ title: "cancelada" });

    expect((await mover(task.id, "CANCELLED")).status).toBe(200);

    const response = await mover(task.id, "READY");
    expect(response.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await response.json()).detail).toContain("estado terminal");
  });

  it("não conclui enquanto uma subtarefa está pendente", async () => {
    const mae = await criarTask({ title: "mãe" });
    const filha = await criarTask({ title: "filha", parentTaskId: mae.id });

    await ateRunning(mae.id);
    const recusada = await mover(mae.id, "COMPLETED");

    expect(recusada.status).toBe(409);

    const problem = ProblemDetailsSchema.parse(await recusada.json());
    expect(problem.detail).toContain(filha.id);

    // Com a filha cancelada, a mãe conclui: cancelar é uma decisão de não fazer.
    expect((await mover(filha.id, "CANCELLED")).status).toBe(200);
    expect((await mover(mae.id, "COMPLETED")).status).toBe(200);
  });

  it("não enfileira enquanto uma dependência não está concluída", async () => {
    const bloqueada = await criarTask({ title: "depende" });
    const requisito = await criarTask({ title: "requisito" });

    await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/tasks/${bloqueada.id}/dependencies/${requisito.id}`,
    });

    const recusada = await mover(bloqueada.id, "QUEUED");

    expect(recusada.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await recusada.json()).detail).toContain(requisito.id);

    await ateRunning(requisito.id);
    expect((await mover(requisito.id, "COMPLETED")).status).toBe(200);

    expect((await mover(bloqueada.id, "QUEUED")).status).toBe(200);
  });

  it("um id que não existe vira 404", async () => {
    const response = await mover(ID_INEXISTENTE, "QUEUED");

    expect(response.status).toBe(404);
  });
});

describe("dependências", () => {
  async function ligar(taskId: string, dependsOnId: string): Promise<Response> {
    return await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/tasks/${taskId}/dependencies/${dependsOnId}`,
    });
  }

  it("cria a aresta e aparece dos dois lados", async () => {
    const a = await criarTask({ title: "A" });
    const b = await criarTask({ title: "B" });

    const response = await ligar(a.id, b.id);
    expect(response.status).toBe(200);

    const detalhe = TaskDetailSchema.parse(await response.json());
    expect(detalhe.dependencies.map((item) => item.id)).toEqual([b.id]);

    const deB = TaskDetailSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks/${b.id}`)).json(),
    );
    expect(deB.dependents.map((item) => item.id)).toEqual([a.id]);

    expect(await tiposDeActivity(handle)).toContain("task.dependency_created");
  });

  it("é idempotente e não grava um segundo fato", async () => {
    const a = await criarTask({ title: "A" });
    const b = await criarTask({ title: "B" });

    await ligar(a.id, b.id);
    await ligar(a.id, b.id);

    const criadas = (await tiposDeActivity(handle)).filter(
      (type) => type === "task.dependency_created",
    );
    expect(criadas).toHaveLength(1);
  });

  it("recusa a auto-dependência com 409", async () => {
    const a = await criarTask({ title: "A" });

    const response = await ligar(a.id, a.id);

    expect(response.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toBe("Auto-dependência");
  });

  it("recusa o ciclo indireto A → B → C → A mostrando o caminho", async () => {
    const a = await criarTask({ title: "A" });
    const b = await criarTask({ title: "B" });
    const c = await criarTask({ title: "C" });

    expect((await ligar(a.id, b.id)).status).toBe(200);
    expect((await ligar(b.id, c.id)).status).toBe(200);

    const response = await ligar(c.id, a.id);

    expect(response.status).toBe(409);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.title).toBe("Ciclo de dependências");
    for (const id of [a.id, b.id, c.id]) {
      expect(problem.detail).toContain(id);
    }

    // A aresta recusada não entrou.
    const detalhe = TaskDetailSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks/${c.id}`)).json(),
    );
    expect(detalhe.dependencies.map((item) => item.id)).toEqual([]);
  });

  it("remove a aresta e grava o fato; remover de novo não grava nada", async () => {
    const a = await criarTask({ title: "A" });
    const b = await criarTask({ title: "B" });

    await ligar(a.id, b.id);

    const response = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/tasks/${a.id}/dependencies/${b.id}`,
    });

    expect(response.status).toBe(200);
    expect(TaskDetailSchema.parse(await response.json()).dependencies).toEqual([]);

    await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/tasks/${a.id}/dependencies/${b.id}`,
    });

    const removidas = (await tiposDeActivity(handle)).filter(
      (type) => type === "task.dependency_removed",
    );
    expect(removidas).toHaveLength(1);
  });

  it("uma Task que não existe vira 404", async () => {
    const a = await criarTask({ title: "A" });

    const response = await ligar(a.id, ID_INEXISTENTE);

    expect(response.status).toBe(404);
  });
});

describe(`GET ${API_BASE_PATH}/tasks/{id}`, () => {
  it("traz filhas, dependências e dependentes", async () => {
    const mae = await criarTask({ title: "mãe" });
    const filha = await criarTask({ title: "filha", parentTaskId: mae.id });
    const requisito = await criarTask({ title: "requisito" });

    await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/tasks/${mae.id}/dependencies/${requisito.id}`,
    });

    const response = await app.request(`${API_BASE_PATH}/tasks/${mae.id}`);
    const body = TaskDetailSchema.parse(await response.json());

    expect(body.children.map((item) => item.id)).toEqual([filha.id]);
    expect(body.dependencies.map((item) => item.id)).toEqual([requisito.id]);
    expect(body.dependents).toEqual([]);
  });

  it("um id que não existe vira 404", async () => {
    const response = await app.request(`${API_BASE_PATH}/tasks/${ID_INEXISTENTE}`);

    expect(response.status).toBe(404);
  });
});

describe(`GET ${API_BASE_PATH}/tasks`, () => {
  it("filtra por projectId, kind, priority e parentTaskId", async () => {
    const mae = await criarTask({ title: "mãe", kind: "CHORE" });
    const filha = await criarTask({ title: "filha", parentTaskId: mae.id, kind: "BUG" });
    await criarTask({ title: "avulsa", priority: "URGENT" });

    const porKind = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?kind=BUG`)).json(),
    );
    expect(porKind.items.map((item) => item.id)).toEqual([filha.id]);

    const porPrioridade = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?priority=URGENT`)).json(),
    );
    expect(porPrioridade.items.map((item) => item.title)).toEqual(["avulsa"]);

    const porMae = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?parentTaskId=${mae.id}`)).json(),
    );
    expect(porMae.items.map((item) => item.id)).toEqual([filha.id]);

    const porProjeto = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?projectId=${project.id}`)).json(),
    );
    expect(porProjeto.total).toBe(3);
  });

  it("aceita status uma vez e várias", async () => {
    const pronta = await criarTask({ title: "pronta" });
    const cancelada = await criarTask({ title: "cancelada" });
    await mover(cancelada.id, "CANCELLED");

    const uma = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?status=CANCELLED`)).json(),
    );
    expect(uma.items.map((item) => item.id)).toEqual([cancelada.id]);

    const varias = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?status=READY&status=CANCELLED`)).json(),
    );
    expect(varias.total).toBe(2);
    expect(varias.items.map((item) => item.id).sort()).toEqual([pronta.id, cancelada.id].sort());
  });

  it("busca por trecho do título sem diferenciar maiúsculas", async () => {
    await criarTask({ title: "Corrigir a autenticação" });
    await criarTask({ title: "Documentar o deploy" });

    const busca = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?q=AUTENTICA`)).json(),
    );

    expect(busca.items.map((item) => item.title)).toEqual(["Corrigir a autenticação"]);
  });

  it("os curingas do LIKE são escapados", async () => {
    await criarTask({ title: "cem por cento" });

    const busca = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?q=%25`)).json(),
    );

    expect(busca.items).toEqual([]);
  });

  it("pagina mantendo o total e a ordem por updatedAt desc", async () => {
    const primeira = await criarTask({ title: "primeira" });
    const segunda = await criarTask({ title: "segunda" });
    const terceira = await criarTask({ title: "terceira" });

    const pagina1 = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?page=1&pageSize=2`)).json(),
    );
    expect(pagina1.items.map((item) => item.id)).toEqual([terceira.id, segunda.id]);
    expect(pagina1.total).toBe(3);

    const pagina2 = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?page=2&pageSize=2`)).json(),
    );
    expect(pagina2.items.map((item) => item.id)).toEqual([primeira.id]);
    expect(pagina2.total).toBe(3);
  });

  it("sort=priority ordena por urgência, e não pelo alfabeto", async () => {
    // Criadas fora de ordem de propósito: se a ordenação não existisse, o
    // resultado sairia por `updatedAt`, que é a ordem inversa desta criação.
    await criarTask({ title: "média", priority: "MEDIUM" });
    await criarTask({ title: "urgente", priority: "URGENT" });
    await criarTask({ title: "baixa", priority: "LOW" });
    await criarTask({ title: "alta", priority: "HIGH" });

    const desc = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?sort=priority&order=desc`)).json(),
    );
    expect(desc.items.map((item) => item.priority)).toEqual(["URGENT", "HIGH", "MEDIUM", "LOW"]);

    const asc = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?sort=priority&order=asc`)).json(),
    );
    expect(asc.items.map((item) => item.priority)).toEqual(["LOW", "MEDIUM", "HIGH", "URGENT"]);
  });

  it("sort=title ordena pelo título nas duas direções", async () => {
    await criarTask({ title: "Beta" });
    await criarTask({ title: "Alfa" });
    await criarTask({ title: "Gama" });

    const asc = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?sort=title&order=asc`)).json(),
    );
    expect(asc.items.map((item) => item.title)).toEqual(["Alfa", "Beta", "Gama"]);

    const desc = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?sort=title&order=desc`)).json(),
    );
    expect(desc.items.map((item) => item.title)).toEqual(["Gama", "Beta", "Alfa"]);
  });

  it("sort=createdAt não segue o updatedAt", async () => {
    const primeira = await criarTask({ title: "primeira" });
    const segunda = await criarTask({ title: "segunda" });

    // Editar a primeira a joga para o topo de `updatedAt`, mas não mexe na
    // ordem de criação: é o que separa os dois campos.
    await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/tasks/${primeira.id}`,
      body: { title: "primeira, editada" },
    });

    const porEdicao = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?sort=updatedAt&order=desc`)).json(),
    );
    expect(porEdicao.items.map((item) => item.id)).toEqual([primeira.id, segunda.id]);

    const porCriacao = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?sort=createdAt&order=asc`)).json(),
    );
    expect(porCriacao.items.map((item) => item.id)).toEqual([primeira.id, segunda.id]);

    const porCriacaoDesc = TaskPageSchema.parse(
      await (await app.request(`${API_BASE_PATH}/tasks?sort=createdAt&order=desc`)).json(),
    );
    expect(porCriacaoDesc.items.map((item) => item.id)).toEqual([segunda.id, primeira.id]);
  });

  it("sem sort e order, o padrão continua updatedAt desc", async () => {
    await criarTask({ title: "antiga", priority: "URGENT" });
    const nova = await criarTask({ title: "nova", priority: "LOW" });

    const body = TaskPageSchema.parse(await (await app.request(`${API_BASE_PATH}/tasks`)).json());

    expect(body.items[0]?.id).toBe(nova.id);
  });

  it("a ordenação por prioridade se mantém estável entre as páginas", async () => {
    for (const title of ["a", "b", "c", "d"]) {
      await criarTask({ title, priority: "HIGH" });
    }

    const pagina1 = TaskPageSchema.parse(
      await (
        await app.request(`${API_BASE_PATH}/tasks?sort=priority&order=desc&page=1&pageSize=2`)
      ).json(),
    );
    const pagina2 = TaskPageSchema.parse(
      await (
        await app.request(`${API_BASE_PATH}/tasks?sort=priority&order=desc&page=2&pageSize=2`)
      ).json(),
    );

    const ids = [...pagina1.items, ...pagina2.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("um sort ou um order fora da lista vira 400", async () => {
    const porCampo = await app.request(`${API_BASE_PATH}/tasks?sort=completedAt`);
    expect(porCampo.status).toBe(400);

    const porDirecao = await app.request(`${API_BASE_PATH}/tasks?sort=title&order=cima`);
    expect(porDirecao.status).toBe(400);
  });

  it("um pageSize acima do teto é reduzido, e não recusado", async () => {
    const response = await app.request(`${API_BASE_PATH}/tasks?pageSize=9999`);
    const body = TaskPageSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.pageSize).toBe(100);
  });
});

describe(`GET ${API_BASE_PATH}/task-reopenings`, () => {
  /**
   * Grava no diário a transição que hoje a máquina de estados não produz.
   *
   * A regra da mesa de teste é usar as funções da aplicação, e aqui ela não
   * se aplica por um motivo declarado: `COMPLETED` é terminal, então nenhuma
   * rota consegue reabrir uma Task. A linha é a mesma que `recordDomainEvent`
   * escreveria no dia em que a aresta existir — é isso que a contagem lê.
   */
  async function reabrir(task: Task, at: string): Promise<void> {
    await handle.pool.query(
      `insert into activity (id, user_id, project_id, task_id, type, payload, created_at)
       values ($1, $2, $3, $4, 'task.status_changed', $5, $6)`,
      [
        crypto.randomUUID(),
        LOCAL_USER_ID,
        task.projectId,
        task.id,
        JSON.stringify({
          taskId: task.id,
          projectId: task.projectId,
          from: "COMPLETED",
          to: "READY",
        }),
        at,
      ],
    );
  }

  async function concluir(taskId: string): Promise<void> {
    await ateRunning(taskId);
    expect((await mover(taskId, "COMPLETED")).status).toBe(200);
  }

  it("vazia enquanto nenhuma Task saiu de COMPLETED", async () => {
    const bug = await criarTask({ title: "vazamento", kind: "BUG" });
    await concluir(bug.id);

    const response = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/task-reopenings` });
    expect(response.status).toBe(200);
    expect(TaskReopeningListSchema.parse(await response.json()).items).toEqual([]);
  });

  it("conta só as transições que saem de COMPLETED, por Task, e filtra por kind", async () => {
    const bug = await criarTask({ title: "vazamento", kind: "BUG" });
    const feature = await criarTask({ title: "atalho", kind: "FEATURE" });
    const intacto = await criarTask({ title: "nunca reaberto", kind: "BUG" });
    await concluir(bug.id);
    await concluir(feature.id);
    await concluir(intacto.id);

    await reabrir(bug, "2026-09-01T10:00:00.000Z");
    await reabrir(bug, "2026-09-03T10:00:00.000Z");
    await reabrir(feature, "2026-09-02T10:00:00.000Z");

    const tudo = TaskReopeningListSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/task-reopenings` })).json(),
    );
    expect(tudo.items).toEqual([
      { taskId: bug.id, count: 2, lastReopenedAt: "2026-09-03T10:00:00.000Z" },
      { taskId: feature.id, count: 1, lastReopenedAt: "2026-09-02T10:00:00.000Z" },
    ]);

    const soBugs = TaskReopeningListSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/task-reopenings?kind=BUG` })
      ).json(),
    );
    // As outras transições do diário (RUNNING → COMPLETED etc.) não contam.
    expect(soBugs.items).toEqual([
      { taskId: bug.id, count: 2, lastReopenedAt: "2026-09-03T10:00:00.000Z" },
    ]);
  });

  it("um kind desconhecido vira 400", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/task-reopenings?kind=DRAGAO`,
    });
    expect(response.status).toBe(400);
  });
});
