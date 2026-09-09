import type { HarnessCapabilities } from "@dungeon-master/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { findAgentRow } from "../src/agent.js";
import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { listExecutionProfiles } from "../src/execution-profile.js";
import {
  createModel,
  findHarnessRow,
  listHarnesses,
  recordHarnessPreflight,
  toHarness,
} from "../src/harness.js";
import {
  buildLoadoutSnapshot,
  createLoadout,
  findLoadoutRow,
  getLoadout,
  listLoadoutVersions,
  restoreLoadoutVersion,
  updateLoadout,
} from "../src/loadout.js";
import {
  createMcpServer,
  deleteMcpServer,
  findMcpServerRowByName,
  updateMcpServer,
} from "../src/mcp-server.js";
import { createProvider, deleteProvider, findProviderForHarness } from "../src/provider.js";
import { createRun } from "../src/run.js";
import {
  createSkill,
  deleteSkill,
  getSkillDetail,
  listSkillVersions,
  publishSkillVersion,
} from "../src/skill.js";
import { createTool, deleteTool } from "../src/tool.js";
import {
  criarEquipamento,
  criarProjectComWorkspace,
  criarTask,
  type Equipamento,
  exigirOk,
  limparExecucao,
  USER,
} from "./support.js";

let handle: DatabaseHandle;
let equipamento: Equipamento;

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 4,
    applicationName: "vitest-registros",
  });
});

beforeEach(async () => {
  await limparExecucao(handle);
  equipamento = await criarEquipamento(handle.db, { nome: "dos registros" });
});

afterAll(async () => {
  await limparExecucao(handle);
  await handle.close();
});

async function harnessPorKey(key: "CLAUDE_CODE" | "PI" | "ANTIGRAVITY" | "CODEX") {
  const harness = (await listHarnesses(handle.db, { userId: USER })).find((h) => h.key === key);
  if (harness === undefined) throw new Error(`Harness ${key} não semeado.`);
  return harness;
}

function esperaFalha<V, F>(result: { ok: true; value: V } | { ok: false; failure: F } | null): F {
  if (result === null) throw new Error("não encontrado");
  if (result.ok) throw new Error("esperava recusa, veio sucesso");
  return result.failure;
}

