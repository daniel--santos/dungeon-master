import {
  AgentListSchema,
  AgentSchema,
  ExecutionProfileListSchema,
  ExecutionProfileSchema,
  HarnessListSchema,
  HarnessSchema,
  LoadoutListSchema,
  LoadoutSchema,
  ModelListSchema,
  ModelSchema,
  ProblemDetailsSchema,
} from "@dungeon-master/contracts";
import { createDatabase, type DatabaseHandle } from "@dungeon-master/database";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import { criarApp, limparTudo, pedir, tiposDeEvento } from "./support.js";

let handle: DatabaseHandle;
let app: App;

const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 5,
    applicationName: "vitest-registry",
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

async function harnessClaudeCode(): Promise<{ id: string }> {
  const response = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` });
  const lista = HarnessListSchema.parse(await response.json());
  const harness = lista.items.find((item) => item.key === "CLAUDE_CODE");
  if (harness === undefined) throw new Error("O Harness CLAUDE_CODE não foi semeado.");
  return harness;
}

async function perfilLigado(): Promise<{ id: string }> {
  const response = await pedir({
    app,
    method: "GET",
    path: `${API_BASE_PATH}/execution-profiles`,
  });
  const lista = ExecutionProfileListSchema.parse(await response.json());
  const perfil = lista.items.find((item) => item.enabled);
  if (perfil === undefined) throw new Error("Nenhum ExecutionProfile ligado foi semeado.");
  return perfil;
}

async function criarAgent(nome: string): Promise<{ id: string }> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/agents`,
    body: { name: nome, role: "ENGINEER", instructions: "Faça o que a Missão pede." },
  });
  expect(response.status).toBe(201);
  return AgentSchema.parse(await response.json());
}

