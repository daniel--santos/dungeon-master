import { join } from "node:path";

import { SKILLS_HEADING } from "@dungeon-master/context";
import type { RunEvent, WorkflowDefinition } from "@dungeon-master/contracts";
import { WorkflowDefinitionSchema } from "@dungeon-master/contracts";
import {
  createMcpServer,
  createSkill,
  createTask,
  createTool,
  createWorkflow,
  executionProfiles,
  getRunContext,
  listHarnesses,
  listMcpServers,
  publishSkillVersion,
  updateLoadout,
  type Database,
  type DatabaseHandle,
} from "@dungeon-master/database";
import { createWorkspaceManager, type HarnessExecutionRequest } from "@dungeon-master/runtime";
import { fakeHarness, type FakeHarnessOptions } from "@dungeon-master/runtime/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { newWorkerId } from "../src/config.js";
import { createWorker, type Worker } from "../src/worker.js";
import {
  abrirBanco,
  CONFIG_PADRAO,
  criarRepositorio,
  diarioDoRun,
  enfileirar,
  esperarStatusDeRun,
  eventosDoRun,
  exigirOk,
  limpar,
  linhaDoRun,
  montarCenario,
  USER,
  type Cenario,
  type RepositorioTemporario,
} from "./support.js";

/**
 * A Fase 8B no Worker: o snapshot congelado aplicado ao Run, com o banco
 * embutido e o harness falso.
 *
 * O que se prova aqui é a fiação, não o registro (que é da 8A): a Skill
 * pinada entra no prompt com o conteúdo da versão pinada, e antes do pedido;
 * a Tool `COMMAND` amplia a allow-list que chega ao adapter; o servidor MCP
 * do registro chega ao pedido com comando e argumentos separados e o
 * Grimório não é subido duas vezes; um blocker fecha o Run como `FAILED` sem
 * nenhum agente subir; um aviso vira `Diagnostic` com o código do domínio; a
 * divergência entre o snapshot e o adapter fica no diário; e o boot grava o
 * estado de autenticação da CLI.
 */

let handle: DatabaseHandle;
let db: Database;
let repositorio: RepositorioTemporario;
let worker: Worker | undefined;

/** Os pedidos que chegaram ao adapter falso, já resolvidos pelo runtime. */
let pedidos: HarnessExecutionRequest[] = [];

async function subirWorker(options: FakeHarnessOptions = {}): Promise<Worker> {
  const criado = createWorker({
    db,
    pool: handle.pool,
    userId: USER,
    adapters: [
      fakeHarness({
        ...options,
        onRequest: (request) => {
          pedidos.push(request);
          options.onRequest?.(request);
        },
      }),
    ],
    workspace: createWorkspaceManager({ worktreesRoot: join(repositorio.sandbox, "worktrees") }),
    databaseUrl: inject("databaseUrl"),
    config: { ...CONFIG_PADRAO, workerId: newWorkerId() },
  });
  await criado.boot();
  criado.start();
  worker = criado;
  return criado;
}

function diagnosticos(eventos: readonly RunEvent[]): { code?: string; message: string }[] {
  return eventos
    .filter((evento) => evento.type === "Diagnostic")
    .map((evento) => evento.payload as { code?: string; message: string });
}

async function rodar(cenario: Cenario, prompt: string, esperado: "SUCCEEDED" | "FAILED") {
  const run = await enfileirar(db, {
    taskId: cenario.taskId,
    loadoutId: cenario.loadoutId,
    prompt,
  });
  const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
  const eventos = await eventosDoRun(db, run.id);
  expect(terminado.status, diarioDoRun(eventos)).toBe(esperado);
  return { run: terminado, eventos };
}

const CONCLUIDO = '@@fake:block {"status":"completed","summary":"feito"}';

beforeAll(() => {
  handle = abrirBanco(inject("databaseUrl"));
  db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await limpar(handle);
  pedidos = [];
  repositorio = await criarRepositorio("dm-worker-fase8-");
});

