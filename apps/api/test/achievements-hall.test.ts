import { loadCatalog, loadTemplates } from "@dungeon-master/achievements";
import {
  type DatabaseHandle,
  createDatabase,
  LOCAL_USER_ID,
  projectAchievements,
} from "@dungeon-master/database";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";

import { criarApp, limparTudo, pedir } from "./support.js";

/**
 * O Hall com estado, pela API (planejamento v0.4, Fase 2.5B, item 7).
 *
 * A massa nasce pelas rotas — Project, Task, transição de status —, e o
 * projetor roda como no Worker, sobre o que a API acabou de gravar. É o mesmo
 * caminho que a web vai exercitar.
 */

const catalogo = loadCatalog();
const templates = loadTemplates();

let handle: DatabaseHandle;
let app: App;

async function projetar() {
  return await projectAchievements(handle.db, {
    userId: LOCAL_USER_ID,
    definitions: catalogo.valid,
    templates: templates.valid,
    lagMs: 0,
  });
}

async function corpo<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface ItemDeConquista {
  key: string | null;
  origin: string;
  state: string;
  rarity: string;
  name: { theme: string; plain: string };
  scopeLabel: string | null;
  progress: { current: number; target: number; percent: number };
  tier: { current: number; total: number; label: string | null };
}

interface ListaDeConquistas {
  items: ItemDeConquista[];
  counts: { total: number; unlocked: number; inProgress: number; locked: number; hidden: number };
}

async function criarProjectETask(): Promise<{ projectId: string; taskId: string }> {
  const project = await corpo<{ id: string }>(
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/projects`,
      body: { title: "Cripta Submersa" },
    }),
  );

  const task = await corpo<{ id: string }>(
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks`,
      body: { projectId: project.id, title: "Derrotar o vazamento", kind: "BUG" },
    }),
  );

  return { projectId: project.id, taskId: task.id };
}

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-hall",
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

describe(`GET ${API_BASE_PATH}/achievements`, () => {
  it("devolve o catálogo carregado, com estado e contadores", async () => {
    await criarProjectETask();
    expect((await projetar()).ok).toBe(true);

    const response = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/achievements` });
    expect(response.status).toBe(200);

    const body = await corpo<ListaDeConquistas>(response);

    expect(body.counts.total).toBeGreaterThanOrEqual(catalogo.valid.length);
    expect(body.counts.unlocked).toBe(0);

    const primeira = body.items.find((item) => item.key === "first_expedition");
    expect(primeira?.state).toBe("LOCKED");
    expect(primeira?.name.theme).toBe("Primeira Expedição");
    expect(primeira?.tier).toEqual({ current: 0, total: 1, label: null });

    const guardiao = body.items.find((item) => item.key === "campaign_guardian");
    expect(guardiao?.state).toBe("HIDDEN");
    expect(guardiao?.name.theme).toBe("Guardião de Cripta Submersa");
    expect(guardiao?.scopeLabel).toBe("Cripta Submersa");
  });

  it("uma Missão BUG concluída deixa Caçador de Monstros em 1 de 10", async () => {
    const { taskId } = await criarProjectETask();

    const transicao = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks/${taskId}/status`,
      body: { to: "COMPLETED" },
    });
    expect(transicao.status).toBe(200);

    await projetar();

    const body = await corpo<ListaDeConquistas>(
      await pedir({ app, method: "GET", path: `${API_BASE_PATH}/achievements` }),
    );

    const cacador = body.items.find((item) => item.key === "monster_slayer");
    expect(cacador?.state).toBe("IN_PROGRESS");
    expect(cacador?.progress).toEqual({ current: 1, target: 10, percent: 10 });
    expect(cacador?.tier).toEqual({ current: 0, total: 3, label: null });

    // Uma Expedição vitoriosa não existe: "Primeira Expedição" continua trancada.
    expect(body.items.find((item) => item.key === "first_expedition")?.state).toBe("LOCKED");
  });

  it("filtra por origem, raridade e estado, sem mexer nos contadores", async () => {
    await criarProjectETask();
    await projetar();

    const filtrada = await corpo<ListaDeConquistas>(
      await pedir({
        app,
        method: "GET",
        path: `${API_BASE_PATH}/achievements?origin=TEMPLATE&state=HIDDEN`,
      }),
    );

    expect(filtrada.items.length).toBeGreaterThan(0);
    expect(filtrada.items.every((item) => item.origin === "TEMPLATE")).toBe(true);
    expect(filtrada.items.every((item) => item.state === "HIDDEN")).toBe(true);
    expect(filtrada.counts.total).toBeGreaterThan(filtrada.items.length);

    const porRaridade = await corpo<ListaDeConquistas>(
      await pedir({ app, method: "GET", path: `${API_BASE_PATH}/achievements?rarity=EPIC` }),
    );
    expect(porRaridade.items.every((item) => item.rarity === "EPIC")).toBe(true);
  });

  it("recusa um filtro fora do vocabulário", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/achievements?state=QUASE`,
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe(`${API_BASE_PATH}/achievements/unlocks`, () => {
  it("lista a crônica e marca um desbloqueio como visto", async () => {
    const { taskId } = await criarProjectETask();

    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks/${taskId}/status`,
      body: { to: "COMPLETED" },
    });

    // Cinco Campanhas fundam "Fundador de Campanhas", que é o desbloqueio que
    // esta suíte consegue produzir sem runtime de agente.
    for (const titulo of ["Uma", "Duas", "Três", "Quatro"]) {
      await pedir({
        app,
        method: "POST",
        path: `${API_BASE_PATH}/projects`,
        body: { title: titulo },
      });
    }

    await projetar();

    const crônica = await corpo<{
      items: { id: string; key: string | null; seenAt: string | null; tier: number }[];
      total: number;
      page: number;
      pageSize: number;
    }>(await pedir({ app, method: "GET", path: `${API_BASE_PATH}/achievements/unlocks` }));

    expect(crônica.total).toBeGreaterThan(0);
    expect(crônica.page).toBe(1);

    const fundador = crônica.items.find((item) => item.key === "campaign_founder");
    expect(fundador).toBeDefined();
    expect(fundador?.seenAt).toBeNull();

    const visto = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/achievements/unlocks/${fundador?.id ?? ""}/seen`,
    });

    expect(visto.status).toBe(200);
    expect((await corpo<{ seenAt: string | null }>(visto)).seenAt).not.toBeNull();
  });

  it("um desbloqueio inexistente é 404 em problem+json", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/achievements/unlocks/01996d00-0000-7000-8000-0000000000ff/seen`,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe(`GET ${API_BASE_PATH}/heroes/stats`, () => {
  it("devolve as duas listas, vazias enquanto nenhuma Expedição terminou", async () => {
    await criarProjectETask();
    await projetar();

    const response = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/heroes/stats` });
    expect(response.status).toBe(200);

    const body = await corpo<{ agents: unknown[]; loadouts: unknown[] }>(response);
    expect(body.agents).toEqual([]);
    expect(body.loadouts).toEqual([]);
  });
});
