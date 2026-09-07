import {
  ExecutionProfileListSchema,
  HarnessListSchema,
  LoadoutSchema,
  ProblemDetailsSchema,
  type Project,
  ProjectSchema,
  RunEventListSchema,
  RunEventSchema,
  RunPageSchema,
  RunSchema,
  type Task,
  TaskSchema,
} from "@dungeon-master/contracts";
import {
  claimNextQueuedRun,
  createDatabase,
  type DatabaseHandle,
  LOCAL_USER_ID,
  persistRunEvent,
} from "@dungeon-master/database";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import {
  criarApp,
  definirWorkspace,
  limparTudo,
  linhasDeActivity,
  pedir,
  tiposDeEvento,
} from "./support.js";

let handle: DatabaseHandle;
let app: App;
let project: Project;
let loadoutId: string;
let workspace: string;

const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

beforeAll(() => {
  handle = createDatabase({ url: inject("databaseUrl"), max: 6, applicationName: "vitest-runs" });
  app = criarApp(handle);
  // Um diretório de verdade: `PATCH /projects/{id}` confere a existência no
  // disco antes de gravar o caminho.
  workspace = mkdtempSync(join(tmpdir(), "dm-workspace-"));
});

beforeEach(async () => {
  await limparTudo(handle);

  const criado = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Forja de Widgets" },
  });
  project = ProjectSchema.parse(await criado.json());

  await pedir({
    app,
    method: "PATCH",
    path: `${API_BASE_PATH}/projects/${project.id}`,
    body: { workspacePath: workspace },
  });

  loadoutId = await criarLoadout();
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
  rmSync(workspace, { recursive: true, force: true });
});

async function criarLoadout(): Promise<string> {
  const harnesses = HarnessListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` })).json(),
  );
  const harness = harnesses.items.find((item) => item.key === "CLAUDE_CODE");

  const perfis = ExecutionProfileListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/execution-profiles` })).json(),
  );
  const perfil = perfis.items.find((item) => item.enabled);

  const agent = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/agents`,
    body: { name: "Engenheiro", role: "ENGINEER", instructions: "Implemente." },
  });
  const { id: agentId } = (await agent.json()) as { id: string };

  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/loadouts`,
    body: {
      name: "Claude Code em campo aberto",
      agentId,
      harnessId: harness?.id,
      executionProfileId: perfil?.id,
    },
  });

  expect(response.status).toBe(201);
  return LoadoutSchema.parse(await response.json()).id;
}

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

async function criarRun(taskId: string, body: Record<string, unknown> = {}): Promise<Response> {
  return await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks/${taskId}/runs`,
    body: { loadoutId, ...body },
  });
}

async function statusDaTask(taskId: string): Promise<string> {
  const response = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/tasks/${taskId}` });
  return ((await response.json()) as { status: string }).status;
}

describe(`POST ${API_BASE_PATH}/tasks/{id}/runs`, () => {
  it("cria o Run em QUEUED com os snapshots e leva a Task a QUEUED", async () => {
    const task = await criarTask({ title: "Forjar a bigorna", description: "Com aço bom." });

    const response = await criarRun(task.id);
    const run = RunSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(run.status).toBe("QUEUED");
    expect(run.attempt).toBe(1);
    expect(run.harnessKey).toBe("CLAUDE_CODE");
    expect(run.executionMode).toBe("HOST");
    expect(run.loadoutVersion).toBe(1);
    expect(run.loadoutSnapshot.agent.instructions).toBe("Implemente.");
    expect(run.executionProfileSnapshot.enforcement).toBe("HARNESS_NATIVE");
    // Sem `prompt`, ele é montado a partir do título e da descrição.
    expect(run.prompt).toBe("Forjar a bigorna\n\nCom aço bom.");

    expect(await statusDaTask(task.id)).toBe("QUEUED");
  });

  it("aceita um prompt próprio", async () => {
    const task = await criarTask({ title: "Com prompt" });
    const run = RunSchema.parse(await (await criarRun(task.id, { prompt: "Faça assim." })).json());

    expect(run.prompt).toBe("Faça assim.");
  });

  it("grava activity e dashboard_event na mesma transação", async () => {
    const task = await criarTask({ title: "Com diário" });
    await criarRun(task.id);

    const activity = (await linhasDeActivity(handle)).map((linha) => linha.type);
    // A criação e o `PATCH` do workspace vêm do `beforeEach`; depois da Task,
    // a criação do Run grava três fatos: o Run nasceu, o Run foi enfileirado e
    // a Task acompanhou.
    expect(activity).toEqual([
      "project.created",
      "project.updated",
      "task.created",
      "run.created",
      "run.status_changed",
      "task.status_changed",
    ]);

    const eventos = await tiposDeEvento(handle);
    expect(eventos).toContain("run.created");
    expect(eventos).toContain("run.status_changed");
  });

  it("409 quando o Project não tem workspace", async () => {
    await definirWorkspace(handle, { projectId: project.id, workspacePath: null });
    const task = await criarTask({ title: "Sem onde rodar" });

    const response = await criarRun(task.id);

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    const problema = ProblemDetailsSchema.parse(await response.json());
    expect(problema.detail).toContain("workspacePath");
  });

  it("409 quando a Task tem dependência pendente", async () => {
    const bloqueadora = await criarTask({ title: "Vem antes" });
    const dependente = await criarTask({ title: "Espera a outra" });

    await pedir({
      app,
      method: "PUT",
      path: `${API_BASE_PATH}/tasks/${dependente.id}/dependencies/${bloqueadora.id}`,
    });

    const response = await criarRun(dependente.id);

    expect(response.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await response.json()).detail).toContain(bloqueadora.id);
  });

  it("409 quando a Task está fora de READY e FAILED", async () => {
    const task = await criarTask({ title: "Já em execução" });
    await criarRun(task.id);

    const segunda = await criarRun(task.id);

    expect(segunda.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await segunda.json()).detail).toContain("QUEUED");
  });

  it("404 quando a Task não existe", async () => {
    const response = await criarRun(ID_INEXISTENTE);
    expect(response.status).toBe(404);
  });

  it("404 quando o Loadout não existe", async () => {
    const task = await criarTask({ title: "Loadout fantasma" });
    const response = await criarRun(task.id, { loadoutId: ID_INEXISTENTE });

    expect(response.status).toBe(404);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toContain("Loadout");
  });
});