afterEach(async () => {
  await worker?.stop("fim do teste");
  worker = undefined;
  await limpar(handle);
  await repositorio.remover();
});

describe("Skills congeladas no prompt", () => {
  it("a versão pinada entra como # Habilidades entre o contexto e o pedido; sem pin, a mais recente", async () => {
    const cenario = await montarCenario(db, { nome: "skills", workspacePath: repositorio.repo });
    const skill = exigirOk(
      await createSkill(db, {
        userId: USER,
        name: "relatorio",
        content: "Responda sempre com um cabeçalho `## Relatório`.",
      }),
      "a Skill",
    );
    exigirOk(
      await publishSkillVersion(db, {
        userId: USER,
        skillId: skill.id,
        content: "Responda sempre com um cabeçalho `## Boletim`.",
      }),
      "a versão 2",
    );
    exigirOk(
      await updateLoadout(db, {
        userId: USER,
        loadoutId: cenario.loadoutId,
        patch: { skillRefs: [{ skillId: skill.id, pinnedVersion: 1 }] },
      }),
      "o pin",
    );

    await subirWorker();
    const { run, eventos } = await rodar(cenario, CONCLUIDO, "SUCCEEDED");

    // O snapshot congelou a v1, e é ela que chega ao agente.
    expect(run.loadoutSnapshot.skillVersions).toEqual([
      expect.objectContaining({ skillId: skill.id, version: 1, pinned: true }),
    ]);
    const prompt = pedidos[0]?.prompt ?? "";
    expect(prompt, diarioDoRun(eventos)).toContain(`${SKILLS_HEADING}\n\n`);
    expect(prompt).toContain(
      '<skill name="relatorio" version="1" pinned="true">\n' +
        "Responda sempre com um cabeçalho `## Relatório`.\n</skill>",
    );
    expect(prompt).not.toContain("## Boletim");
    // Instruções do Agent → Habilidades → pedido, nesta ordem.
    expect(prompt.indexOf("Implemente o que a Task pede.")).toBeLessThan(
      prompt.indexOf(SKILLS_HEADING),
    );
    expect(prompt.indexOf(SKILLS_HEADING)).toBeLessThan(prompt.indexOf(CONCLUIDO));

    // E fica registrada no `run_context`, contada como as outras seções.
    const contexto = await getRunContext(db, { userId: USER, runId: run.id });
    const habilidades = contexto?.sections.find((section) => section.kind === "SKILLS");
    expect(habilidades?.items).toEqual([
      expect.objectContaining({ id: skill.id, title: "relatorio v1 (pinada)", kind: "SKILL" }),
    ]);
    expect(habilidades?.tokens).toBeGreaterThan(0);

    // Sem pin, o Loadout acompanha a Skill: a v2.
    exigirOk(
      await updateLoadout(db, {
        userId: USER,
        loadoutId: cenario.loadoutId,
        patch: { skillRefs: [{ skillId: skill.id, pinnedVersion: null }] },
      }),
      "tirar o pin",
    );
    const segunda = exigirOk(
      await createTask(db, { userId: USER, projectId: cenario.projectId, title: "Outra" }),
      "a segunda Task",
    );
    await rodar({ ...cenario, taskId: segunda.id }, CONCLUIDO, "SUCCEEDED");
    const segundoPrompt = pedidos[1]?.prompt ?? "";
    expect(segundoPrompt).toContain('<skill name="relatorio" version="2" pinned="false">');
    expect(segundoPrompt).toContain("## Boletim");
    expect(segundoPrompt).not.toContain("## Relatório");
  });

  it("os passos de agente do Ritual recebem as mesmas Habilidades, antes de # Tarefa", async () => {
    const ritual: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Ritual com Habilidades (teste)",
      steps: [
        { type: "agent", key: "um", name: "Um", prompt: `Um.\n${CONCLUIDO}` },
        {
          type: "agent",
          key: "dois",
          name: "Dois",
          dependsOn: ["um"],
          prompt: `Dois.\n${CONCLUIDO}`,
        },
      ],
    });
    const workflowId = exigirOk(
      await createWorkflow(db, { userId: USER, definition: ritual }),
      "o Workflow",
    ).id;
    const cenario = await montarCenario(db, {
      nome: "ritual-skills",
      workspacePath: repositorio.repo,
      workflowId,
    });
    const skill = exigirOk(
      await createSkill(db, { userId: USER, name: "commits", content: "Commits em pt-BR." }),
      "a Skill",
    );
    exigirOk(
      await updateLoadout(db, {
        userId: USER,
        loadoutId: cenario.loadoutId,
        patch: { skillRefs: [{ skillId: skill.id }] },
      }),
      "a Skill no Loadout",
    );

    await subirWorker();
    await rodar(cenario, "Faça.", "SUCCEEDED");

    expect(pedidos).toHaveLength(2);
    for (const pedido of pedidos) {
      expect(pedido.prompt).toContain('<skill name="commits" version="1" pinned="false">');
      expect(pedido.prompt.indexOf(SKILLS_HEADING)).toBeLessThan(pedido.prompt.indexOf("# Tarefa"));
    }
    // O mesmo texto nos dois passos: é o prefixo que o cache de prompt reaproveita.
    const bloco = (prompt: string): string => prompt.slice(0, prompt.indexOf("# Tarefa"));
    expect(bloco(pedidos[1]?.prompt ?? "")).toBe(bloco(pedidos[0]?.prompt ?? ""));
  });
});

