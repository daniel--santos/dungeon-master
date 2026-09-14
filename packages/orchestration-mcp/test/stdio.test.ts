import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  claimNextQueuedRun,
  createAgent,
  createDatabase,
  createLoadout,
  createProject,
  createRun,
  createTask,
  type Database,
  type DatabaseHandle,
  getRun,
  listExecutionProfiles,
  listHarnesses,
  listRuns,
  LOCAL_USER_ID,
  projects,
  requestRunCancellation,
  transitionRun,
  updateProjectAutonomy,
  writeRunTerminalStatus,
} from "@dungeon-master/database";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { bundleOrchestrationMcp } from "../src/bundle.js";
import { ORCHESTRATION_MCP_SERVER_NAME, ORCHESTRATION_TOOL_NAMES } from "../src/tools.js";

/**
 * O servidor de verdade: empacotado pelo esbuild, subido como processo por
 * stdio pelo cliente do SDK, falando com o PostgreSQL embutido.
 *
 * O que se prova: o filho nasce pelo mesmo caminho de `POST /runs`, com
 * `created_by = DELEGATION` e o Run mãe como `parent_run_id`; o escopo — um
 * Run alheio nunca é "filho"; o nível de autonomia relido na transação; a
 * profundidade máxima; e a recusa de subir sem `DATABASE_URL`.
 */

const USER = LOCAL_USER_ID;

let handle: DatabaseHandle;
let db: Database;
let tmp: string;
let bundle: string;
let projectId: string;
let loadoutExecutor: string;
let loadoutRevisor: string;

function exigirOk<V, F>(
  result: { ok: true; value: V } | { ok: false; failure: F } | null,
  what: string,
): V {
  if (result === null) throw new Error(`${what}: não encontrado.`);
  if (!result.ok) throw new Error(`${what}: recusado — ${JSON.stringify(result.failure)}.`);
  return result.value;
}

async function criarLoadout(nome: string): Promise<string> {
  const harness = (await listHarnesses(db, { userId: USER })).find(
    (item) => item.key === "CLAUDE_CODE",
  );
  const perfil = (await listExecutionProfiles(db, { userId: USER })).find((item) => item.enabled);
  if (harness === undefined || perfil === undefined) throw new Error("Semente ausente.");
  const agent = exigirOk(
    await createAgent(db, {
      userId: USER,
      name: `Agente ${nome}`,
      role: nome === "Revisor" ? "REVIEWER" : "ENGINEER",
      instructions: "Faça.",
    }),
    "Agent",
  );
  return exigirOk(
    await createLoadout(db, {
      userId: USER,
      name: nome,
      agentId: agent.id,
      harnessId: harness.id,
      executionProfileId: perfil.id,
    }),
    "Loadout",
  ).id;
}

/** Um Run em `RUNNING`, como o Worker o deixaria com o agente vivo. */
async function runMaeEmExecucao(input: {
  title: string;
  parentRunId?: string;
  taskId?: string;
}): Promise<{ runId: string; taskId: string }> {
  const taskId =
    input.taskId ??
    exigirOk(await createTask(db, { userId: USER, projectId, title: input.title }), "Task").id;
  const run = exigirOk(
    await createRun(db, {
      userId: USER,
      taskId,
      loadoutId: loadoutExecutor,
      ...(input.parentRunId === undefined
        ? {}
        : { parentRunId: input.parentRunId, createdBy: "DELEGATION" as const }),
    }),
    "Run",
  );
  // Reclama exatamente este Run: a fila só tem ele em QUEUED neste instante.
  const claimed = await claimNextQueuedRun(db, { userId: USER });
  if (claimed?.run.id !== run.id) throw new Error(`Reclamou ${claimed?.run.id ?? "nada"}.`);
  exigirOk(await transitionRun(db, { userId: USER, runId: run.id, to: "RUNNING" }), "RUNNING");
  return { runId: run.id, taskId };
}