describe(`GET ${API_BASE_PATH}/harnesses`, () => {
  it("devolve as quatro guildas semeadas, na ordem do catálogo", async () => {
    const response = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` });
    const lista = HarnessListSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(lista.items.map((item) => item.key)).toEqual([
      "CLAUDE_CODE",
      "CODEX",
      "PI",
      "ANTIGRAVITY",
    ]);
    // Antigravity tem fase própria e nasce desligado.
    expect(lista.items.find((item) => item.key === "ANTIGRAVITY")?.enabled).toBe(false);
    expect(lista.items[0]?.capabilities.resume).toBe(true);
  });

  it("não expõe criação nem remoção: o cadastro é fechado", async () => {
    const criar = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/harnesses`,
      body: { key: "CLAUDE_CODE", name: "Cópia" },
    });
    const apagar = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/harnesses/${(await harnessClaudeCode()).id}`,
    });

    expect(criar.status).toBe(404);
    expect(apagar.status).toBe(404);
  });
});

describe(`PATCH ${API_BASE_PATH}/harnesses/{id}`, () => {
  it("liga e desliga, e grava o evento de dashboard", async () => {
    const harness = await harnessClaudeCode();

    const desligado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/harnesses/${harness.id}`,
      body: { enabled: false },
    });

    expect(HarnessSchema.parse(await desligado.json()).enabled).toBe(false);
    expect(await tiposDeEvento(handle)).toEqual(["harness.updated"]);

    const religado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/harnesses/${harness.id}`,
      body: { enabled: true },
    });
    expect(HarnessSchema.parse(await religado.json()).enabled).toBe(true);
  });

  it("é idempotente: pedir o estado atual não grava fato", async () => {
    const harness = await harnessClaudeCode();

    await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/harnesses/${harness.id}`,
      body: { enabled: true },
    });

    expect(await tiposDeEvento(handle)).toEqual([]);
  });

  it("404 para um id que não existe", async () => {
    const response = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/harnesses/${ID_INEXISTENTE}`,
      body: { enabled: false },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
  });
});

describe(`${API_BASE_PATH}/models`, () => {
  it("cria, lista por Harness, edita e apaga", async () => {
    const harness = await harnessClaudeCode();

    const criado = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/models`,
      body: { harnessId: harness.id, key: "claude-opus-5", name: "Opus 5", isDefault: true },
    });
    const model = ModelSchema.parse(await criado.json());

    expect(criado.status).toBe(201);
    expect(model.isDefault).toBe(true);

    const listado = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/models?harnessId=${harness.id}`,
    });
    expect(ModelListSchema.parse(await listado.json()).items).toHaveLength(1);

    const editado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/models/${model.id}`,
      body: { name: "Opus 5 (rápido)" },
    });
    expect(ModelSchema.parse(await editado.json()).name).toBe("Opus 5 (rápido)");

    const apagado = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/models/${model.id}`,
    });
    expect(apagado.status).toBe(204);
  });

  it("marcar um novo padrão desmarca o anterior do mesmo Harness", async () => {
    const harness = await harnessClaudeCode();

    const primeiro = ModelSchema.parse(
      await (
        await pedir({
          app,
          method: "POST",
          path: `${API_BASE_PATH}/models`,
          body: { harnessId: harness.id, key: "a", name: "A", isDefault: true },
        })
      ).json(),
    );

    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/models`,
      body: { harnessId: harness.id, key: "b", name: "B", isDefault: true },
    });

    const lista = ModelListSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/models` })).json(),
    );

    expect(lista.items.filter((item) => item.isDefault)).toHaveLength(1);
    expect(lista.items.find((item) => item.id === primeiro.id)?.isDefault).toBe(false);
  });

  it("409 quando a chave já existe no mesmo Harness", async () => {
    const harness = await harnessClaudeCode();
    const corpo = { harnessId: harness.id, key: "repetida", name: "Primeira" };

    await pedir({ app, method: "POST", path: `${API_BASE_PATH}/models`, body: corpo });
    const segunda = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/models`,
      body: { ...corpo, name: "Segunda" },
    });

    expect(segunda.status).toBe(409);
    const problema = ProblemDetailsSchema.parse(await segunda.json());
    expect(problema.detail).toContain("repetida");
  });

  it("404 quando o Harness informado não existe", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/models`,
      body: { harnessId: ID_INEXISTENTE, key: "x", name: "X" },
    });

    expect(response.status).toBe(404);
  });
});

describe(`${API_BASE_PATH}/agents`, () => {
  it("cria, lê, lista, edita e apaga", async () => {
    const agent = await criarAgent("Arquiteta");

    const lido = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/agents/${agent.id}` });
    expect(AgentSchema.parse(await lido.json()).name).toBe("Arquiteta");

    const lista = AgentListSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/agents` })).json(),
    );
    expect(lista.items).toHaveLength(1);

    const editado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/agents/${agent.id}`,
      body: { role: "REVIEWER", description: "Revisa antes de aprovar." },
    });
    const depois = AgentSchema.parse(await editado.json());
    expect(depois.role).toBe("REVIEWER");
    expect(depois.description).toBe("Revisa antes de aprovar.");

    const apagado = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/agents/${agent.id}`,
    });
    expect(apagado.status).toBe(204);
  });

  it("409 quando o nome já existe", async () => {
    await criarAgent("Engenheira");

    const segunda = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/agents`,
      body: { name: "Engenheira", role: "ENGINEER", instructions: "Outra." },
    });

    expect(segunda.status).toBe(409);
  });

  it("400 quando o papel não existe no vocabulário", async () => {
    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/agents`,
      body: { name: "Bardo", role: "BARD", instructions: "Canta." },
    });

    expect(response.status).toBe(400);
    expect(ProblemDetailsSchema.parse(await response.json()).errors?.[0]?.path).toBe("role");
  });
});

describe(`${API_BASE_PATH}/execution-profiles`, () => {
  it("traz os dois perfis semeados, com o de Docker desligado", async () => {
    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/execution-profiles`,
    });
    const lista = ExecutionProfileListSchema.parse(await response.json());

    const campoAberto = lista.items.find((item) => item.mode === "HOST");
    const masmorra = lista.items.find((item) => item.mode === "DOCKER");

    expect(campoAberto?.enabled).toBe(true);
    expect(campoAberto?.workspaceStrategy).toBe("GIT_WORKTREE");
    expect(campoAberto?.enforcement).toBe("HARNESS_NATIVE");
    // A masmorra selada só é ligada na Fase 2C, quando o Docker existir.
    expect(masmorra?.enabled).toBe(false);
    expect(masmorra?.enforcement).toBe("SANDBOX_ENFORCED");
  });

  it("cria com as políticas padrão e edita uma delas", async () => {
    const criado = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/execution-profiles`,
      body: {
        name: "Só leitura",
        mode: "HOST",
        workspaceStrategy: "CURRENT",
        enforcement: "ADVISORY",
      },
    });
    const perfil = ExecutionProfileSchema.parse(await criado.json());

    expect(criado.status).toBe(201);
    expect(perfil.environmentPolicy).toEqual({ allowedVariables: [], inheritPath: true });
    expect(perfil.permissionPolicy.commandExecution).toBe("ALLOWLIST");

    const editado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/execution-profiles/${perfil.id}`,
      body: { permissionPolicy: { ...perfil.permissionPolicy, workspaceWrite: false } },
    });

    expect(ExecutionProfileSchema.parse(await editado.json()).permissionPolicy.workspaceWrite).toBe(
      false,
    );
  });
});

