import { join } from "node:path";

import type { ExecutionEvent, Run } from "@dungeon-master/contracts";
import {
  createTask,
  knowledgeItems,
  loadouts,
  newId,
  type Database,
  type DatabaseHandle,
} from "@dungeon-master/database";
import { createWorkspaceManager, type ExecutionRequest } from "@dungeon-master/runtime";
import { fakeHarness } from "@dungeon-master/runtime/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { newWorkerId } from "../src/config.js";
import {
  buildRunMcpServers,
  knowledgeToolsEnabled,
  splitCommandTarget,
  toContainerDatabaseUrl,
} from "../src/mcp-servers.js";
import { createWorker, type Worker } from "../src/worker.js";
import { createStepAgentRuntime } from "../src/workflow-ports.js";
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
  montarCenario,
  USER,
  type RepositorioTemporario,
} from "./support.js";

/**
 * O Grimório chegando ao agente como ferramenta (Fase 7).
 *
 * A prova de ponta a ponta usa o harness falso, que fala MCP de verdade: o
 * Worker monta a lista, o runtime abre a allow-list e injeta a URL do banco,
 * o adapter passa a configuração no argv, e o agente falso sobe o servidor
 * **real** do Grimório — o arquivo empacotado, contra o PostgreSQL embutido —
 * e chama `search_knowledge`. O que fica no diário é o que a tela vai mostrar.
 */

let handle: DatabaseHandle;
let db: Database;
let repositorio: RepositorioTemporario;
let worker: Worker | undefined;

beforeAll(() => {
  handle = abrirBanco(inject("databaseUrl"));
  db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await limpar(handle);
  repositorio = await criarRepositorio("dm-worker-mcp-");
});

afterEach(async () => {
  await worker?.stop("fim do teste");
  worker = undefined;
  await limpar(handle);
  await repositorio.remover();
});

const LOADOUT = {
  loadoutId: "01996d00-0000-7000-8000-00000000d001",
  name: "Loadout",
  version: 1,
  agent: {
    id: "01996d00-0000-7000-8000-00000000d002",
    name: "Engenheiro",
    role: "ENGINEER" as const,
    instructions: "",
  },
  harness: {
    id: "01996d00-0000-7000-8000-00000000d003",
    key: "CLAUDE_CODE" as const,
    name: "Claude Code",
    capabilities: {
      streaming: true,
      structuredOutput: true,
      resume: true,
      multiTurnProcess: false,
      toolEvents: true,
      tokenUsage: true,
      modelSelection: true,
      agentSelection: false,
      nativePermissions: true,
      hostExecution: true,
      dockerExecution: true,
      forkSession: true,
      mcpServers: true,
    },
  },
  model: null,
  executionProfileId: "01996d00-0000-7000-8000-00000000d004",
  skills: [],
  tools: [],
  mcpServers: [],
  knowledgePolicy: { includeProjectSummary: true, includeDecisions: true, maxItems: 20 },
  contextPolicy: { includeParentContext: true, includeDependencyContext: true, maxTokens: 0 },
  capturedAt: "2026-09-08T00:00:00.000Z",
};