async function conectar(input: { run: string; project?: string; user?: string }): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      bundle,
      "--run",
      input.run,
      "--project",
      input.project ?? projectId,
      "--user",
      input.user ?? USER,
    ],
    env: { ...getDefaultEnvironment(), DATABASE_URL: inject("databaseUrl") },
    stderr: "pipe",
  });
  const client = new Client({ name: "teste-stdio", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as readonly { type: string; text?: string }[];
  return content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

beforeAll(async () => {
  handle = createDatabase({ url: inject("databaseUrl"), max: 4, applicationName: "vitest-orch" });
  db = handle.db;

  tmp = await mkdtemp(join(tmpdir(), "dm-orchestration-mcp-"));
  bundle = join(tmp, "orchestration-mcp.mjs");
  await bundleOrchestrationMcp({
    entry: fileURLToPath(new URL("../src/bin.ts", import.meta.url)),
    outfile: bundle,
  });

  const project = await createProject(db, { userId: USER, title: "Campanha nível 4" });
  projectId = project.id;
  await db
    .update(projects)
    .set({ workspacePath: "C:\\repos\\campanha" })
    .where(and(eq(projects.id, projectId), eq(projects.userId, USER)));
  await updateProjectAutonomy(db, { userId: USER, projectId, autonomyLevel: 4 });

  loadoutExecutor = await criarLoadout("Executor");
  loadoutRevisor = await criarLoadout("Revisor");
}, 120_000);

afterAll(async () => {
  await handle.close();
  await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
    () => undefined,
  );
});

describe("servidor por stdio com o banco embutido", () => {
  it("sobe pelo protocolo, se apresenta como `orchestration` e lista as três ferramentas", async () => {
    const mae = await runMaeEmExecucao({ title: "Missão do protocolo" });
    const client = await conectar({ run: mae.runId });
    try {
      expect(client.getServerVersion()?.name).toBe(ORCHESTRATION_MCP_SERVER_NAME);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([...ORCHESTRATION_TOOL_NAMES].sort());
      const lista = textOf(await client.callTool({ name: "list_loadouts", arguments: {} }));
      expect(lista).toContain("Executor");
      expect(lista).toContain("Revisor");
    } finally {
      await client.close();
    }
  });

  it("delega pelo nome: o filho nasce DELEGATION, filho do Run mãe, na mesma Task; await_run espera o desfecho", async () => {
    const mae = await runMaeEmExecucao({ title: "Missão delegada" });
    const client = await conectar({ run: mae.runId });
    try {
      const aberto = await client.callTool({
        name: "delegate_task",
        arguments: { loadout: "Revisor", prompt: "Revise o plano da missão." },
      });
      expect(aberto.isError, textOf(aberto)).toBeFalsy();
      const childId = /Run filho aberto: (\S+) /.exec(textOf(aberto))![1]!;

      const filho = await getRun(db, { userId: USER, runId: childId });
      expect(filho).toMatchObject({
        createdBy: "DELEGATION",
        parentRunId: mae.runId,
        parentStepKey: null,
        taskId: mae.taskId,
        status: "QUEUED",
        loadoutId: loadoutRevisor,
        attempt: 2,
      });
      expect(filho?.prompt).toBe("Revise o plano da missão.");

      // Ainda em voo: o tempo de espera acaba e a ferramenta manda chamar de novo.
      const cedo = textOf(
        await client.callTool({
          name: "await_run",
          arguments: { runId: childId, timeoutMs: 1_000 },
        }),
      );
      expect(cedo).toContain("QUEUED");
      expect(cedo).toContain("Chame await_run de novo");

      // O Worker (aqui, o teste) roda o filho até o fim.
      const claimed = await claimNextQueuedRun(db, { userId: USER });
      expect(claimed?.run.id).toBe(childId);
      exigirOk(await transitionRun(db, { userId: USER, runId: childId, to: "RUNNING" }), "RUNNING");
      exigirOk(
        await writeRunTerminalStatus(db, {
          userId: USER,
          runId: childId,
          status: "SUCCEEDED",
          result: {
            status: "completed",
            summary: "Plano aprovado com uma ressalva.",
            usage: { inputTokens: 30, outputTokens: 7 },
          },
        }),
        "desfecho do filho",
      );

      const fim = textOf(
        await client.callTool({
          name: "await_run",
          arguments: { runId: childId, timeoutMs: 5_000 },
        }),
      );
      expect(fim).toContain(`Run filho ${childId}: SUCCEEDED.`);
      expect(fim).toContain("Veredito do agente: completed.");
      expect(fim).toContain("Plano aprovado com uma ressalva.");
      expect(fim).toContain("30 tokens de entrada");

      // A Task da mãe continua RUNNING: o filho na mesma Task não a move.
      const mesmaTask = await listRuns(db, {
        userId: USER,
        page: 1,
        pageSize: 10,
        filters: { taskId: mae.taskId },
      });
      expect(mesmaTask.items.map((run) => run.status).sort()).toEqual(["RUNNING", "SUCCEEDED"]);
    } finally {
      await client.close();
    }
  });

  it("taskStrategy CHILD cria uma Task filha com origem DELEGATION", async () => {
    const mae = await runMaeEmExecucao({ title: "Missão com Task filha" });
    const client = await conectar({ run: mae.runId });
    try {
      const aberto = await client.callTool({
        name: "delegate_task",
        arguments: { loadout: loadoutRevisor, prompt: "Escreva os testes.", taskStrategy: "CHILD" },
      });
      expect(aberto.isError, textOf(aberto)).toBeFalsy();
      const childId = /Run filho aberto: (\S+) /.exec(textOf(aberto))![1]!;
      const filho = await getRun(db, { userId: USER, runId: childId });
      expect(filho?.taskId).not.toBe(mae.taskId);
      const [task] = await handle.pool
        .query<{ created_by: string; parent_task_id: string }>(
          "select created_by, parent_task_id from task where id = $1",
          [filho?.taskId],
        )
        .then((r) => r.rows);
      expect(task).toEqual({ created_by: "DELEGATION", parent_task_id: mae.taskId });
      // O filho fica QUEUED; sai da fila para não ser reclamado por outro teste.
      exigirOk(await requestRunCancellation(db, { userId: USER, runId: childId }), "cancelar");
    } finally {
      await client.close();
    }
  });

  it("um Run que não é filho deste Run mãe é 'não encontrado', e outro Project não delega", async () => {
    const primeira = await runMaeEmExecucao({ title: "Mãe A" });
    const segunda = await runMaeEmExecucao({ title: "Mãe B" });
    const client = await conectar({ run: primeira.runId });
    try {
      const alheio = await client.callTool({
        name: "await_run",
        arguments: { runId: segunda.runId, timeoutMs: 1_000 },
      });
      expect(alheio.isError).toBe(true);
      expect(textOf(alheio)).toContain("não é um filho deste Run");
    } finally {
      await client.close();
    }

    const outro = await createProject(db, { userId: USER, title: "Outra Campanha" });
    const errado = await conectar({ run: primeira.runId, project: outro.id });
    try {
      const recusado = await errado.callTool({
        name: "delegate_task",
        arguments: { loadout: "Revisor", prompt: "x" },
      });
      expect(recusado.isError).toBe(true);
      expect(textOf(recusado)).toContain("PROJECT_MISMATCH");
    } finally {
      await errado.close();
    }
  });

  it("o nível de autonomia é relido na transação: abaixo de 4, recusa", async () => {
    const mae = await runMaeEmExecucao({ title: "Missão rebaixada" });
    await updateProjectAutonomy(db, { userId: USER, projectId, autonomyLevel: 3 });
    const client = await conectar({ run: mae.runId });
    try {
      const recusado = await client.callTool({
        name: "delegate_task",
        arguments: { loadout: "Revisor", prompt: "Revise." },
      });
      expect(recusado.isError).toBe(true);
      expect(textOf(recusado)).toContain("DELEGATION_NOT_ALLOWED");
    } finally {
      await client.close();
      await updateProjectAutonomy(db, { userId: USER, projectId, autonomyLevel: 4 });
    }
  });

  it("um neto (profundidade 2) não delega: DELEGATION_DEPTH_EXCEEDED", async () => {
    const avo = await runMaeEmExecucao({ title: "Avó" });
    const filho = await runMaeEmExecucao({
      title: "Filho",
      parentRunId: avo.runId,
      taskId: avo.taskId,
    });
    const neto = await runMaeEmExecucao({
      title: "Neto",
      parentRunId: filho.runId,
      taskId: avo.taskId,
    });
    const client = await conectar({ run: neto.runId });
    try {
      const recusado = await client.callTool({
        name: "delegate_task",
        arguments: { loadout: "Revisor", prompt: "Delegue mais uma vez." },
      });
      expect(recusado.isError).toBe(true);
      expect(textOf(recusado)).toContain("DELEGATION_DEPTH_EXCEEDED");
    } finally {
      await client.close();
    }
  });

  it("recusa subir sem DATABASE_URL, com código 2", async () => {
    const env = { ...process.env };
    delete env["DATABASE_URL"];
    const saida = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(
        process.execPath,
        [bundle, "--run", projectId, "--project", projectId, "--user", USER],
        { env, stdio: ["pipe", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("exit", (code) => resolve({ code, stderr }));
    });
    expect(saida.code).toBe(2);
    expect(saida.stderr).toContain("DATABASE_URL");
  });
});