describe("Tools do Loadout", () => {
  it("uma Tool COMMAND soma um prefixo à allow-list do perfil, e o diário diz qual", async () => {
    const cenario = await montarCenario(db, {
      nome: "tool-command",
      workspacePath: repositorio.repo,
      commandExecution: "ALLOWLIST",
    });
    // O perfil só libera `git status`; `pnpm --version` vem da Tool.
    const [perfil] = await db
      .select()
      .from(executionProfiles)
      .where(
        and(
          eq(executionProfiles.id, cenario.executionProfileId),
          eq(executionProfiles.userId, USER),
        ),
      );
    await db
      .update(executionProfiles)
      .set({ permissionPolicy: { ...perfil!.permissionPolicy, allowedCommands: ["git status"] } })
      .where(eq(executionProfiles.id, cenario.executionProfileId));

    await subirWorker();

    // Antes: só o que o perfil pede.
    await rodar(cenario, CONCLUIDO, "SUCCEEDED");
    expect(pedidos[0]?.permission.grant?.allowedCommands).toEqual(["git status"]);

    const tool = exigirOk(
      await createTool(db, {
        userId: USER,
        name: "versao-do-pnpm",
        kind: "COMMAND",
        command: "pnpm --version",
      }),
      "a Tool",
    );
    exigirOk(
      await updateLoadout(db, {
        userId: USER,
        loadoutId: cenario.loadoutId,
        patch: { toolIds: [tool.id] },
      }),
      "a Tool no Loadout",
    );
    const segunda = exigirOk(
      await createTask(db, { userId: USER, projectId: cenario.projectId, title: "Com a Tool" }),
      "a segunda Task",
    );
    const { eventos } = await rodar({ ...cenario, taskId: segunda.id }, CONCLUIDO, "SUCCEEDED");

    // Depois: a união, sem repetir, na ordem perfil → Tools.
    expect(pedidos[1]?.permission.grant?.allowedCommands).toEqual(["git status", "pnpm --version"]);
    expect(pedidos[1]?.permission.mode).toBe("CONFIGURED");
    expect(
      diagnosticos(eventos).some((d) =>
        d.message.includes("Tools de comando do Loadout somadas à allow-list: pnpm --version"),
      ),
      diarioDoRun(eventos),
    ).toBe(true);
  });
});