describe("a semente da Fase 8A", () => {
  it("traz os quatro Providers, as cinco Tools de git e o `knowledge` builtIn", async () => {
    const knowledge = await findMcpServerRowByName(handle.db, { userId: USER, name: "knowledge" });
    expect(knowledge?.builtIn).toBe(true);
    expect(knowledge?.readOnly).toBe(true);
    expect(knowledge?.envKeys).toEqual(["DATABASE_URL"]);

    const anthropic = await findProviderForHarness(handle.db, {
      userId: USER,
      harnessKey: "CLAUDE_CODE",
    });
    expect(anthropic?.name).toBe("Anthropic");
    expect(anthropic?.authEnvKeys).toEqual(["ANTHROPIC_API_KEY"]);

    const claude = await harnessPorKey("CLAUDE_CODE");
    expect(claude.capabilities.mcpServers).toBe(true);
    expect(claude.capabilities.forkSession).toBe(true);
    const pi = await harnessPorKey("PI");
    expect(pi.capabilities.mcpServers).toBe(false);
  });

  it("o preflight do Worker mescla a matriz em vez de substituí-la", async () => {
    const claude = await harnessPorKey("CLAUDE_CODE");
    // Um Worker de antes da Fase 8A grava só as onze chaves antigas.
    const onze = { ...claude.capabilities } as Partial<HarnessCapabilities>;
    delete onze.forkSession;
    delete onze.mcpServers;
    onze.resume = false;

    await recordHarnessPreflight(handle.db, {
      userId: USER,
      harnessId: claude.id,
      installedVersion: "2.1.263",
      capabilities: onze as HarnessCapabilities,
    });

    const depois = await findHarnessRow(handle.db, { userId: USER, harnessId: claude.id });
    expect(depois?.capabilities.resume).toBe(false);
    expect(depois?.capabilities.forkSession).toBe(true);
    expect(depois?.capabilities.mcpServers).toBe(true);
    expect(toHarness(depois!).installedVersion).toBe("2.1.263");
    // Um Worker anterior não mede credencial, e não apaga o que ninguém gravou.
    expect(toHarness(depois!)).toMatchObject({
      authStatus: null,
      authCheckedAt: null,
      authReason: null,
    });
  });

  it("o preflight grava a credencial da CLI com instante e motivo (Fase 8B)", async () => {
    const codex = await harnessPorKey("CODEX");
    const medidoEm = new Date("2026-09-09T12:00:00.000Z");

    await recordHarnessPreflight(handle.db, {
      userId: USER,
      harnessId: codex.id,
      installedVersion: "0.147.0",
      auth: {
        status: "NOT_AUTHENTICATED",
        reason: '`codex login status` saiu com código 1: "Not logged in"',
        checkedAt: medidoEm,
      },
    });

    const depois = toHarness(
      (await findHarnessRow(handle.db, { userId: USER, harnessId: codex.id }))!,
    );
    expect(depois.authStatus).toBe("NOT_AUTHENTICATED");
    expect(depois.authCheckedAt).toBe(medidoEm.toISOString());
    expect(depois.authReason).toContain("codex login status");

    // Um boot seguinte sem checagem (`auth` ausente) preserva a medição.
    await recordHarnessPreflight(handle.db, {
      userId: USER,
      harnessId: codex.id,
      installedVersion: "0.148.0",
    });
    const preservado = toHarness(
      (await findHarnessRow(handle.db, { userId: USER, harnessId: codex.id }))!,
    );
    expect(preservado.installedVersion).toBe("0.148.0");
    expect(preservado.authStatus).toBe("NOT_AUTHENTICATED");
    expect(preservado.authCheckedAt).toBe(medidoEm.toISOString());
  });
});

describe("Skill: versões append-only e CAS", () => {
  it("nasce na versão 1, publica a 2 e recusa o CAS perdido", async () => {
    const skill = exigirOk(
      await createSkill(handle.db, {
        userId: USER,
        name: "TypeScript",
        content: "# v1",
        changelog: "primeira",
      }),
      "a criação da Skill",
    );
    expect(skill.latestVersion).toBe(1);
    expect(skill.latest.content).toBe("# v1");

    const v2 = exigirOk(
      await publishSkillVersion(handle.db, {
        userId: USER,
        skillId: skill.id,
        content: "# v2",
        expectedLatestVersion: 1,
      }),
      "a publicação da v2",
    );
    expect(v2.version).toBe(2);

    const perdeu = esperaFalha(
      await publishSkillVersion(handle.db, {
        userId: USER,
        skillId: skill.id,
        content: "# v2 de outra aba",
        expectedLatestVersion: 1,
      }),
    );
    expect(perdeu).toMatchObject({ code: "SKILL_VERSION_CONFLICT", latestVersion: 2 });

    const detalhe = await getSkillDetail(handle.db, { userId: USER, skillId: skill.id });
    expect(detalhe?.latest.content).toBe("# v2");

    const versoes = await listSkillVersions(handle.db, {
      userId: USER,
      skillId: skill.id,
      page: 1,
      pageSize: 10,
    });
    expect(versoes.items.map((v) => v.version)).toEqual([2, 1]);
    // A v1 continua lá, intocada: publicar nunca reescreve.
    expect(versoes.items[1]?.content).toBe("# v1");
  });
});

