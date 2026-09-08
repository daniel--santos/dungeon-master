import type { RunResult } from "@dungeon-master/contracts";
import {
  claimNextQueuedRun,
  createRun,
  type Database,
  type DatabaseHandle,
  listDistillationRuns,
  listKnowledgeCandidates,
  listKnowledgeItems,
  seedKnowledgeLoadout,
  transitionRun,
  writeRunTerminalStatus,
} from "@dungeon-master/database";
import { createScriptedKnowledgeRuntime } from "@dungeon-master/knowledge/testing";
import {
  createAgentRuntime,
  createHarnessRegistry,
  createWorkspaceManager,
  createWorkspaceResolver,
} from "@dungeon-master/runtime";
import { fakeHarness } from "@dungeon-master/runtime/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import {
  createKnowledgeDistiller,
  createScribeRuntime,
  type KnowledgeDistiller,
} from "../src/distiller.js";
import { abrirBanco, esperar, exigirOk, limpar, montarCenario, USER } from "./support.js";

/**
 * O laço do Distiller dentro do Worker, com banco embutido.
 *
 * O que se prova aqui é a fiação: o `NOTIFY` do trigger de candidato acorda o
 * laço, a ociosidade dispara o lote, o lote passa pelo mesmo `distillProject`
 * e pelo store de banco, e o Escriba de verdade — o `AgentRuntime` com o
 * harness falso, que sobe um processo e fala NDJSON — devolve o JSON pelo
 * bloco `<result>`. O que o Distiller decide já foi provado em
 * `@dungeon-master/knowledge` e em `@dungeon-master/database`.
 */

let handle: DatabaseHandle;
let db: Database;
let distiller: KnowledgeDistiller | undefined;

beforeAll(() => {
  handle = abrirBanco(inject("databaseUrl"));
  db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await limpar(handle);
  // `limpar` leva o Loadout do Escriba junto dos outros; ele volta pela semente.
  const semente = await seedKnowledgeLoadout(db, { userId: USER });
  if (semente.loadoutId === null) throw new Error(semente.reason ?? "sem Loadout do Escriba");
});

afterEach(async () => {
  await distiller?.stop();
  distiller = undefined;
});

/** Uma Expedição inteira sem o laço de Runs: claim, RUNNING e o desfecho com o resultado. */
async function expedicao(input: {
  workspacePath: string;
  result: RunResult;
}): Promise<{ projectId: string; runId: string }> {
  const cenario = await montarCenario(db, {
    nome: `distiller-${String(Date.now())}`,
    workspacePath: input.workspacePath,
  });
  const run = exigirOk(
    await createRun(db, { userId: USER, taskId: cenario.taskId, loadoutId: cenario.loadoutId }),
    "a criação do Run",
  );
  await claimNextQueuedRun(db, { userId: USER });
  exigirOk(await transitionRun(db, { userId: USER, runId: run.id, to: "RUNNING" }), "RUNNING");
  exigirOk(
    await writeRunTerminalStatus(db, {
      userId: USER,
      runId: run.id,
      status: "SUCCEEDED",
      result: input.result,
    }),
    "o desfecho",
  );
  return { projectId: cenario.projectId, runId: run.id };
}

const RESULTADO: RunResult = {
  status: "completed",
  summary: "Pronto.",
  knowledgeCandidates: [
    {
      title: "Rodar o lint antes de commitar",
      content: "O lint pega o import quebrado antes do CI.",
      kind: "howto",
    },
  ],
  decisions: [
    { summary: "Usar Drizzle no lugar de Prisma", rationale: "Migrações em SQL versionado." },
  ],
};