describe("servidores MCP do snapshot", () => {
  it("o servidor do registro chega com comando e argumentos separados, e o Grimório não duplica", async () => {
    const cenario = await montarCenario(db, { nome: "mcp", workspacePath: repositorio.repo });
    const knowledge = (
      await listMcpServers(db, { userId: USER, page: 1, pageSize: 50 })
    ).items.find((server) => server.name === "knowledge");
    expect(knowledge?.builtIn).toBe(true);

    const filesystem = exigirOk(
      await createMcpServer(db, {
        userId: USER,
        name: "filesystem",
        transport: "STDIO",
        // O caminho com espaço, que a forma curta da Fase 7 quebrava.
        command: "C:\\Program Files\\nodejs\\node.exe",
        args: ["servidor-fs.mjs", "--root", "D:\\Meus Projetos"],
        envKeys: ["FS_TOKEN"],
        readOnly: true,
      }),
      "o servidor",
    );
    const fantasma = exigirOk(
      await createMcpServer(db, {
        userId: USER,
        name: "fantasma",
        transport: "HTTP",
        url: "https://mcp.example.com/mcp",
      }),
      "o servidor fora do Loadout",
    );
    const leitura = exigirOk(
      await createTool(db, {
        userId: USER,
        name: "ler-arquivo",
        kind: "MCP_TOOL",
        mcpServerId: filesystem.id,
        toolName: "read_file",
      }),
      "a Tool MCP ligada",
    );
    const busca = exigirOk(
      await createTool(db, {
        userId: USER,
        name: "busca-grimorio",
        kind: "MCP_TOOL",
        mcpServerId: knowledge!.id,
        toolName: "search_knowledge",
      }),
      "a Tool MCP do Grimório",
    );
    const solta = exigirOk(
      await createTool(db, {
        userId: USER,
        name: "tool-solta",
        kind: "MCP_TOOL",
        mcpServerId: fantasma.id,
        toolName: "qualquer",
      }),
      "a Tool MCP sem servidor no Run",
    );
    exigirOk(
      await updateLoadout(db, {
        userId: USER,
        loadoutId: cenario.loadoutId,
        patch: {
          mcpServerIds: [knowledge!.id, filesystem.id],
          toolIds: [leitura.id, busca.id, solta.id],
        },
      }),
      "o Loadout",
    );

    await subirWorker();
    const { run, eventos } = await rodar(cenario, CONCLUIDO, "SUCCEEDED");

    // O snapshot traz a definição, e não só a forma curta.
    expect(run.loadoutSnapshot.mcpServers.map((server) => server.name)).toEqual([
      "knowledge",
      "filesystem",
    ]);
    const servidores = pedidos[0]?.mcpServers ?? [];
    expect(servidores.map((server) => server.name)).toEqual(["knowledge", "filesystem"]);
    expect(servidores[1]).toMatchObject({
      transport: "STDIO",
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["servidor-fs.mjs", "--root", "D:\\Meus Projetos"],
      envKeys: ["FS_TOKEN"],
    });

    const mensagens = diagnosticos(eventos);
    const texto = mensagens.map((d) => `${d.code ?? "-"} ${d.message}`).join("\n");
    expect(texto, diarioDoRun(eventos)).toContain(
      'O servidor embutido "knowledge" do Loadout é o Grimório, que o Worker já oferece',
    );
    expect(texto).toContain(
      "Servidores MCP do Loadout oferecidos ao agente: filesystem (STDIO, somente leitura).",
    );
    expect(texto).toContain(
      "Tools MCP do Loadout ligadas a servidores deste Run: ler-arquivo → filesystem.read_file, " +
        "busca-grimorio → knowledge.search_knowledge.",
    );
    expect(
      mensagens.find((d) => d.code === "MCP_TOOL_SERVER_MISSING")?.message,
      diarioDoRun(eventos),
    ).toContain('A Tool "tool-solta" aponta para a ferramenta qualquer do servidor MCP "fantasma"');
  });
});