describe("Loadout por referência", () => {
  it("congela a versão pinada e segue a mais recente na sem pin", async () => {
    const pinada = exigirOk(
      await createSkill(handle.db, { userId: USER, name: "Pinada", content: "p1" }),
      "Skill pinada",
    );
    const solta = exigirOk(
      await createSkill(handle.db, { userId: USER, name: "Solta", content: "s1" }),
      "Skill solta",
    );
    exigirOk(
      await publishSkillVersion(handle.db, { userId: USER, skillId: pinada.id, content: "p2" }),
      "v2 da pinada",
    );

    const loadout = exigirOk(
      await createLoadout(handle.db, {
        userId: USER,
        name: "Com pins",
        agentId: equipamento.agentId,
        harnessId: equipamento.harnessId,
        executionProfileId: equipamento.executionProfileId,
        skillRefs: [{ skillId: pinada.id, pinnedVersion: 1 }, { skillId: solta.id }],
      }),
      "o Loadout com pins",
    );
    expect(loadout.skillRefs).toEqual([
      { skillId: pinada.id, name: "Pinada", pinnedVersion: 1, latestVersion: 2 },
      { skillId: solta.id, name: "Solta", pinnedVersion: null, latestVersion: 1 },
    ]);
    // A forma curta continua respondendo com os nomes, na ordem.
    expect(loadout.skills).toEqual(["Pinada", "Solta"]);

    exigirOk(
      await publishSkillVersion(handle.db, { userId: USER, skillId: solta.id, content: "s2" }),
      "v2 da solta",
    );

    const row = await findLoadoutRow(handle.db, { userId: USER, loadoutId: loadout.id });
    const agent = await findAgentRow(handle.db, { userId: USER, agentId: equipamento.agentId });
    const harness = await findHarnessRow(handle.db, {
      userId: USER,
      harnessId: equipamento.harnessId,
    });
    const snapshot = await buildLoadoutSnapshot(handle.db, {
      loadout: row!,
      agent: agent!,
      harness: harness!,
    });

    expect(snapshot.skillVersions).toEqual([
      { skillId: pinada.id, name: "Pinada", version: 1, pinned: true, content: "p1" },
      { skillId: solta.id, name: "Solta", version: 2, pinned: false, content: "s2" },
    ]);
    expect(snapshot.skills).toEqual(["Pinada", "Solta"]);
  });

  it("recusa um pin para uma versão que a Skill não tem", async () => {
    const skill = exigirOk(
      await createSkill(handle.db, { userId: USER, name: "Curta" }),
      "Skill curta",
    );
    const falha = esperaFalha(
      await createLoadout(handle.db, {
        userId: USER,
        name: "Pin torto",
        agentId: equipamento.agentId,
        harnessId: equipamento.harnessId,
        executionProfileId: equipamento.executionProfileId,
        skillRefs: [{ skillId: skill.id, pinnedVersion: 7 }],
      }),
    );
    expect(falha).toMatchObject({ code: "SKILL_VERSION_NOT_FOUND", version: 7, latestVersion: 1 });
  });

  it("recusa as duas formas na mesma coleção", async () => {
    const falha = esperaFalha(
      await createLoadout(handle.db, {
        userId: USER,
        name: "Misturado",
        agentId: equipamento.agentId,
        harnessId: equipamento.harnessId,
        executionProfileId: equipamento.executionProfileId,
        skillRefs: [],
        skills: ["x"],
      }),
    );
    expect(falha).toMatchObject({ code: "REFERENCE_FORMS_MIXED", collection: "skills" });
  });

  it("a forma curta cria pelo nome o que não existe e reaproveita o que existe", async () => {
    const primeiro = exigirOk(
      await createLoadout(handle.db, {
        userId: USER,
        name: "Curto 1",
        agentId: equipamento.agentId,
        harnessId: equipamento.harnessId,
        executionProfileId: equipamento.executionProfileId,
        skills: ["Nova pelo nome"],
        tools: ["git add", "Ler"],
        mcpServers: [{ name: "docs", transport: "STDIO", target: "node /srv/docs server.js" }],
      }),
      "o primeiro Loadout curto",
    );
    expect(primeiro.skillRefs[0]?.name).toBe("Nova pelo nome");
    // `git add` já era semente; `Ler` nasce agora como COMMAND.
    expect(primeiro.toolRefs.map((t) => t.kind)).toEqual(["COMMAND", "COMMAND"]);
    const docs = await findMcpServerRowByName(handle.db, { userId: USER, name: "docs" });
    expect(docs?.command).toBe("node");
    expect(docs?.args).toEqual(["/srv/docs", "server.js"]);
    expect(primeiro.mcpServers).toEqual([
      { name: "docs", transport: "STDIO", target: "node /srv/docs server.js" },
    ]);

    const segundo = exigirOk(
      await createLoadout(handle.db, {
        userId: USER,
        name: "Curto 2",
        agentId: equipamento.agentId,
        harnessId: equipamento.harnessId,
        executionProfileId: equipamento.executionProfileId,
        skills: ["Nova pelo nome"],
        mcpServers: [{ name: "docs", transport: "STDIO", target: "node /srv/docs server.js" }],
      }),
      "o segundo Loadout curto",
    );
    expect(segundo.skillRefs[0]?.skillId).toBe(primeiro.skillRefs[0]?.skillId);
    expect(segundo.mcpServerRefs[0]?.mcpServerId).toBe(primeiro.mcpServerRefs[0]?.mcpServerId);

    const conflito = esperaFalha(
      await createLoadout(handle.db, {
        userId: USER,
        name: "Curto 3",
        agentId: equipamento.agentId,
        harnessId: equipamento.harnessId,
        executionProfileId: equipamento.executionProfileId,
        mcpServers: [{ name: "docs", transport: "STDIO", target: "node outro.js" }],
      }),
    );
    expect(conflito).toMatchObject({ code: "MCP_SERVER_DEFINITION_MISMATCH", name: "docs" });
  });

  it("guarda uma versão por edição e restaura criando uma versão nova", async () => {
    const skill = exigirOk(
      await createSkill(handle.db, { userId: USER, name: "Histórica", content: "h" }),
      "Skill histórica",
    );
    const loadoutId = equipamento.loadoutId;

    const v2 = exigirOk(
      await updateLoadout(handle.db, {
        userId: USER,
        loadoutId,
        patch: { skillRefs: [{ skillId: skill.id, pinnedVersion: 1 }] },
      }),
      "a edição para v2",
    );
    expect(v2.version).toBe(2);

    // Enviar o mesmo pin de novo não é edição.
    const igual = exigirOk(
      await updateLoadout(handle.db, {
        userId: USER,
        loadoutId,
        patch: { skillRefs: [{ skillId: skill.id, pinnedVersion: 1 }] },
      }),
      "a edição sem mudança",
    );
    expect(igual.version).toBe(2);

    const versoes = await listLoadoutVersions(handle.db, {
      userId: USER,
      loadoutId,
      page: 1,
      pageSize: 10,
    });
    expect(versoes.items.map((v) => v.version)).toEqual([2, 1]);
    expect(versoes.items[0]?.definition.skillRefs).toEqual([
      { skillId: skill.id, pinnedVersion: 1 },
    ]);
    expect(versoes.items[1]?.definition.skillRefs).toEqual([]);

    const restaurado = exigirOk(
      await restoreLoadoutVersion(handle.db, { userId: USER, loadoutId, version: 1 }),
      "o restore da v1",
    );
    expect(restaurado.version).toBe(3);
    expect(restaurado.skillRefs).toEqual([]);

    // A v2 continua registrada: restaurar nunca reescreve.
    const depois = await listLoadoutVersions(handle.db, {
      userId: USER,
      loadoutId,
      page: 1,
      pageSize: 10,
    });
    expect(depois.items.map((v) => v.version)).toEqual([3, 2, 1]);

    // Restaurar o que já está lá não é edição.
    const idem = exigirOk(
      await restoreLoadoutVersion(handle.db, { userId: USER, loadoutId, version: 1 }),
      "o restore idêntico",
    );
    expect(idem.version).toBe(3);

    const inexistente = esperaFalha(
      await restoreLoadoutVersion(handle.db, { userId: USER, loadoutId, version: 9 }),
    );
    expect(inexistente).toMatchObject({ code: "LOADOUT_VERSION_NOT_FOUND", version: 9 });

    // Uma Skill em uso não se apaga.
    exigirOk(
      await updateLoadout(handle.db, {
        userId: USER,
        loadoutId,
        patch: { skillRefs: [{ skillId: skill.id }] },
      }),
      "a volta da Skill",
    );
    const emUso = esperaFalha(await deleteSkill(handle.db, { userId: USER, skillId: skill.id }));
    expect(emUso).toMatchObject({ code: "IN_USE_BY_LOADOUT", loadoutIds: [loadoutId] });
  });
});

