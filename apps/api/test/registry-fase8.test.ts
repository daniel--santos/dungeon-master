import {
  ExecutionProfileListSchema,
  HarnessListSchema,
  LoadoutPreflightSchema,
  LoadoutSchema,
  LoadoutVersionPageSchema,
  McpServerPageSchema,
  McpServerSchema,
  ModelSchema,
  ProblemDetailsSchema,
  ProviderPageSchema,
  ProviderSchema,
  RunCreatedSchema,
  SkillDetailSchema,
  SkillPageSchema,
  SkillSchema,
  SkillVersionPageSchema,
  SkillVersionSchema,
  ToolPageSchema,
  ToolSchema,
  type Project,
  ProjectSchema,
  type Task,
  TaskSchema,
} from "@dungeon-master/contracts";
import {
  createDatabase,
  type DatabaseHandle,
  LOCAL_USER_ID,
  recordHarnessPreflight,
} from "@dungeon-master/database";
import type { HarnessAdapter, HarnessContext, PreflightResult } from "@dungeon-master/runtime";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { createLoadoutPreflight } from "../src/loadout-preflight.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import { criarApp, definirWorkspace, limparTudo, pedir, tiposDeEvento } from "./support.js";

/**
 * Os registros da Fase 8A pela API: Skills com versões, Tools, servidores MCP,
 * Providers, o Loadout por referência com pin, as versões do Loadout, o
 * preflight e o `409` de blocker em `POST /runs`.
 */

let handle: DatabaseHandle;
let app: App;
let workspace: string;

const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

/** Um adapter de host falso, que responde ao preflight sem CLI nenhuma. */
function adapterFalso(input: {
  key: HarnessAdapter["key"];
  result: PreflightResult;
}): HarnessAdapter & { calls: HarnessContext[] } {
  const calls: HarnessContext[] = [];
  return {
    id: `${input.key.toLowerCase()}@host`,
    key: input.key,
    executionMode: "HOST",
    capabilities: {
      streaming: true,
      structuredOutput: true,
      resume: true,
      forkSession: false,
      multiTurnProcess: false,
      toolEvents: true,
      tokenUsage: true,
      modelSelection: true,
      agentSelection: false,
      nativePermissions: true,
      hostExecution: true,
      dockerExecution: false,
      mcpServers: true,
    },
    calls,
    preflight: (context) => {
      calls.push(context);
      return Promise.resolve(input.result);
    },
    execute: () => {
      throw new Error("não usado neste teste");
    },
    cancel: () => {
      throw new Error("não usado neste teste");
    },
  };
}

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-registros-8a",
  });
  app = criarApp(handle);
  workspace = mkdtempSync(join(tmpdir(), "dm-registros-"));
});

beforeEach(async () => {
  await limparTudo(handle);
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
  rmSync(workspace, { recursive: true, force: true });
});

async function harness(key: "CLAUDE_CODE" | "PI" | "ANTIGRAVITY"): Promise<{ id: string }> {
  const response = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` });
  const lista = HarnessListSchema.parse(await response.json());
  const found = lista.items.find((item) => item.key === key);
  if (found === undefined) throw new Error(`Harness ${key} não semeado.`);
  return found;
}

async function perfil(mode: "HOST" | "DOCKER"): Promise<{ id: string }> {
  const response = await pedir({
    app,
    method: "GET",
    path: `${API_BASE_PATH}/execution-profiles`,
  });
  const lista = ExecutionProfileListSchema.parse(await response.json());
  const found = lista.items.find((item) => item.mode === mode && item.enabled);
  if (found === undefined) throw new Error(`Perfil ${mode} não semeado.`);
  return found;
}

async function criarAgent(nome: string): Promise<{ id: string }> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/agents`,
    body: { name: nome, role: "ENGINEER", instructions: "Faça." },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function criarSkill(nome: string, content = ""): Promise<{ id: string }> {
  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/skills`,
    body: { name: nome, content },
  });
  expect(response.status).toBe(201);
  return SkillDetailSchema.parse(await response.json());
}

async function criarLoadout(body: Record<string, unknown>) {
  const response = await pedir({ app, method: "POST", path: `${API_BASE_PATH}/loadouts`, body });
  expect(response.status).toBe(201);
  return LoadoutSchema.parse(await response.json());
}

async function projetoComTask(): Promise<{ project: Project; task: Task }> {
  const criado = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Forja" },
  });
  const project = ProjectSchema.parse(await criado.json());
  await definirWorkspace(handle, { projectId: project.id, workspacePath: workspace });

  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks`,
    body: { projectId: project.id, title: "Uma Missão" },
  });
  expect(response.status).toBe(201);
  // Uma Task com Project nasce READY: é o que `POST /runs` exige.
  const task = TaskSchema.parse(await response.json());
  expect(task.status).toBe("READY");
  return { project, task };
}