describe("capability matching na reclamação", () => {
  it("um blocker medido neste Worker fecha o Run como FAILED sem subir agente, e a divergência fica no diário", async () => {
    const cenario = await montarCenario(db, { nome: "blocker", workspacePath: repositorio.repo });
    // O Run nasce com a matriz do banco (semeada: roda no host). O Worker que
    // o reclama tem um adapter que diz o contrário — é a divergência.
    const run = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: CONCLUIDO,
    });
    expect(run.loadoutSnapshot.harness.capabilities.hostExecution).toBe(true);

    await subirWorker({ capabilities: { hostExecution: false } });

    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const eventos = await eventosDoRun(db, run.id);
    expect(terminado.status, diarioDoRun(eventos)).toBe("FAILED");
    expect(terminado.error).toMatchObject({
      code: "CAPABILITY_BLOCKED",
      retryable: false,
      capabilitiesSource: "ADAPTER",
      blockers: [expect.objectContaining({ code: "HOST_UNSUPPORTED", severity: "BLOCKER" })],
    });
    // Nenhum agente subiu: nem pedido ao adapter, nem RunStarted, nem worktree.
    expect(pedidos).toEqual([]);
    expect(eventos.map((e) => e.type)).not.toContain("RunStarted");
    expect((await linhaDoRun(db, run.id))?.workspacePath).toBeNull();

    const mensagens = diagnosticos(eventos);
    expect(mensagens.find((d) => d.code === "CAPABILITY_DIVERGENCE")?.message).toContain(
      "hostExecution: snapshot true, adapter false",
    );
    expect(mensagens.find((d) => d.code === "HOST_UNSUPPORTED")?.message).toContain(
      "O Harness não roda no host",
    );
  });

  it("um aviso vira Diagnostic WARN com o código do domínio", async () => {
    const cenario = await montarCenario(db, { nome: "warning", workspacePath: repositorio.repo });
    const docs = exigirOk(
      await createMcpServer(db, {
        userId: USER,
        name: "docs",
        transport: "HTTP",
        url: "https://mcp.example.com/mcp",
      }),
      "o servidor",
    );
    exigirOk(
      await updateLoadout(db, {
        userId: USER,
        loadoutId: cenario.loadoutId,
        patch: { mcpServerIds: [docs.id] },
      }),
      "o Loadout",
    );

    // O boot grava a matriz do falso no banco; o Run nasce com ela, e a API
    // aceita com aviso. O Worker recomputa e grava o aviso no diário.
    await subirWorker({ capabilities: { mcpServers: false } });
    const { eventos } = await rodar(cenario, CONCLUIDO, "SUCCEEDED");

    const aviso = eventos.find(
      (e) => e.type === "Diagnostic" && (e.payload as { code?: string }).code === "MCP_UNSUPPORTED",
    );
    expect(aviso, diarioDoRun(eventos)).toBeDefined();
    expect(aviso?.payload).toMatchObject({
      level: "WARN",
      source: "RUNTIME",
      message: expect.stringContaining("docs") as string,
    });
    // O aviso precede qualquer processo.
    expect(eventos.indexOf(aviso!)).toBeLessThan(eventos.findIndex((e) => e.type === "RunStarted"));
  });
});

describe("autenticação no boot", () => {
  it("grava o que a CLI respondeu, com instante e motivo; sem checagem, UNKNOWN", async () => {
    await subirWorker({ authenticated: false });
    const [antes] = (await listHarnesses(db, { userId: USER })).filter(
      (harness) => harness.key === "CLAUDE_CODE",
    );
    expect(antes).toMatchObject({
      authStatus: "NOT_AUTHENTICATED",
      authReason: expect.stringContaining("não autenticado") as string,
    });
    expect(antes?.authCheckedAt).not.toBeNull();
    // Os outros Harnesses, sem adapter neste Worker, ficam como estavam.
    const codex = (await listHarnesses(db, { userId: USER })).find((h) => h.key === "CODEX");
    expect(codex?.authStatus).toBeNull();

    await worker?.stop("troca de adapter");
    worker = undefined;

    await subirWorker();
    const [depois] = (await listHarnesses(db, { userId: USER })).filter(
      (harness) => harness.key === "CLAUDE_CODE",
    );
    expect(depois?.authStatus).toBe("UNKNOWN");
    expect(depois?.authReason).toBeNull();
  });
});