describe("o laço do Distiller", () => {
  it("o NOTIFY do candidato acorda o laço e a ociosidade dispara o lote, sem síncrono ao Run", async () => {
    const runtime = createScriptedKnowledgeRuntime();
    distiller = createKnowledgeDistiller({
      db,
      pool: handle.pool,
      userId: USER,
      runtime,
      config: { idleMs: 150, tickIntervalMs: 50, sweepIntervalMs: 60_000 },
    });
    const partida = await distiller.boot();
    expect(partida).toEqual({ reconciled: [], pendingProjects: 0 });
    distiller.start();

    const { projectId, runId } = await expedicao({
      workspacePath: "C:\\repos\\distiller-a",
      result: RESULTADO,
    });

    // Logo depois do desfecho os candidatos ainda estão PENDING: o lote não é
    // síncrono ao Run.
    const recem = await listKnowledgeCandidates(db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { runId },
    });
    expect(recem.items.every((c) => c.status === "PENDING")).toBe(true);

    const lote = await esperar("o lote do Distiller", async () => {
      const lotes = await listDistillationRuns(db, {
        userId: USER,
        page: 1,
        pageSize: 5,
        filters: { projectId },
      });
      const pronto = lotes.items.find((l) => l.status !== "RUNNING");
      return pronto ?? null;
    });

    expect(lote).toMatchObject({
      status: "SUCCEEDED",
      trigger: "IDLE",
      candidateCount: 2,
      promoted: 2,
    });
    const itens = await listKnowledgeItems(db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId, review: "pending" },
    });
    expect(itens.total).toBe(2);
    // A primeira vitória da Guilda é resultado notável: a forja rodou no mesmo
    // lote e a forjada nasceu em revisão.
    expect(runtime.requests.map((r) => r.purpose)).toEqual(["distill", "forge"]);
    expect(lote.forgedAchievementId).not.toBeNull();
  });

  it("distillOnce roda um lote MANUAL agora; a falha do modelo deixa os candidatos PENDING", async () => {
    distiller = createKnowledgeDistiller({
      db,
      userId: USER,
      runtime: createScriptedKnowledgeRuntime({ distill: { kind: "error", error: "CLI ausente" } }),
      config: { idleMs: 60_000, tickIntervalMs: 60_000 },
    });
    const { projectId } = await expedicao({
      workspacePath: "C:\\repos\\distiller-b",
      result: RESULTADO,
    });

    const outcome = await distiller.distillOnce({ projectId, trigger: "MANUAL" });
    expect(outcome).toMatchObject({
      kind: "finished",
      status: "FAILED",
      error: "modelo (destilação): CLI ausente",
    });

    const candidatos = await listKnowledgeCandidates(db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId },
    });
    expect(candidatos.items.every((c) => c.status === "PENDING")).toBe(true);
    expect(
      await distiller.distillOnce({
        projectId: "01996d00-0000-7000-8000-0000000000ff",
        trigger: "MANUAL",
      }),
    ).toEqual({ kind: "empty" });
  });

  it("o Escriba de verdade: o AgentRuntime com o harness falso devolve o JSON pelo bloco <result>", async () => {
    // O agente falso lê diretivas do prompt; o candidato carrega a resposta
    // que o Escriba vai dar. É o caminho inteiro: Loadout semeado, workspace
    // temporário CURRENT, permissão sem comando, JSON Schema e validação do bloco.
    const bloco = JSON.stringify({
      decisions: [
        {
          candidate: "C1",
          decision: "PROMOTE",
          type: "PROCEDURE",
          title: "Lint antes do commit",
          content: "Rode pnpm lint.",
          reason: "útil",
        },
        { candidate: "C2", decision: "REJECT", reason: "não é decisão" },
      ],
    });
    // Uma vitória anterior noutro Project, para a desta não ser a primeira da
    // Guilda: o agente falso não sabe responder ao prompt da forja.
    await expedicao({
      workspacePath: "C:\\repos\\distiller-c0",
      result: { status: "completed" },
    });
    const { projectId } = await expedicao({
      workspacePath: "C:\\repos\\distiller-c",
      result: {
        status: "completed",
        knowledgeCandidates: [
          {
            title: "Lint",
            content: `O lint pega o import.\n@@fake:session escriba-1\n@@fake:usage 300 40\n@@fake:block ${bloco}`,
          },
          { title: "Outra", content: "Um detalhe qualquer." },
        ],
      },
    });

    const runtime = createAgentRuntime({
      registry: createHarnessRegistry([fakeHarness()]),
      workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
    });
    distiller = createKnowledgeDistiller({
      db,
      userId: USER,
      runtime: createScribeRuntime({
        db,
        userId: USER,
        runtime,
        timeouts: { idleMs: 20_000, completionMs: 60_000 },
      }),
      config: { idleMs: 60_000, tickIntervalMs: 60_000 },
    });

    const outcome = await distiller.distillOnce({ projectId, trigger: "MANUAL" });
    expect(outcome).toMatchObject({
      kind: "finished",
      status: "SUCCEEDED",
      promoted: 1,
      rejected: 1,
    });

    const itens = await listKnowledgeItems(db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId },
    });
    expect(itens.items.map((i) => [i.type, i.title, i.status])).toEqual([
      ["PROCEDURE", "Lint antes do commit", "PENDING_REVIEW"],
    ]);
    expect(itens.items[0]?.provenance).toMatchObject({
      harnessSessionId: "escriba-1",
      usage: { inputTokens: 300, outputTokens: 40 },
    });

    const [lote] = (
      await listDistillationRuns(db, { userId: USER, page: 1, pageSize: 1, filters: { projectId } })
    ).items;
    expect(lote).toMatchObject({ status: "SUCCEEDED", harnessSessionId: "escriba-1" });
    expect(lote?.loadoutId).not.toBeNull();
  });
});