describe("buildRunMcpServers", () => {
  const base = {
    loadout: LOADOUT,
    projectId: "01996d00-0000-7000-8000-00000000aa01",
    userId: USER,
    databaseUrl: "postgresql://dungeon:dungeon@127.0.0.1:5433/dm",
    nodePath: "C:\\node\\node.exe",
    knowledgeEntrypoint: "C:\\dm\\knowledge-mcp.mjs",
  };

  it("oferece o Grimório com ids no argv, URL no ambiente e o comando de container", () => {
    const { servers, notes } = buildRunMcpServers(base);

    expect(notes).toEqual([]);
    expect(servers).toHaveLength(1);
    const [knowledge] = servers;
    expect(knowledge).toMatchObject({
      name: "knowledge",
      transport: "STDIO",
      command: "C:\\node\\node.exe",
      args: ["C:\\dm\\knowledge-mcp.mjs", "--project", base.projectId, "--user", USER],
      envKeys: ["DATABASE_URL"],
      env: { DATABASE_URL: base.databaseUrl },
      tools: [
        "search_knowledge",
        "get_knowledge_item",
        "get_project_summary",
        "list_decisions",
        "get_task_context",
      ],
      container: {
        command: "node",
        env: { DATABASE_URL: "postgresql://dungeon:dungeon@host.docker.internal:5433/dm" },
      },
    });
    if (knowledge?.transport === "STDIO") {
      expect(knowledge.instruction).toContain("Ferramentas do Grimório");
      // O segredo nunca está no argv: nem no do host, nem no do container.
      expect(knowledge.args.join(" ")).not.toContain("dungeon:dungeon");
      expect(knowledge.container?.args.join(" ")).not.toContain("dungeon:dungeon");
      expect(knowledge.container?.mounts?.[0]).toMatchObject({
        hostPath: "C:\\dm\\knowledge-mcp.mjs",
        readOnly: true,
      });
    }
  });

  it("uma política de conhecimento toda desligada não ganha o Grimório", () => {
    const { servers, notes } = buildRunMcpServers({
      ...base,
      loadout: {
        ...LOADOUT,
        knowledgePolicy: { includeProjectSummary: false, includeDecisions: false, maxItems: 0 },
      },
    });
    expect(servers).toEqual([]);
    expect(notes).toEqual([]);
    expect(knowledgeToolsEnabled(LOADOUT.knowledgePolicy)).toBe(true);
  });

  it("sem a URL do banco, avisa e não oferece", () => {
    const { servers, notes } = buildRunMcpServers({ ...base, databaseUrl: undefined });
    expect(servers).toEqual([]);
    expect(notes[0]?.level).toBe("WARN");
    expect(notes[0]?.message).toContain("Grimório");
  });

  it("repassa os servidores do Loadout e recusa nome inválido, repetido ou reservado", () => {
    const { servers, notes } = buildRunMcpServers({
      ...base,
      loadout: {
        ...LOADOUT,
        mcpServers: [
          { name: "filesystem", transport: "STDIO", target: "npx -y servidor-fs /work" },
          { name: "docs", transport: "HTTP", target: "https://mcp.example.com/mcp" },
          { name: "Errado Nome", transport: "STDIO", target: "x" },
          { name: "knowledge", transport: "STDIO", target: "outro" },
          { name: "docs", transport: "HTTP", target: "https://outro.example.com" },
          { name: "semurl", transport: "HTTP", target: "ftp://x" },
          { name: "vazio", transport: "STDIO", target: "   " },
        ],
      },
    });

    expect(servers.map((server) => server.name)).toEqual(["knowledge", "filesystem", "docs"]);
    expect(servers[1]).toEqual({
      name: "filesystem",
      transport: "STDIO",
      command: "npx",
      args: ["-y", "servidor-fs", "/work"],
    });
    expect(servers[2]).toEqual({
      name: "docs",
      transport: "HTTP",
      url: "https://mcp.example.com/mcp",
    });
    expect(notes.map((note) => note.message)).toEqual([
      expect.stringContaining('"Errado Nome"'),
      expect.stringContaining("nome reservado do Grimório"),
      expect.stringContaining('"docs" do Loadout foi ignorado: o nome já está em uso'),
      expect.stringContaining("não é uma URL http(s)"),
      expect.stringContaining("comando está vazio"),
      "Servidores MCP do Loadout oferecidos ao agente: filesystem (STDIO), docs (HTTP).",
    ]);
  });

  it("toContainerDatabaseUrl troca só o loopback pelo host do container", () => {
    expect(toContainerDatabaseUrl("postgresql://u:p@127.0.0.1:5433/dm")).toBe(
      "postgresql://u:p@host.docker.internal:5433/dm",
    );
    expect(toContainerDatabaseUrl("postgresql://u:p@localhost/dm?sslmode=disable")).toBe(
      "postgresql://u:p@host.docker.internal/dm?sslmode=disable",
    );
    expect(toContainerDatabaseUrl("postgresql://u:p@db.example.com:5432/dm")).toBe(
      "postgresql://u:p@db.example.com:5432/dm",
    );
    expect(toContainerDatabaseUrl("não é url")).toBe("não é url");
  });

  it("splitCommandTarget quebra por espaço e recusa vazio", () => {
    expect(splitCommandTarget("  npx  -y  pacote ")).toEqual({
      command: "npx",
      args: ["-y", "pacote"],
    });
    expect(splitCommandTarget("   ")).toBeUndefined();
  });
});

describe("os passos de agente do Ritual recebem a mesma lista", () => {
  it("createStepAgentRuntime põe os servidores no pedido de cada passo", async () => {
    const pedidos: ExecutionRequest[] = [];
    const runtime = {
      async *execute(request: ExecutionRequest): AsyncIterable<ExecutionEvent> {
        pedidos.push(request);
        yield {
          type: "RunCompleted",
          timestamp: new Date().toISOString(),
          harness: "CLAUDE_CODE",
          summary: "ok",
          durationMs: 1,
        };
      },
      cancel: async () => undefined,
    };
    const run = {
      id: newId(),
      taskId: newId(),
      harnessKey: "CLAUDE_CODE",
      loadoutSnapshot: LOADOUT,
      executionProfileSnapshot: {
        executionProfileId: LOADOUT.executionProfileId,
        name: "perfil",
        mode: "HOST",
        workspaceStrategy: "CURRENT",
      },
    } as unknown as Run;
    const servers = buildRunMcpServers({
      loadout: LOADOUT,
      projectId: newId(),
      userId: USER,
      databaseUrl: "postgresql://u:p@127.0.0.1:1/x",
    }).servers;

    const agent = createStepAgentRuntime({
      runtime,
      run,
      repoPath: "D:\\repo",
      checkoutPath: "D:\\repo",
      policies: {
        permission: { mode: "DEFAULT" },
        environment: { allowList: [], inheritEssential: true },
        notes: [],
        bypassWithoutSandbox: false,
      },
      defaultTimeouts: { idleMs: 1_000, completionMs: 2_000 },
      onHarnessVersion: () => undefined,
      knownArtifacts: new Set(),
      mcpServers: servers,
      contextText: "",
    });

    for await (const event of agent.execute({
      executionId: `${run.id}:analyze:1`,
      stepKey: "analyze",
      prompt: "oi",
      signal: new AbortController().signal,
    })) {
      void event;
    }

    expect(pedidos[0]?.mcpServers?.map((server) => server.name)).toEqual(["knowledge"]);
  });
});