describe("servidor MCP builtIn e Tools", () => {
  it("o `knowledge` não se apaga nem se redefine; só a descrição muda", async () => {
    const knowledge = await findMcpServerRowByName(handle.db, { userId: USER, name: "knowledge" });
    const apagar = esperaFalha(
      await deleteMcpServer(handle.db, { userId: USER, mcpServerId: knowledge!.id }),
    );
    expect(apagar.code).toBe("BUILT_IN_PROTECTED");

    const redefinir = esperaFalha(
      await updateMcpServer(handle.db, {
        userId: USER,
        mcpServerId: knowledge!.id,
        patch: { command: "python" },
      }),
    );
    expect(redefinir.code).toBe("BUILT_IN_PROTECTED");

    const descrito = exigirOk(
      await updateMcpServer(handle.db, {
        userId: USER,
        mcpServerId: knowledge!.id,
        patch: { description: "O Grimório." },
      }),
      "a descrição do builtIn",
    );
    expect(descrito.description).toBe("O Grimório.");
    expect(descrito.builtIn).toBe(true);
  });

  it("uma Tool MCP_TOOL exige um servidor, e o servidor com Tool não se apaga", async () => {
    const server = exigirOk(
      await createMcpServer(handle.db, {
        userId: USER,
        name: "figma",
        transport: "HTTP",
        url: "https://mcp.figma.com/sse",
        envKeys: ["FIGMA_TOKEN"],
      }),
      "o servidor figma",
    );
    expect(server.url).toBe("https://mcp.figma.com/sse");
    expect(server.command).toBeNull();

    const semServidor = esperaFalha(
      await createTool(handle.db, {
        userId: USER,
        name: "desenhar",
        kind: "MCP_TOOL",
        mcpServerId: "01996d00-0000-7000-8000-0000000000ff",
        toolName: "draw",
      }),
    );
    expect(semServidor.code).toBe("MCP_SERVER_NOT_FOUND");

    const tool = exigirOk(
      await createTool(handle.db, {
        userId: USER,
        name: "desenhar",
        kind: "MCP_TOOL",
        mcpServerId: server.id,
        toolName: "draw",
      }),
      "a Tool MCP",
    );

    const emUso = esperaFalha(
      await deleteMcpServer(handle.db, { userId: USER, mcpServerId: server.id }),
    );
    expect(emUso).toMatchObject({ code: "IN_USE_BY_TOOL", toolIds: [tool.id] });

    exigirOk(await deleteTool(handle.db, { userId: USER, toolId: tool.id }), "apagar a Tool");
    exigirOk(
      await deleteMcpServer(handle.db, { userId: USER, mcpServerId: server.id }),
      "apagar o servidor",
    );
  });
});