describe(`${API_BASE_PATH}/skills`, () => {
  it("cria na v1, lista, lê o detalhe, edita, publica a v2 e lista as versões", async () => {
    const skill = await criarSkill("TypeScript", "# v1");

    const lista = SkillPageSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/skills` })).json(),
    );
    expect(lista.total).toBe(1);
    expect(lista.items[0]?.latestVersion).toBe(1);

    const editada = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/skills/${skill.id}`,
      body: { description: "Tipagem estrita." },
    });
    expect(SkillSchema.parse(await editada.json()).description).toBe("Tipagem estrita.");

    const publicada = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/skills/${skill.id}/versions`,
      body: { content: "# v2", changelog: "mais estrita", expectedLatestVersion: 1 },
    });
    expect(publicada.status).toBe(201);
    expect(SkillVersionSchema.parse(await publicada.json()).version).toBe(2);

    const detalhe = SkillDetailSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/skills/${skill.id}` })
      ).json(),
    );
    expect(detalhe.latestVersion).toBe(2);
    expect(detalhe.latest.content).toBe("# v2");

    const versoes = SkillVersionPageSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/skills/${skill.id}/versions` })
      ).json(),
    );
    expect(versoes.items.map((v) => v.version)).toEqual([2, 1]);

    expect(await tiposDeEvento(handle)).toEqual([
      "registry.changed",
      "registry.changed",
      "registry.changed",
    ]);
  });

  it("409 no CAS perdido, com a versão mais recente no corpo", async () => {
    const skill = await criarSkill("Corrida");
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/skills/${skill.id}/versions`,
      body: { content: "a", expectedLatestVersion: 1 },
    });
    const perdeu = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/skills/${skill.id}/versions`,
      body: { content: "b", expectedLatestVersion: 1 },
    });

    expect(perdeu.status).toBe(409);
    expect(perdeu.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    const problema = (await perdeu.json()) as { latestVersion?: number; detail: string };
    expect(problema.latestVersion).toBe(2);
    expect(problema.detail).toContain("nada foi sobrescrito");
  });

  it("409 com o nome repetido, 404 para id inexistente", async () => {
    await criarSkill("Única");
    const repetida = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/skills`,
      body: { name: "Única" },
    });
    expect(repetida.status).toBe(409);

    const sumida = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/skills/${ID_INEXISTENTE}/versions`,
    });
    expect(sumida.status).toBe(404);
  });
});

describe(`${API_BASE_PATH}/tools e /mcp-servers`, () => {
  it("as Tools de git e o `knowledge` builtIn vêm semeados", async () => {
    const tools = ToolPageSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/tools?kind=COMMAND` })
      ).json(),
    );
    expect(tools.items.map((tool) => tool.command)).toEqual([
      "git add",
      "git commit",
      "git diff",
      "git log",
      "git status",
    ]);

    const servers = McpServerPageSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/mcp-servers` })).json(),
    );
    const knowledge = servers.items.find((server) => server.name === "knowledge");
    expect(knowledge?.builtIn).toBe(true);
    expect(knowledge?.envKeys).toEqual(["DATABASE_URL"]);
  });

  it("cria um servidor STDIO com args e uma Tool MCP dele; recusa apagar o builtIn com 409", async () => {
    const criado = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/mcp-servers`,
      body: {
        name: "docs",
        transport: "STDIO",
        command: "C:\\Program Files\\node\\node.exe",
        args: ["servidor.js", "--porta", "1"],
        envKeys: ["DOCS_TOKEN"],
        readOnly: true,
      },
    });
    expect(criado.status).toBe(201);
    const server = McpServerSchema.parse(await criado.json());
    // O caminho com espaço sobrevive: é a pendência da Fase 7 que o registro fecha.
    expect(server.command).toBe("C:\\Program Files\\node\\node.exe");
    expect(server.args).toEqual(["servidor.js", "--porta", "1"]);

    const tool = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tools`,
      body: { kind: "MCP_TOOL", name: "buscar docs", mcpServerId: server.id, toolName: "search" },
    });
    expect(tool.status).toBe(201);
    expect(ToolSchema.parse(await tool.json()).toolName).toBe("search");

    const emUso = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/mcp-servers/${server.id}`,
    });
    expect(emUso.status).toBe(409);

    const servers = McpServerPageSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/mcp-servers` })).json(),
    );
    const knowledge = servers.items.find((item) => item.name === "knowledge");
    const builtIn = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/mcp-servers/${knowledge!.id}`,
    });
    expect(builtIn.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await builtIn.json()).title).toContain("sistema");
  });

  it("422 para credencial na URL; 400 para nome fora do padrão e para envKey com valor", async () => {
    // A URL é bem formada e quebra uma regra do recurso (credencial no
    // `usuário:senha@`): é o `422` dos refinamentos, com o campo em `errors[]`.
    const comSenha = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/mcp-servers`,
      body: { name: "figma", transport: "HTTP", url: "https://token@mcp.figma.com/sse" },
    });
    expect(comSenha.status).toBe(422);
    expect(ProblemDetailsSchema.parse(await comSenha.json()).errors?.[0]?.path).toBe("url");

    const nome = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/mcp-servers`,
      body: { name: "Figma MCP", transport: "HTTP", url: "https://mcp.figma.com/sse" },
    });
    expect(nome.status).toBe(400);

    const valor = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/mcp-servers`,
      body: {
        name: "figma",
        transport: "HTTP",
        url: "https://mcp.figma.com/sse",
        envKeys: ["FIGMA_TOKEN=abc"],
      },
    });
    expect(valor.status).toBe(400);
  });
});

describe(`${API_BASE_PATH}/providers e /models`, () => {
  it("lista os semeados, filtra por Harness e liga um Model ao Provider", async () => {
    const todos = ProviderPageSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/providers` })).json(),
    );
    expect(todos.items.map((p) => p.name)).toEqual(["Anthropic", "Google", "Local", "OpenAI"]);

    const doCodex = ProviderPageSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/providers?harnessKey=CODEX` })
      ).json(),
    );
    expect(doCodex.items.map((p) => p.name)).toEqual(["OpenAI"]);

    const anthropic = todos.items.find((p) => p.name === "Anthropic")!;
    const claude = await harness("CLAUDE_CODE");
    const model = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/models`,
      body: { harnessId: claude.id, providerId: anthropic.id, key: "claude-opus-5", name: "Opus" },
    });
    expect(model.status).toBe(201);
    expect(ModelSchema.parse(await model.json()).providerId).toBe(anthropic.id);

    const emUso = await pedir({
      app,
      method: "DELETE",
      path: `${API_BASE_PATH}/providers/${anthropic.id}`,
    });
    expect(emUso.status).toBe(409);

    const criado = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/providers`,
      body: { name: "Casa", kind: "API_KEY", authEnvKeys: ["CASA_KEY"], harnessKeys: ["PI"] },
    });
    expect(criado.status).toBe(201);
    expect(ProviderSchema.parse(await criado.json()).authEnvKeys).toEqual(["CASA_KEY"]);
  });
});

describe(`${API_BASE_PATH}/loadouts por referência`, () => {
  it("pina a v1, segue a mais recente na outra, e o Run congela a versão efetiva", async () => {
    const pinada = await criarSkill("Pinada", "p1");
    const solta = await criarSkill("Solta", "s1");
    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/skills/${pinada.id}/versions`,
      body: { content: "p2" },
    });

    const agent = await criarAgent("Herói");
    const claude = await harness("CLAUDE_CODE");
    const host = await perfil("HOST");
    const loadout = await criarLoadout({
      name: "Com pin",
      agentId: agent.id,
      harnessId: claude.id,
      executionProfileId: host.id,
      skillRefs: [{ skillId: pinada.id, pinnedVersion: 1 }, { skillId: solta.id }],
    });
    expect(loadout.skillRefs).toEqual([
      { skillId: pinada.id, name: "Pinada", pinnedVersion: 1, latestVersion: 2 },
      { skillId: solta.id, name: "Solta", pinnedVersion: null, latestVersion: 1 },
    ]);
    expect(loadout.skills).toEqual(["Pinada", "Solta"]);

    await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/skills/${solta.id}/versions`,
      body: { content: "s2" },
    });

    const { task } = await projetoComTask();
    const run = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks/${task.id}/runs`,
      body: { loadoutId: loadout.id },
    });
    expect(run.status).toBe(201);
    const criado = RunCreatedSchema.parse(await run.json());
    expect(criado.warnings).toEqual([]);
    expect(criado.loadoutSnapshot.skillVersions).toEqual([
      { skillId: pinada.id, name: "Pinada", version: 1, pinned: true, content: "p1" },
      { skillId: solta.id, name: "Solta", version: 2, pinned: false, content: "s2" },
    ]);
  });

  it("409 para pin inexistente e para as duas formas na mesma coleção", async () => {
    const skill = await criarSkill("Curta");
    const agent = await criarAgent("Herói");
    const claude = await harness("CLAUDE_CODE");
    const host = await perfil("HOST");

    const pin = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/loadouts`,
      body: {
        name: "Pin torto",
        agentId: agent.id,
        harnessId: claude.id,
        executionProfileId: host.id,
        skillRefs: [{ skillId: skill.id, pinnedVersion: 3 }],
      },
    });
    expect(pin.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await pin.json()).detail).toContain("versão 3");

    const misto = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/loadouts`,
      body: {
        name: "Misto",
        agentId: agent.id,
        harnessId: claude.id,
        executionProfileId: host.id,
        toolIds: [],
        tools: ["git add"],
      },
    });
    expect(misto.status).toBe(409);
    expect(ProblemDetailsSchema.parse(await misto.json()).detail).toContain("tools");
  });

  it("a forma curta da Fase 7 continua funcionando e vira referência", async () => {
    const agent = await criarAgent("Herói");
    const claude = await harness("CLAUDE_CODE");
    const host = await perfil("HOST");
    const loadout = await criarLoadout({
      name: "Forma curta",
      agentId: agent.id,
      harnessId: claude.id,
      executionProfileId: host.id,
      skills: ["review"],
      tools: ["git add", "Ler"],
      mcpServers: [{ name: "docs", transport: "STDIO", target: "node docs.js --x" }],
    });
    expect(loadout.skillRefs[0]?.name).toBe("review");
    expect(loadout.toolRefs.map((t) => t.name)).toEqual(["git add", "Ler"]);
    expect(loadout.mcpServerRefs[0]?.name).toBe("docs");
    expect(loadout.mcpServers).toEqual([
      { name: "docs", transport: "STDIO", target: "node docs.js --x" },
    ]);

    const detalhe = SkillPageSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/skills` })).json(),
    );
    expect(detalhe.items.map((s) => s.name)).toEqual(["review"]);
  });

  it("lista as versões e restaura criando uma versão nova", async () => {
    const skill = await criarSkill("Histórica");
    const agent = await criarAgent("Herói");
    const claude = await harness("CLAUDE_CODE");
    const host = await perfil("HOST");
    const loadout = await criarLoadout({
      name: "Versionado",
      agentId: agent.id,
      harnessId: claude.id,
      executionProfileId: host.id,
    });

    const v2 = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/loadouts/${loadout.id}`,
      body: { skillRefs: [{ skillId: skill.id, pinnedVersion: 1 }] },
    });
    expect(LoadoutSchema.parse(await v2.json()).version).toBe(2);

    const versoes = LoadoutVersionPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/loadouts/${loadout.id}/versions`,
        })
      ).json(),
    );
    expect(versoes.items.map((v) => v.version)).toEqual([2, 1]);
    expect(versoes.items[0]?.definition.skillRefs).toEqual([
      { skillId: skill.id, pinnedVersion: 1 },
    ]);

    const restaurado = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/loadouts/${loadout.id}/versions/1/restore`,
    });
    expect(restaurado.status).toBe(200);
    const v3 = LoadoutSchema.parse(await restaurado.json());
    expect(v3.version).toBe(3);
    expect(v3.skillRefs).toEqual([]);

    const depois = LoadoutVersionPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/loadouts/${loadout.id}/versions`,
        })
      ).json(),
    );
    expect(depois.items.map((v) => v.version)).toEqual([3, 2, 1]);

    const inexistente = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/loadouts/${loadout.id}/versions/9/restore`,
    });
    expect(inexistente.status).toBe(409);

    const sumido = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/loadouts/${ID_INEXISTENTE}/versions`,
    });
    expect(sumido.status).toBe(404);

    expect(await tiposDeEvento(handle)).toContain("loadout.updated");
  });
});

describe(`${API_BASE_PATH}/loadouts/{id}/preflight`, () => {
  it("Claude Code e Pi com o mesmo Loadout: só o Pi avisa sobre os servidores MCP", async () => {
    const servers = McpServerPageSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/mcp-servers` })).json(),
    );
    const knowledge = servers.items.find((item) => item.name === "knowledge")!;
    const agent = await criarAgent("Herói");
    const host = await perfil("HOST");

    const doClaude = await criarLoadout({
      name: "Claude com Grimório",
      agentId: agent.id,
      harnessId: (await harness("CLAUDE_CODE")).id,
      executionProfileId: host.id,
      mcpServerIds: [knowledge.id],
    });
    const doPi = await criarLoadout({
      name: "Pi com Grimório",
      agentId: agent.id,
      harnessId: (await harness("PI")).id,
      executionProfileId: host.id,
      mcpServerIds: [knowledge.id],
    });

    const claude = LoadoutPreflightSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/loadouts/${doClaude.id}/preflight`,
        })
      ).json(),
    );
    expect(claude.capabilities).toEqual({ blockers: [], warnings: [] });
    expect(claude.ready).toBe(true);
    // Sem adapter registrado nesta instância, a CLI não é medida.
    expect(claude.cli).toBeNull();
    expect(claude.docker).toBeNull();
    // O Provider vem pelo Harness: o Anthropic declara o Claude Code.
    expect(claude.provider?.name).toBe("Anthropic");
    expect(["ENV_KEY_PRESENT", "UNKNOWN"]).toContain(claude.provider?.status);

    const pi = LoadoutPreflightSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/loadouts/${doPi.id}/preflight` })
      ).json(),
    );
    expect(pi.capabilities.blockers).toEqual([]);
    expect(pi.capabilities.warnings.map((issue) => issue.code)).toEqual(["MCP_UNSUPPORTED"]);
    expect(pi.capabilities.warnings[0]?.causedBy).toEqual(["knowledge"]);
    expect(pi.ready).toBe(true);

    // `resume=true` acrescenta a intenção; Claude Code retoma, então nada muda.
    const retomada = LoadoutPreflightSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/loadouts/${doClaude.id}/preflight?resume=true`,
        })
      ).json(),
    );
    expect(retomada.capabilities.warnings).toEqual([]);
  });

  it("um perfil DOCKER sobreposto num Harness sem container vira blocker e ready=false", async () => {
    const agent = await criarAgent("Herói");
    const loadout = await criarLoadout({
      name: "Antigravity",
      agentId: agent.id,
      harnessId: (await harness("ANTIGRAVITY")).id,
      executionProfileId: (await perfil("HOST")).id,
    });
    const docker = await perfil("DOCKER");

    const preflight = LoadoutPreflightSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/loadouts/${loadout.id}/preflight?executionProfileId=${docker.id}`,
        })
      ).json(),
    );
    expect(preflight.executionProfile.mode).toBe("DOCKER");
    expect(preflight.capabilities.blockers.map((issue) => issue.code)).toEqual([
      "DOCKER_UNSUPPORTED",
    ]);
    expect(preflight.ready).toBe(false);
    expect(preflight.provider?.name).toBe("Google");

    const semPerfil = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/loadouts/${loadout.id}/preflight?executionProfileId=${ID_INEXISTENTE}`,
    });
    expect(semPerfil.status).toBe(404);
  });

  it("o que o Worker gravou no boot sai em GET /harnesses e no bloco harness do preflight (Fase 8B)", async () => {
    const claude = await harness("CLAUDE_CODE");
    const medidoEm = new Date("2026-09-09T11:00:00.000Z");
    await recordHarnessPreflight(handle.db, {
      userId: LOCAL_USER_ID,
      harnessId: claude.id,
      installedVersion: "2.1.263",
      auth: {
        status: "AUTHENTICATED",
        reason: "`claude auth status` respondeu loggedIn=true (authMethod=claude.ai)",
        checkedAt: medidoEm,
      },
    });

    const lista = HarnessListSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` })).json(),
    );
    expect(lista.items.find((item) => item.key === "CLAUDE_CODE")).toMatchObject({
      authStatus: "AUTHENTICATED",
      authCheckedAt: medidoEm.toISOString(),
      authReason: expect.stringContaining("claude auth status") as string,
    });
    // Quem nenhum Worker mediu continua nulo, e não UNKNOWN: nulo é "ninguém olhou".
    expect(lista.items.find((item) => item.key === "CODEX")?.authStatus).toBeNull();

    const agent = await criarAgent("Herói");
    const loadout = await criarLoadout({
      name: "Medido no boot",
      agentId: agent.id,
      harnessId: claude.id,
      executionProfileId: (await perfil("HOST")).id,
    });
    const preflight = LoadoutPreflightSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/loadouts/${loadout.id}/preflight`,
        })
      ).json(),
    );
    expect(preflight.harness).toMatchObject({
      installedVersion: "2.1.263",
      authStatus: "AUTHENTICATED",
      authCheckedAt: medidoEm.toISOString(),
    });
    // Sem adapter nesta instância a CLI não é medida na chamada; o boot é o que há.
    expect(preflight.cli).toBeNull();
  });

  it("com um adapter de host registrado, mede a CLI e lê a credencial do ambiente", async () => {
    const adapter = adapterFalso({
      key: "CLAUDE_CODE",
      result: {
        installed: true,
        version: "2.1.263",
        authenticated: false,
        authReason: "`claude auth status` respondeu loggedIn=false",
        problems: [],
      },
    });
    const comAdapter = criarApp(handle, {
      loadoutPreflight: createLoadoutPreflight({
        db: handle.db,
        userId: LOCAL_USER_ID,
        adapters: [adapter],
        env: { ANTHROPIC_API_KEY: "não é gravado" },
        now: () => new Date("2026-09-09T12:00:00.000Z"),
      }),
    });

    const agent = await criarAgent("Herói");
    const loadout = await criarLoadout({
      name: "Medido",
      agentId: agent.id,
      harnessId: (await harness("CLAUDE_CODE")).id,
      executionProfileId: (await perfil("HOST")).id,
    });

    const preflight = LoadoutPreflightSchema.parse(
      await (
        await pedir({
          app: comAdapter,
          method: "GET",
          path: `${API_BASE_PATH}/loadouts/${loadout.id}/preflight`,
        })
      ).json(),
    );
    expect(preflight.checkedAt).toBe("2026-09-09T12:00:00.000Z");
    expect(preflight.cli).toEqual({
      mode: "HOST",
      adapterId: "claude_code@host",
      installed: true,
      version: "2.1.263",
      authenticated: false,
      authReason: "`claude auth status` respondeu loggedIn=false",
      timedOut: false,
      problems: [],
    });
    expect(adapter.calls[0]?.mode).toBe("HOST");
    // A variável presente vence a CLI que disse "não autenticado"; só o nome sai.
    expect(preflight.provider?.status).toBe("ENV_KEY_PRESENT");
    expect(preflight.provider?.presentEnvKeys).toEqual(["ANTHROPIC_API_KEY"]);
    expect(JSON.stringify(preflight)).not.toContain("não é gravado");
    expect(preflight.ready).toBe(true);
  });
});

describe(`POST ${API_BASE_PATH}/tasks/{id}/runs com capability matching`, () => {
  it("409 com blockers[] para um Loadout Antigravity em perfil DOCKER", async () => {
    const agent = await criarAgent("Herói");
    const loadout = await criarLoadout({
      name: "Antigravity selado",
      agentId: agent.id,
      harnessId: (await harness("ANTIGRAVITY")).id,
      executionProfileId: (await perfil("DOCKER")).id,
    });
    const { task } = await projetoComTask();

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks/${task.id}/runs`,
      body: { loadoutId: loadout.id },
    });

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    const problema = (await response.json()) as {
      detail: string;
      blockers: { code: string; capability: string; causedBy: string[] }[];
    };
    expect(problema.blockers).toEqual([
      expect.objectContaining({
        code: "DOCKER_UNSUPPORTED",
        capability: "dockerExecution",
        causedBy: ["DOCKER"],
      }),
    ]);
    expect(problema.detail).toContain("`dockerExecution`");

    // Nada foi enfileirado: a Task continua READY.
    const lida = await pedir({ app, method: "GET", path: `${API_BASE_PATH}/tasks/${task.id}` });
    expect(((await lida.json()) as { status: string }).status).toBe("READY");
  });

  it("201 com warnings[] quando só há avisos", async () => {
    const servers = McpServerPageSchema.parse(
      await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/mcp-servers` })).json(),
    );
    const knowledge = servers.items.find((item) => item.name === "knowledge")!;
    const agent = await criarAgent("Herói");
    const loadout = await criarLoadout({
      name: "Pi avisado",
      agentId: agent.id,
      harnessId: (await harness("PI")).id,
      executionProfileId: (await perfil("HOST")).id,
      mcpServerIds: [knowledge.id],
    });
    const { task } = await projetoComTask();

    const response = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/tasks/${task.id}/runs`,
      body: { loadoutId: loadout.id },
    });
    expect(response.status).toBe(201);
    const criado = RunCreatedSchema.parse(await response.json());
    expect(criado.status).toBe("QUEUED");
    expect(criado.warnings.map((issue) => issue.code)).toEqual(["MCP_UNSUPPORTED"]);
    expect(criado.loadoutSnapshot.mcpServers[0]).toMatchObject({
      name: "knowledge",
      builtIn: true,
      command: "node",
    });
  });
});