describe("o Grimório de verdade, pelo harness falso", () => {
  it("o agente busca no Grimório e a chamada fica no diário com o nome do servidor", async () => {
    const cenario = await montarCenario(db, {
      nome: "mcp-grimorio",
      workspacePath: repositorio.repo,
      workspaceStrategy: "CURRENT",
    });

    // Uma página ativa do Grimório deste Project, e uma de outro, que não
    // pode aparecer nem por acidente.
    await db.insert(knowledgeItems).values({
      id: newId(),
      userId: USER,
      projectId: cenario.projectId,
      type: "FACT",
      status: "ACTIVE",
      title: "O portão do castelo abre com a senha JABUTICABA",
      content: "Descoberto numa Expedição anterior: a senha do portão é JABUTICABA.",
      provenance: {
        candidateId: null,
        runId: null,
        taskId: null,
        distillationRunId: null,
        harnessSessionId: null,
        usage: null,
        mergedCandidateIds: [],
        coveredItemIds: [],
      },
      version: 1,
      reviewedAt: new Date(),
    });

    worker = createWorker({
      db,
      pool: handle.pool,
      userId: USER,
      adapters: [fakeHarness()],
      workspace: createWorkspaceManager({ worktreesRoot: join(repositorio.sandbox, "worktrees") }),
      databaseUrl: inject("databaseUrl"),
      config: { ...CONFIG_PADRAO, workerId: newWorkerId() },
    });
    await worker.boot();
    worker.start();

    const run = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt:
        '@@fake:mcp knowledge search_knowledge {"query":"portão castelo"}\n@@fake:block {"status":"completed","summary":"consultei o Grimório"}',
    });

    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED"], 60_000);
    const eventos = await eventosDoRun(db, run.id);
    expect(terminado.status, diarioDoRun(eventos)).toBe("SUCCEEDED");

    const chamada = eventos.find(
      (evento) =>
        evento.type === "ToolCall" &&
        (evento.payload as { name?: string }).name === "mcp__knowledge__search_knowledge",
    );
    expect(chamada, diarioDoRun(eventos)).toBeDefined();

    const resposta = eventos.find(
      (evento) =>
        evento.type === "ToolResult" &&
        ((evento.payload as { output?: string }).output ?? "").includes("JABUTICABA"),
    );
    expect(resposta, diarioDoRun(eventos)).toBeDefined();
    if (resposta !== undefined) {
      const output = (resposta.payload as { output: string }).output;
      expect(output).toContain("[FACT] O portão do castelo abre com a senha JABUTICABA");
      // A URL do banco atravessou o ambiente e nunca o diário.
      expect(output).not.toContain("postgresql://");
    }

    // Nenhum aviso de MCP: o harness falso sobe servidores.
    expect(
      eventos.some(
        (evento) =>
          evento.type === "Diagnostic" &&
          ((evento.payload as { message?: string }).message ?? "").includes("servidores MCP"),
      ),
      diarioDoRun(eventos),
    ).toBe(false);
  });

  it("um Loadout com o Grimório desligado não oferece o servidor, e o falso não o encontra", async () => {
    const cenario = await montarCenario(db, {
      nome: "mcp-desligado",
      workspacePath: repositorio.repo,
      workspaceStrategy: "CURRENT",
    });
    await db
      .update(loadouts)
      .set({
        knowledgePolicy: { includeProjectSummary: false, includeDecisions: false, maxItems: 0 },
      })
      .where(and(eq(loadouts.id, cenario.loadoutId), eq(loadouts.userId, USER)));

    worker = createWorker({
      db,
      pool: handle.pool,
      userId: USER,
      adapters: [fakeHarness()],
      workspace: createWorkspaceManager({ worktreesRoot: join(repositorio.sandbox, "worktrees") }),
      databaseUrl: inject("databaseUrl"),
      config: { ...CONFIG_PADRAO, workerId: newWorkerId() },
    });
    await worker.boot();
    worker.start();

    const run = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt:
        '@@fake:mcp knowledge search_knowledge {"query":"portão"}\n@@fake:block {"status":"completed","summary":"sem Grimório"}',
    });

    await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED"], 60_000);
    const eventos = await eventosDoRun(db, run.id);

    const resultado = eventos.find(
      (evento) =>
        evento.type === "ToolResult" &&
        (evento.payload as { name?: string }).name === "mcp__knowledge__search_knowledge",
    );
    expect(resultado, diarioDoRun(eventos)).toBeDefined();
    expect((resultado?.payload as { ok?: boolean }).ok).toBe(false);
    expect((resultado?.payload as { output?: string }).output).toContain("sem --mcp-config");
  });
});

// `createTask` e `exigirOk` ficam importados para o cenário de dependências,
// que o teste de stdio do pacote do servidor já cobre com o banco real.
void createTask;
void exigirOk;