describe(`GET ${API_BASE_PATH}/runs`, () => {
  it("filtra por Task, por Project e por estado", async () => {
    const a = await criarTask({ title: "Run A" });
    const b = await criarTask({ title: "Run B" });
    const runA = RunSchema.parse(await (await criarRun(a.id)).json());
    await criarRun(b.id);

    const porTask = RunPageSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs?taskId=${a.id}` })
      ).json(),
    );
    expect(porTask.items.map((run) => run.id)).toEqual([runA.id]);

    const porProject = RunPageSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs?projectId=${project.id}` })
      ).json(),
    );
    expect(porProject.total).toBe(2);

    const porEstado = RunPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/runs?status=QUEUED&status=RUNNING`,
        })
      ).json(),
    );
    expect(porEstado.total).toBe(2);

    const vazio = RunPageSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/runs?status=SUCCEEDED` })
      ).json(),
    );
    expect(vazio.total).toBe(0);
  });

  it("400 com um estado que não existe", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs?status=EXPLODIU`,
    });
    expect(response.status).toBe(400);
  });
});

describe(`GET ${API_BASE_PATH}/runs/{id}`, () => {
  it("devolve o Run com os snapshots", async () => {
    const task = await criarTask({ title: "Para ler" });
    const criado = RunSchema.parse(await (await criarRun(task.id)).json());

    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${criado.id}`,
    });
    const run = RunSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(run.id).toBe(criado.id);
    expect(run.projectId).toBe(project.id);
  });

  it("404 para um id que não existe", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${ID_INEXISTENTE}`,
    });
    expect(response.status).toBe(404);
  });
});

describe(`POST ${API_BASE_PATH}/runs/{id}/cancel`, () => {
  it("em QUEUED cancela na hora e devolve a Task a READY", async () => {
    const task = await criarTask({ title: "Cancelar antes de rodar" });
    const criado = RunSchema.parse(await (await criarRun(task.id)).json());

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/runs/${criado.id}/cancel`,
    });
    const run = RunSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(run.status).toBe("CANCELLED");
    expect(run.cancelRequestedAt).not.toBeNull();
    // Cancelar a execução não cancela a tarefa: o trabalho volta ao quadro.
    expect(await statusDaTask(task.id)).toBe("READY");
  });

  it("em RUNNING só marca o pedido, e a Task continua em RUNNING", async () => {
    const task = await criarTask({ title: "Cancelar rodando" });
    const criado = RunSchema.parse(await (await criarRun(task.id)).json());

    // O worker reclamaria assim: o Run vai a PREPARING e a Task a RUNNING.
    await claimNextQueuedRun(handle.db, { userId: LOCAL_USER_ID });

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/runs/${criado.id}/cancel`,
    });
    const run = RunSchema.parse(await response.json());

    expect(run.status).toBe("PREPARING");
    expect(run.cancelRequestedAt).not.toBeNull();
    expect(await statusDaTask(task.id)).toBe("RUNNING");
  });

  it("é idempotente", async () => {
    const task = await criarTask({ title: "Cancelar duas vezes" });
    const criado = RunSchema.parse(await (await criarRun(task.id)).json());

    await pedir({ app, method: "POST", path: `${API_BASE_PATH}/runs/${criado.id}/cancel` });
    const segunda = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/runs/${criado.id}/cancel`,
    });

    expect(segunda.status).toBe(200);
    expect(RunSchema.parse(await segunda.json()).status).toBe("CANCELLED");
  });

  it("404 para um Run que não existe", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/runs/${ID_INEXISTENTE}/cancel`,
    });
    expect(response.status).toBe(404);
  });
});

describe(`GET ${API_BASE_PATH}/runs/{id}/events`, () => {
  async function comEventos(quantidade: number): Promise<string> {
    const task = await criarTask({ title: `Log de ${String(quantidade)}` });
    const run = RunSchema.parse(await (await criarRun(task.id)).json());

    for (let i = 0; i < quantidade; i += 1) {
      await persistRunEvent(handle.db, {
        userId: LOCAL_USER_ID,
        runId: run.id,
        event: { type: `Evento${String(i)}`, payload: { indice: i } },
      });
    }

    return run.id;
  }

  it("devolve o log em ordem crescente de sequence", async () => {
    const runId = await comEventos(3);

    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${runId}/events`,
    });
    const lista = RunEventListSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(lista.items.map((evento) => evento.sequence)).toEqual([1, 2, 3]);
    expect(lista.hasMore).toBe(false);
    expect(lista.lastSequence).toBe(3);
  });

  it("respeita o cursor e o limite, e avisa que há mais", async () => {
    const runId = await comEventos(5);

    const primeira = RunEventListSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/runs/${runId}/events?limit=2`,
        })
      ).json(),
    );

    expect(primeira.items.map((evento) => evento.sequence)).toEqual([1, 2]);
    expect(primeira.hasMore).toBe(true);

    const segunda = RunEventListSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/runs/${runId}/events?after=${String(primeira.lastSequence)}&limit=10`,
        })
      ).json(),
    );

    expect(segunda.items.map((evento) => evento.sequence)).toEqual([3, 4, 5]);
    expect(segunda.hasMore).toBe(false);
  });

  it("404 para um Run que não existe, em vez de página vazia", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${ID_INEXISTENTE}/events`,
    });
    expect(response.status).toBe(404);
  });
});

describe(`GET ${API_BASE_PATH}/runs/{id}/events/stream`, () => {
  /** Lê quadros SSE até juntar `esperados` eventos ou o tempo acabar. */
  async function lerEventos(
    response: Response,
    esperados: number,
    timeoutMs = 5_000,
  ): Promise<Array<{ id: string; data: string }>> {
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("O stream não devolveu corpo.");

    const decoder = new TextDecoder();
    const quadros: Array<{ id: string; data: string }> = [];
    let buffer = "";
    const limite = Date.now() + timeoutMs;

    try {
      while (quadros.length < esperados && Date.now() < limite) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let corte = buffer.indexOf("\n\n");
        while (corte >= 0) {
          const quadro = buffer.slice(0, corte);
          buffer = buffer.slice(corte + 2);

          const id = /(?:^|\n)id:\s*(.*)/.exec(quadro)?.[1]?.trim();
          const data = /(?:^|\n)data:\s*(.*)/.exec(quadro)?.[1]?.trim();
          if (id !== undefined && data !== undefined) quadros.push({ id, data });

          corte = buffer.indexOf("\n\n");
        }
      }
    } finally {
      await reader.cancel();
    }

    return quadros;
  }

  it("faz replay a partir de since e depois entrega o que chega ao vivo", async () => {
    const task = await criarTask({ title: "Cristal de visão" });
    const run = RunSchema.parse(await (await criarRun(task.id)).json());

    for (const tipo of ["RunQueued", "RunPreparing", "RunStarted"]) {
      await persistRunEvent(handle.db, {
        userId: LOCAL_USER_ID,
        runId: run.id,
        event: { type: tipo },
      });
    }

    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${run.id}/events/stream?since=1`,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    // Um evento novo depois do replay: o poller o entrega pelo tique de
    // segurança, que nos testes é curto.
    const aoVivo = persistRunEvent(handle.db, {
      userId: LOCAL_USER_ID,
      runId: run.id,
      event: { type: "TextDelta", payload: { text: "oi" } },
    });

    const quadros = await lerEventos(response, 3);
    await aoVivo;

    // `since=1` corta o primeiro: o cursor é exclusivo.
    expect(quadros.map((quadro) => quadro.id)).toEqual(["2", "3", "4"]);
    expect(RunEventSchema.parse(JSON.parse(quadros[0]!.data)).type).toBe("RunPreparing");
    expect(RunEventSchema.parse(JSON.parse(quadros[2]!.data)).type).toBe("TextDelta");
  });

  it("o Last-Event-ID tem precedência sobre o since da URL", async () => {
    const task = await criarTask({ title: "Reconexão" });
    const run = RunSchema.parse(await (await criarRun(task.id)).json());

    for (const tipo of ["A", "B", "C"]) {
      await persistRunEvent(handle.db, {
        userId: LOCAL_USER_ID,
        runId: run.id,
        event: { type: tipo },
      });
    }

    // A URL está velha (`since=0`), mas o browser sabe que já recebeu até o 2.
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${run.id}/events/stream?since=0`,
      headers: { "last-event-id": "2" },
    });

    const quadros = await lerEventos(response, 1);

    expect(quadros.map((quadro) => quadro.id)).toEqual(["3"]);
  });

  it("404 para um Run que não existe", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${ID_INEXISTENTE}/events/stream`,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
  });
});