describe(`${API_BASE_PATH}/loadouts`, () => {
  async function criarLoadout(nome: string): Promise<{ id: string; version: number }> {
    const agent = await criarAgent(`Herói de ${nome}`);
    const harness = await harnessClaudeCode();
    const perfil = await perfilLigado();

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/loadouts`,
      body: {
        name: nome,
        agentId: agent.id,
        harnessId: harness.id,
        executionProfileId: perfil.id,
      },
    });

    expect(response.status).toBe(201);
    return LoadoutSchema.parse(await response.json());
  }

  it("nasce em v1 e sobe a versão a cada edição que muda algo", async () => {
    const loadout = await criarLoadout("Equipamento base");
    expect(loadout.version).toBe(1);

    const editado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/loadouts/${loadout.id}`,
      body: { skills: ["typescript", "postgresql"] },
    });
    const v2 = LoadoutSchema.parse(await editado.json());
    expect(v2.version).toBe(2);
    expect(v2.skills).toEqual(["typescript", "postgresql"]);

    // Enviar os mesmos valores não é uma edição: a versão conta edições.
    const semMudanca = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/loadouts/${loadout.id}`,
      body: { skills: ["typescript", "postgresql"] },
    });
    expect(LoadoutSchema.parse(await semMudanca.json()).version).toBe(2);
  });

  it("lista e apaga", async () => {
    const loadout = await criarLoadout("Para apagar");

    const lista = LoadoutListSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/loadouts` })).json(),
    );
    expect(lista.items).toHaveLength(1);

    const apagado = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/loadouts/${loadout.id}`,
    });
    expect(apagado.status).toBe(204);
  });

  it("409 ao apagar o Agent que um Loadout usa, nomeando o Loadout", async () => {
    const agent = await criarAgent("Ocupada");
    const harness = await harnessClaudeCode();
    const perfil = await perfilLigado();

    const loadout = LoadoutSchema.parse(
      await (
        await pedir({
          app,
          method: "POST",
          path: `${API_BASE_PATH}/loadouts`,
          body: {
            name: "Usa a ocupada",
            agentId: agent.id,
            harnessId: harness.id,
            executionProfileId: perfil.id,
          },
        })
      ).json(),
    );

    const response = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/agents/${agent.id}`,
    });

    expect(response.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await response.json()).detail).toContain(loadout.id);
  });

  it("409 quando o ExecutionProfile escolhido está desligado", async () => {
    const agent = await criarAgent("Quer a masmorra");
    const harness = await harnessClaudeCode();

    const perfis = ExecutionProfileListSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/execution-profiles` })
      ).json(),
    );
    const desligado = perfis.items.find((item) => !item.enabled);
    if (desligado === undefined) throw new Error("Nenhum perfil desligado foi semeado.");

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/loadouts`,
      body: {
        name: "Com perfil desligado",
        agentId: agent.id,
        harnessId: harness.id,
        executionProfileId: desligado.id,
      },
    });

    expect(response.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toContain("desligado");
  });

  it("409 quando o Model é de outro Harness", async () => {
    const agent = await criarAgent("Model errado");
    const perfil = await perfilLigado();

    const harnesses = HarnessListSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` })).json(),
    );
    const claude = harnesses.items.find((item) => item.key === "CLAUDE_CODE");
    const codex = harnesses.items.find((item) => item.key === "CODEX");
    if (claude === undefined || codex === undefined) throw new Error("Harnesses faltando.");

    const model = ModelSchema.parse(
      await (
        await pedir({
          app,
          method: "POST",
          path: `${API_BASE_PATH}/models`,
          body: { harnessId: codex.id, key: "gpt", name: "GPT" },
        })
      ).json(),
    );

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/loadouts`,
      body: {
        name: "Mistura guildas",
        agentId: agent.id,
        harnessId: claude.id,
        modelId: model.id,
        executionProfileId: perfil.id,
      },
    });

    expect(response.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await response.json()).title).toContain("outro Harness");
  });
});