describe("Provider e Model", () => {
  it("o Model aponta para o Provider, e o Provider em uso não se apaga", async () => {
    const provider = exigirOk(
      await createProvider(handle.db, {
        userId: USER,
        name: "Casa",
        kind: "API_KEY",
        authEnvKeys: ["CASA_KEY"],
        harnessKeys: ["PI"],
      }),
      "o Provider",
    );

    const model = exigirOk(
      await createModel(handle.db, {
        userId: USER,
        harnessId: equipamento.harnessId,
        providerId: provider.id,
        key: "casa-1",
        name: "Casa 1",
      }),
      "o Model",
    );
    expect(model.providerId).toBe(provider.id);

    const emUso = esperaFalha(
      await deleteProvider(handle.db, { userId: USER, providerId: provider.id }),
    );
    expect(emUso).toMatchObject({ code: "IN_USE_BY_MODEL", modelIds: [model.id] });

    const inexistente = esperaFalha(
      await createModel(handle.db, {
        userId: USER,
        harnessId: equipamento.harnessId,
        providerId: "01996d00-0000-7000-8000-0000000000ff",
        key: "x",
        name: "X",
      }),
    );
    expect(inexistente.code).toBe("PROVIDER_NOT_FOUND");
  });
});

describe("capability matching em createRun", () => {
  it("recusa com os blockers um Loadout Antigravity em perfil DOCKER", async () => {
    const project = await criarProjectComWorkspace(handle.db, {
      title: "Blockers",
      workspacePath: "C:\\repos\\blockers",
    });
    const task = await criarTask(handle.db, { projectId: project.id, title: "Tenta em Docker" });
    const antigravity = await harnessPorKey("ANTIGRAVITY");
    const docker = (await listExecutionProfiles(handle.db, { userId: USER })).find(
      (perfil) => perfil.mode === "DOCKER" && perfil.enabled,
    );
    if (docker === undefined) throw new Error("Perfil DOCKER não semeado.");

    const loadout = exigirOk(
      await createLoadout(handle.db, {
        userId: USER,
        name: "Antigravity selado",
        agentId: equipamento.agentId,
        harnessId: antigravity.id,
        executionProfileId: docker.id,
      }),
      "o Loadout Antigravity",
    );

    const recusa = esperaFalha(
      await createRun(handle.db, { userId: USER, taskId: task.id, loadoutId: loadout.id }),
    );
    expect(recusa.code).toBe("CAPABILITY_BLOCKED");
    if (recusa.code !== "CAPABILITY_BLOCKED") return;
    expect(recusa.blockers.map((issue) => issue.code)).toEqual(["DOCKER_UNSUPPORTED"]);
  });

  it("devolve os avisos junto do Run quando não há blocker", async () => {
    const project = await criarProjectComWorkspace(handle.db, {
      title: "Avisos",
      workspacePath: "C:\\repos\\avisos",
    });
    const task = await criarTask(handle.db, { projectId: project.id, title: "Parte com aviso" });
    const pi = await harnessPorKey("PI");
    const knowledge = await findMcpServerRowByName(handle.db, { userId: USER, name: "knowledge" });

    const loadout = exigirOk(
      await createLoadout(handle.db, {
        userId: USER,
        name: "Pi com Grimório",
        agentId: equipamento.agentId,
        harnessId: pi.id,
        executionProfileId: equipamento.executionProfileId,
        mcpServerIds: [knowledge!.id],
        toolIds: [],
      }),
      "o Loadout Pi",
    );

    const criado = exigirOk(
      await createRun(handle.db, { userId: USER, taskId: task.id, loadoutId: loadout.id }),
      "o Run com aviso",
    );
    expect(criado.status).toBe("QUEUED");
    expect(criado.warnings.map((issue) => issue.code)).toEqual(["MCP_UNSUPPORTED"]);
    expect(criado.warnings[0]?.causedBy).toEqual(["knowledge"]);
    // O snapshot congelado carrega a definição do servidor, não só a forma curta.
    expect(criado.loadoutSnapshot.mcpServers[0]).toMatchObject({
      name: "knowledge",
      mcpServerId: knowledge!.id,
      builtIn: true,
      envKeys: ["DATABASE_URL"],
    });
    expect(criado.loadoutSnapshot.toolDefinitions).toEqual([]);

    const lido = await getLoadout(handle.db, { userId: USER, loadoutId: loadout.id });
    expect(lido?.mcpServerRefs[0]?.builtIn).toBe(true);
  });
});
