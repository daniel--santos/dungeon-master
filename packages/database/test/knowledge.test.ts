import { loadCatalog, loadTemplates } from "@dungeon-master/achievements";
import type { RunResult } from "@dungeon-master/contracts";
import { distillProject, type DistillSettings } from "@dungeon-master/knowledge";
import { createScriptedKnowledgeRuntime } from "@dungeon-master/knowledge/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { listAchievementViews } from "../src/achievement.js";
import { projectAchievements } from "../src/achievement-projector.js";
import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { listDashboardEventsSince } from "../src/dashboard-event.js";
import {
  countPendingKnowledgeCandidates,
  listDistillationRuns,
  listProjectsWithPendingCandidates,
  reconcileStaleDistillationRuns,
  requestDistillation,
} from "../src/distillation.js";
import {
  approveForgedAchievement,
  discardForgedAchievement,
  listForgedAchievements,
  renameForgedAchievement,
} from "../src/forged-achievement.js";
import { listKnowledgeCandidates } from "../src/knowledge-candidate.js";
import {
  buildFtsQuery,
  createDatabaseKnowledgeStore,
  readNotableFacts,
  recallSimilarKnowledgeItems,
} from "../src/knowledge-distiller.js";
import {
  approveKnowledgeItem,
  getKnowledgeItem,
  getProjectSummary,
  listKnowledgeItems,
  listProjectDecisions,
  rejectKnowledgeItem,
  updateKnowledgeItem,
} from "../src/knowledge-item.js";
import {
  claimNextQueuedRun,
  createRun,
  transitionRun,
  writeRunTerminalStatus,
} from "../src/run.js";
import { findKnowledgeScribeLoadout, seedKnowledgeLoadout } from "../src/seed-knowledge.js";
import { createTask } from "../src/task.js";
import {
  criarEquipamento,
  criarProjectComWorkspace,
  type Equipamento,
  exigirOk,
  limparExecucao,
  USER,
} from "./support.js";

/**
 * O Grimório e o Distiller sobre o banco embutido (planejamento v0.4, Fase 6).
 *
 * Os candidatos nascem do desfecho de Runs de verdade, pela mesma porta que
 * o Worker usa; o lote roda pelo mesmo `distillProject` do Worker, com o
 * store de banco e um modelo roteirizado. O que se prova aqui é o que só o
 * PostgreSQL prova: o advisory lock, a transação que desfaz as decisões, o
 * recall por FTS, o CAS da revisão, a regeneração do resumo corrente e a
 * forjada invisível para o projetor até ser aprovada.
 */

let handle: DatabaseHandle;
let equipamento: Equipamento;
let projectId: string;

const REPO = "C:\\repos\\grimorio";
const SETTINGS: DistillSettings = { humanReview: true, forgeEveryNRuns: 20 };

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 8,
    applicationName: "vitest-grimorio",
  });
});

beforeEach(async () => {
  await limparExecucao(handle);
  await limparConquistas();
  const project = await criarProjectComWorkspace(handle.db, {
    title: "Grimório",
    workspacePath: REPO,
  });
  projectId = project.id;
  equipamento = await criarEquipamento(handle.db, { nome: "do grimório" });
});

afterAll(async () => {
  await limparExecucao(handle);
  await limparConquistas();
  await handle.close();
});

async function limparConquistas(): Promise<void> {
  for (const tabela of [
    "achievement_unlock",
    "achievement_progress",
    "achievement_cursor",
    "hero_stats",
    "achievement_definition",
  ]) {
    await handle.pool.query(`delete from ${tabela} where user_id = $1`, [USER]);
  }
}

/** Uma Expedição inteira: Task, Run em voo, desfecho com o resultado dado. */
async function expedicao(input: {
  title: string;
  result?: RunResult;
  status?: "SUCCEEDED" | "FAILED";
  kind?: "BUG" | "FEATURE";
}): Promise<{ runId: string; taskId: string }> {
  const task = exigirOk(
    await createTask(handle.db, {
      userId: USER,
      projectId,
      title: input.title,
      kind: input.kind ?? "FEATURE",
    }),
    `a criação da Task ${input.title}`,
  );
  const run = exigirOk(
    await createRun(handle.db, { userId: USER, taskId: task.id, loadoutId: equipamento.loadoutId }),
    "a criação do Run",
  );
  await claimNextQueuedRun(handle.db, { userId: USER });
  exigirOk(
    await transitionRun(handle.db, { userId: USER, runId: run.id, to: "RUNNING" }),
    "RUNNING",
  );
  exigirOk(
    await writeRunTerminalStatus(handle.db, {
      userId: USER,
      runId: run.id,
      status: input.status ?? "SUCCEEDED",
      result: input.result ?? { status: "completed", summary: "Pronto." },
      ...(input.status === "FAILED" ? { error: { code: "X", message: "falhou" } } : {}),
    }),
    "o desfecho",
  );
  return { runId: run.id, taskId: task.id };
}

const RESULTADO_COM_APRENDIZADOS: RunResult = {
  status: "completed",
  summary: "Implementei o parser.",
  knowledgeCandidates: [
    {
      title: "Rodar o lint antes de commitar",
      content: "O lint pega o import quebrado antes do CI.",
      kind: "howto",
    },
    {
      title: "Porta do serviço",
      content: "O serviço de pagamentos escuta na porta 8081 em desenvolvimento.",
    },
  ],
  decisions: [
    { summary: "Usar Drizzle no lugar de Prisma", rationale: "As migrações são SQL versionado." },
  ],
};

async function tiposDeEvento(): Promise<string[]> {
  const eventos = await listDashboardEventsSince(handle.db, { userId: USER, afterSequence: 0 });
  return eventos.map((evento) => evento.type);
}

function montarPortas(runtime = createScriptedKnowledgeRuntime()) {
  return {
    store: createDatabaseKnowledgeStore({ db: handle.db, userId: USER }),
    runtime,
  };
}

describe("candidatos no desfecho do Run", () => {
  it("as decisions viram candidatos com kind decision, idempotentes por Run e posição", async () => {
    const { runId, taskId } = await expedicao({
      title: "Parser",
      result: RESULTADO_COM_APRENDIZADOS,
    });

    const candidatos = await listKnowledgeCandidates(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { runId },
    });
    expect(candidatos.total).toBe(3);
    const decisao = candidatos.items.find((c) => c.kind === "decision");
    expect(decisao).toMatchObject({
      taskId,
      title: "Usar Drizzle no lugar de Prisma",
      content: "Usar Drizzle no lugar de Prisma\n\nAs migrações são SQL versionado.",
      status: "PENDING",
      decision: null,
      reason: null,
      knowledgeItemId: null,
      distillationRunId: null,
      processedAt: null,
    });

    expect(await countPendingKnowledgeCandidates(handle.db, { userId: USER, projectId })).toBe(3);
    expect(await listProjectsWithPendingCandidates(handle.db, { userId: USER })).toMatchObject([
      { projectId, pending: 3 },
    ]);
  });
});

describe("o lote do Distiller sobre o banco", () => {
  it("promove, rejeita e mescla com revisão ligada, e o DistillationRun fica registrado", async () => {
    const { runId } = await expedicao({ title: "Parser", result: RESULTADO_COM_APRENDIZADOS });

    const runtime = createScriptedKnowledgeRuntime({
      distill: (request) => {
        expect(request.prompt).toContain("Implementei o parser.");
        return {
          kind: "ok",
          output: {
            decisions: [
              {
                candidate: "C1",
                decision: "PROMOTE",
                type: "PROCEDURE",
                title: "Lint antes do commit",
                content: "Rode pnpm lint antes de commitar: o lint pega o import quebrado.",
                reason: "procedimento útil",
              },
              { candidate: "C2", decision: "REJECT", reason: "detalhe de ambiente local" },
              {
                candidate: "C3",
                decision: "PROMOTE",
                type: "DECISION",
                title: "Drizzle no lugar de Prisma",
                content: "Usar Drizzle: as migrações são SQL versionado.",
                reason: "decisão",
              },
            ],
          },
        };
      },
    });

    const outcome = await distillProject(montarPortas(runtime), {
      projectId,
      trigger: "MANUAL",
      settings: SETTINGS,
      loadoutId: null,
    });
    expect(outcome).toMatchObject({
      kind: "finished",
      status: "SUCCEEDED",
      promoted: 2,
      rejected: 1,
      merged: 0,
    });

    const candidatos = await listKnowledgeCandidates(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { runId },
    });
    expect(candidatos.items.map((c) => c.status).sort()).toEqual([
      "PROMOTED",
      "PROMOTED",
      "REJECTED",
    ]);
    const rejeitado = candidatos.items.find((c) => c.status === "REJECTED");
    expect(rejeitado?.reason).toBe("detalhe de ambiente local [modelo]");
    expect(rejeitado?.processedAt).not.toBeNull();

    const itens = await listKnowledgeItems(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId },
    });
    expect(itens.total).toBe(2);
    expect(itens.items.every((item) => item.status === "PENDING_REVIEW")).toBe(true);
    const decisao = itens.items.find((item) => item.type === "DECISION");
    expect(decisao?.provenance).toMatchObject({
      runId,
      harnessSessionId: "scripted-session",
      usage: { inputTokens: 100 },
      mergedCandidateIds: [],
    });
    expect(decisao?.provenance.candidateId).toBe(
      candidatos.items.find((c) => c.kind === "decision")?.id,
    );

    const lotes = await listDistillationRuns(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId },
    });
    expect(lotes.items[0]).toMatchObject({
      status: "SUCCEEDED",
      trigger: "MANUAL",
      candidateCount: 3,
      promoted: 2,
      rejected: 1,
      harnessSessionId: "scripted-session",
      error: null,
    });
    expect(decisao?.provenance.distillationRunId).toBe(lotes.items[0]?.id);

    const eventos = await tiposDeEvento();
    expect(eventos.filter((t) => t === "knowledge.distilled")).toHaveLength(1);
    // Em revisão, nenhum item ficou ativo: o fato do projetor não saiu.
    expect(eventos.includes("knowledge_item.promoted")).toBe(false);
  });

  it("sem revisão o item nasce ACTIVE e knowledge_item.promoted sai na mesma transação", async () => {
    await expedicao({ title: "Parser", result: RESULTADO_COM_APRENDIZADOS });

    await distillProject(montarPortas(), {
      projectId,
      trigger: "TIMER",
      settings: { ...SETTINGS, humanReview: false },
      loadoutId: null,
    });

    const itens = await listKnowledgeItems(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId, status: "ACTIVE" },
    });
    expect(itens.items.filter((i) => i.type !== "SUMMARY")).toHaveLength(3);
    expect((await tiposDeEvento()).filter((t) => t === "knowledge_item.promoted")).toHaveLength(3);
  });

  it("falha do modelo: candidatos PENDING, nenhum item, lote FAILED com o erro", async () => {
    await expedicao({ title: "Parser", result: RESULTADO_COM_APRENDIZADOS });

    const outcome = await distillProject(
      montarPortas(
        createScriptedKnowledgeRuntime({ distill: { kind: "error", error: "CLI caiu" } }),
      ),
      { projectId, trigger: "IDLE", settings: SETTINGS, loadoutId: null },
    );
    expect(outcome).toMatchObject({
      kind: "finished",
      status: "FAILED",
      error: "modelo (destilação): CLI caiu",
    });

    expect(await countPendingKnowledgeCandidates(handle.db, { userId: USER, projectId })).toBe(3);
    expect(
      (await listKnowledgeItems(handle.db, { userId: USER, page: 1, pageSize: 10 })).total,
    ).toBe(0);
    const lotes = await listDistillationRuns(handle.db, { userId: USER, page: 1, pageSize: 10 });
    expect(lotes.items[0]).toMatchObject({
      status: "FAILED",
      error: "modelo (destilação): CLI caiu",
      candidateCount: 3,
    });
  });

  it("o advisory lock impede dois lotes na mesma Campanha", async () => {
    await expedicao({ title: "Parser", result: RESULTADO_COM_APRENDIZADOS });

    const preso = createScriptedKnowledgeRuntime({ distill: { kind: "hang" } });
    const primeiro = distillProject(montarPortas(preso), {
      projectId,
      trigger: "MANUAL",
      settings: SETTINGS,
      loadoutId: null,
    });
    await preso.hanging;

    const segundo = await distillProject(montarPortas(), {
      projectId,
      trigger: "MANUAL",
      settings: SETTINGS,
      loadoutId: null,
    });
    expect(segundo).toEqual({ kind: "locked" });

    preso.release();
    expect(await primeiro).toMatchObject({ kind: "finished", status: "FAILED" });
    const lotes = await listDistillationRuns(handle.db, { userId: USER, page: 1, pageSize: 10 });
    expect(lotes.total).toBe(1);
  });

  it("um segundo lote com aprendizado repetido termina MERGED, pelo recall FTS", async () => {
    await expedicao({ title: "Primeira", result: RESULTADO_COM_APRENDIZADOS });
    await distillProject(montarPortas(), {
      projectId,
      trigger: "MANUAL",
      settings: { ...SETTINGS, humanReview: false },
      loadoutId: null,
    });

    const { runId } = await expedicao({
      title: "Segunda",
      result: {
        status: "completed",
        knowledgeCandidates: [
          {
            title: "Lint antes",
            content: "Rodar o lint antes de commitar pega o import quebrado.",
            kind: "howto",
          },
        ],
      },
    });

    const runtime = createScriptedKnowledgeRuntime({
      distill: (request) => {
        // O recall achou o item do primeiro lote e o pôs no pool.
        expect(request.prompt).toContain("[K1] (PROCEDURE, ACTIVE) Rodar o lint antes de commitar");
        return {
          kind: "ok",
          output: {
            decisions: [
              { candidate: "C1", decision: "MERGE", mergeInto: "K1", reason: "mesmo procedimento" },
            ],
          },
        };
      },
    });

    const outcome = await distillProject(montarPortas(runtime), {
      projectId,
      trigger: "MANUAL",
      settings: SETTINGS,
      loadoutId: null,
    });
    expect(outcome).toMatchObject({
      kind: "finished",
      status: "SUCCEEDED",
      merged: 1,
      promoted: 0,
    });

    const [candidato] = (
      await listKnowledgeCandidates(handle.db, {
        userId: USER,
        page: 1,
        pageSize: 10,
        filters: { runId },
      })
    ).items;
    expect(candidato).toMatchObject({
      status: "MERGED",
      decision: "MERGE",
      reason: "mesmo procedimento [modelo]",
    });
    const alvo = await getKnowledgeItem(handle.db, {
      userId: USER,
      knowledgeItemId: candidato?.knowledgeItemId ?? "",
    });
    expect(alvo?.provenance.mergedCandidateIds).toEqual([candidato?.id]);
  });

  it("sem candidato PENDING não há lote (idempotente)", async () => {
    expect(
      await distillProject(montarPortas(), {
        projectId,
        trigger: "TIMER",
        settings: SETTINGS,
        loadoutId: null,
      }),
    ).toEqual({ kind: "empty" });
    expect(
      (await listDistillationRuns(handle.db, { userId: USER, page: 1, pageSize: 10 })).total,
    ).toBe(0);
  });
});

describe("recall por FTS", () => {
  it("monta a consulta em OR com as palavras mais longas e acha o item parecido", async () => {
    expect(buildFtsQuery("Rodar o lint antes de commitar!")).toBe(
      "commitar | rodar | antes | lint",
    );
    expect(buildFtsQuery("a b")).toBeNull();

    await expedicao({ title: "Primeira", result: RESULTADO_COM_APRENDIZADOS });
    await distillProject(montarPortas(), {
      projectId,
      trigger: "MANUAL",
      settings: { ...SETTINGS, humanReview: false },
      loadoutId: null,
    });

    const parecidos = await recallSimilarKnowledgeItems(handle.db, {
      userId: USER,
      projectId,
      text: "porta 8081 do serviço de pagamentos",
      limit: 5,
    });
    expect(parecidos.map((item) => item.title)).toEqual(["Porta do serviço"]);
    // O resumo nunca entra no recall.
    expect(parecidos.every((item) => item.type !== "SUMMARY")).toBe(true);
  });
});

describe("revisão humana", () => {
  async function itemEmRevisao(): Promise<string> {
    await expedicao({ title: "Parser", result: RESULTADO_COM_APRENDIZADOS });
    await distillProject(montarPortas(), {
      projectId,
      trigger: "MANUAL",
      settings: SETTINGS,
      loadoutId: null,
    });
    const itens = await listKnowledgeItems(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId, review: "pending" },
    });
    const item = itens.items[0];
    if (item === undefined) throw new Error("sem item em revisão");
    return item.id;
  }

  it("aprovar é CAS: vira ACTIVE, emite os dois eventos, e a segunda decisão perde", async () => {
    const knowledgeItemId = await itemEmRevisao();

    const aprovado = exigirOk(
      await approveKnowledgeItem(handle.db, { userId: USER, knowledgeItemId, note: "Vale." }),
      "a aprovação",
    );
    expect(aprovado).toMatchObject({ status: "ACTIVE", reviewNote: "Vale." });
    expect(aprovado.reviewedAt).not.toBeNull();

    const eventos = await tiposDeEvento();
    expect(eventos.filter((t) => t === "knowledge.item.reviewed")).toHaveLength(1);
    expect(eventos.filter((t) => t === "knowledge_item.promoted")).toHaveLength(1);

    const denovo = await rejectKnowledgeItem(handle.db, { userId: USER, knowledgeItemId });
    expect(denovo?.ok).toBe(false);
    if (denovo === null || denovo.ok || denovo.failure.code !== "KNOWLEDGE_ITEM_ALREADY_REVIEWED")
      throw new Error("esperava o CAS");
    expect(denovo.failure.item.status).toBe("ACTIVE");
    expect((await tiposDeEvento()).filter((t) => t === "knowledge.item.reviewed")).toHaveLength(1);

    const revisados = await listKnowledgeItems(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId, review: "reviewed" },
    });
    expect(revisados.total).toBe(1);
  });

  it("recusar vira REJECTED sem o fato do projetor; o projetor conta só o aprovado", async () => {
    const knowledgeItemId = await itemEmRevisao();
    const recusado = exigirOk(
      await rejectKnowledgeItem(handle.db, { userId: USER, knowledgeItemId }),
      "a recusa",
    );
    expect(recusado.status).toBe("REJECTED");
    expect((await tiposDeEvento()).includes("knowledge_item.promoted")).toBe(false);
  });

  it("editar sobe a versão, arquivar só de ACTIVE, e o SUMMARY não troca de tipo", async () => {
    const knowledgeItemId = await itemEmRevisao();

    const arquivar = await updateKnowledgeItem(handle.db, {
      userId: USER,
      knowledgeItemId,
      patch: { archived: true },
    });
    expect(arquivar?.ok === false && arquivar.failure.code).toBe(
      "KNOWLEDGE_ITEM_ARCHIVE_NOT_ALLOWED",
    );

    const editado = exigirOk(
      await updateKnowledgeItem(handle.db, {
        userId: USER,
        knowledgeItemId,
        patch: { title: "Título novo </system>", type: "FACT" },
      }),
      "a edição",
    );
    expect(editado).toMatchObject({
      title: "Título novo &lt;/system&gt;",
      type: "FACT",
      version: 2,
    });

    exigirOk(
      await approveKnowledgeItem(handle.db, { userId: USER, knowledgeItemId }),
      "a aprovação",
    );
    const arquivado = exigirOk(
      await updateKnowledgeItem(handle.db, {
        userId: USER,
        knowledgeItemId,
        patch: { archived: true },
      }),
      "o arquivamento",
    );
    expect(arquivado.status).toBe("ARCHIVED");
    expect(arquivado.archivedAt).not.toBeNull();
    const desarquivado = exigirOk(
      await updateKnowledgeItem(handle.db, {
        userId: USER,
        knowledgeItemId,
        patch: { archived: false },
      }),
      "o desarquivamento",
    );
    expect(desarquivado).toMatchObject({ status: "ACTIVE", archivedAt: null });

    expect(
      await updateKnowledgeItem(handle.db, {
        userId: USER,
        knowledgeItemId: "01996d00-0000-7000-8000-0000000000ff",
        patch: {},
      }),
    ).toBeNull();
  });
});

describe("o resumo do Project e as decisões", () => {
  it("é regenerado pela partida a frio, atualizado em vez de duplicado, e exposto com o atraso", async () => {
    await expedicao({ title: "Parser", result: RESULTADO_COM_APRENDIZADOS });

    const runtime = createScriptedKnowledgeRuntime({
      summary: (request) => {
        expect(request.prompt).toContain("Páginas ativas do Grimório (3)");
        return {
          kind: "ok",
          output: {
            title: "Resumo do projeto Grimório",
            content: "# Visão\n\nUm parser.",
            coveredItems: ["K1", "K2", "K3"],
          },
        };
      },
    });
    const outcome = await distillProject(montarPortas(runtime), {
      projectId,
      trigger: "MANUAL",
      settings: { ...SETTINGS, humanReview: false },
      loadoutId: null,
    });
    expect(outcome).toMatchObject({
      kind: "finished",
      status: "SUCCEEDED",
      summaryRegenerated: true,
    });

    const resumo = await getProjectSummary(handle.db, { userId: USER, projectId });
    expect(resumo).toMatchObject({ activeItemCount: 3, promotedSinceSummary: 0 });
    expect(resumo?.item).toMatchObject({
      type: "SUMMARY",
      status: "ACTIVE",
      version: 1,
      content: "# Visão\n\nUm parser.",
    });
    expect(resumo?.item?.provenance.coveredItemIds).toHaveLength(3);

    // Um segundo lote com um item novo: o limiar (padrão 5) não dispara, e o
    // atraso fica exposto.
    await expedicao({
      title: "Outra",
      result: {
        status: "completed",
        knowledgeCandidates: [{ title: "Cache", content: "O cache de build fica em .turbo." }],
      },
    });
    await distillProject(montarPortas(), {
      projectId,
      trigger: "MANUAL",
      settings: { ...SETTINGS, humanReview: false },
      loadoutId: null,
    });
    const atrasado = await getProjectSummary(handle.db, { userId: USER, projectId });
    expect(atrasado).toMatchObject({ activeItemCount: 4, promotedSinceSummary: 1 });
    expect(atrasado?.item?.version).toBe(1);

    // Com o limiar em 1, o gatilho dispara e o resumo é regenerado na mesma linha.
    await expedicao({
      title: "Mais uma",
      result: {
        status: "completed",
        knowledgeCandidates: [{ title: "Lockfile", content: "O pnpm-lock.yaml é commitado." }],
      },
    });
    await distillProject(montarPortas(), {
      projectId,
      trigger: "MANUAL",
      settings: { ...SETTINGS, humanReview: false, summaryEveryNItems: 1 },
      loadoutId: null,
    });
    const regenerado = await getProjectSummary(handle.db, { userId: USER, projectId });
    expect(regenerado?.item?.id).toBe(resumo?.item?.id);
    expect(regenerado?.item?.version).toBe(2);
    expect(regenerado?.promotedSinceSummary).toBe(0);

    const decisoes = await listProjectDecisions(handle.db, {
      userId: USER,
      projectId,
      page: 1,
      pageSize: 10,
    });
    expect(decisoes?.items.map((d) => d.title)).toEqual(["Usar Drizzle no lugar de Prisma"]);
    expect(
      await listProjectDecisions(handle.db, {
        userId: USER,
        projectId: "01996d00-0000-7000-8000-0000000000ff",
        page: 1,
        pageSize: 10,
      }),
    ).toBeNull();
    expect(
      await getProjectSummary(handle.db, {
        userId: USER,
        projectId: "01996d00-0000-7000-8000-0000000000ff",
      }),
    ).toBeNull();
  });
});

describe("Conquistas forjadas", () => {
  const catalogo = loadCatalog();
  const templates = loadTemplates();

  /** A forjada que o lote acabou de propor: a primeira vitória da Guilda dispara a forja. */
  async function forjadaDoLote(): Promise<string> {
    const [forjada] = await listForgedAchievements(handle.db, { userId: USER });
    if (forjada === undefined) throw new Error("o lote não forjou nada");
    return forjada.id;
  }

  it("os fatos notáveis saem do banco: primeira vitória da Guilda, sequência e rate limit", async () => {
    const { runId, taskId } = await expedicao({
      title: "Estreia",
      result: RESULTADO_COM_APRENDIZADOS,
    });
    await expedicao({ title: "Derrota", status: "FAILED" });
    const segunda = await expedicao({ title: "Segunda vitória" });

    const facts = await readNotableFacts(handle.db, {
      userId: USER,
      projectId,
      projectTitle: "Grimório",
      batchRunIds: [runId],
      sinceAt: null,
    });
    expect(facts.runs.map((run) => run.status)).toEqual(["SUCCEEDED", "FAILED", "SUCCEEDED"]);
    expect(facts.runs[0]).toMatchObject({
      runId,
      taskId,
      harnessSlug: "claude",
      harnessName: "Claude Code",
      taskKind: "FEATURE",
      reopenings: 0,
    });
    expect(facts.firstVictoryRunIds).toEqual([runId]);
    expect(facts.victoryStreak).toBe(1);
    expect(facts.runsSinceLastForge).toBeNull();

    // O lote forja a primeira vitória da Guilda; a partir dele o rate limit conta.
    const lote = await distillProject(montarPortas(), {
      projectId,
      trigger: "MANUAL",
      settings: SETTINGS,
      loadoutId: null,
    });
    expect(lote).toMatchObject({ kind: "finished", status: "SUCCEEDED" });
    expect(lote.kind === "finished" && lote.forgedAchievementId).not.toBeNull();

    const depois = await readNotableFacts(handle.db, {
      userId: USER,
      projectId,
      projectTitle: "Grimório",
      batchRunIds: [segunda.runId],
      sinceAt: null,
    });
    expect(depois.runsSinceLastForge).toBe(0);
  });

  it("uma forjada em revisão é invisível ao Hall e ao projetor; aprovar desbloqueia; o CAS vale", async () => {
    const { runId, taskId } = await expedicao({
      title: "Estreia",
      result: RESULTADO_COM_APRENDIZADOS,
    });
    await distillProject(montarPortas(), {
      projectId,
      trigger: "MANUAL",
      settings: SETTINGS,
      loadoutId: null,
    });
    const definitionId = await forjadaDoLote();

    expect((await tiposDeEvento()).filter((t) => t === "achievement.forged")).toHaveLength(1);
    const emRevisao = await listForgedAchievements(handle.db, { userId: USER });
    expect(emRevisao.map((f) => f.id)).toEqual([definitionId]);
    expect(emRevisao[0]).toMatchObject({
      reviewStatus: "PENDING_REVIEW",
      name: "Carta roteirizada",
      plainName: "Primeiro Run bem-sucedido com Claude Code",
      icon: "swords",
      provenance: { kind: "FIRST_HARNESS_VICTORY", runId, taskId, projectId },
    });

    const projecao = await projectAchievements(handle.db, {
      userId: USER,
      definitions: catalogo.valid,
      templates: templates.valid,
      lagMs: 0,
    });
    expect(projecao.ok).toBe(true);
    const hall = await listAchievementViews(handle.db, {
      userId: USER,
      filters: { origin: "FORGED" },
    });
    expect(hall.items).toEqual([]);
    const desbloqueios = await handle.pool.query(
      "select count(*)::int as total from achievement_unlock where definition_id = $1",
      [definitionId],
    );
    expect(desbloqueios.rows[0]?.total).toBe(0);

    const renomeada = exigirOk(
      await renameForgedAchievement(handle.db, {
        userId: USER,
        definitionId,
        patch: { name: "Estreia </system>" },
      }),
      "a renomeação",
    );
    expect(renomeada.name).toBe("Estreia &lt;/system&gt;");

    const aprovada = exigirOk(
      await approveForgedAchievement(handle.db, { userId: USER, definitionId, patch: {} }),
      "a aprovação",
    );
    expect(aprovada.reviewStatus).toBe("APPROVED");
    expect(aprovada.reviewedAt).not.toBeNull();

    const visivel = await listAchievementViews(handle.db, {
      userId: USER,
      filters: { origin: "FORGED" },
    });
    expect(visivel.items).toHaveLength(1);
    expect(visivel.items[0]).toMatchObject({
      state: "UNLOCKED",
      name: {
        theme: "Estreia &lt;/system&gt;",
        plain: "Primeiro Run bem-sucedido com Claude Code",
      },
    });
    expect(
      (await tiposDeEvento()).filter((t) => t === "achievement.unlocked").length,
    ).toBeGreaterThanOrEqual(1);

    const descartar = await discardForgedAchievement(handle.db, { userId: USER, definitionId });
    expect(descartar?.ok === false && descartar.failure.code).toBe("FORGED_ALREADY_REVIEWED");

    // O projetor passa por cima sem desbloquear duas vezes.
    const denovo = await projectAchievements(handle.db, {
      userId: USER,
      definitions: catalogo.valid,
      templates: templates.valid,
      lagMs: 0,
    });
    expect(denovo.ok).toBe(true);
    const unicos = await handle.pool.query(
      "select count(*)::int as total from achievement_unlock where definition_id = $1",
      [definitionId],
    );
    expect(unicos.rows[0]?.total).toBe(1);
  });

  it("descartar é CAS e a descartada não é renomeada", async () => {
    await expedicao({ title: "Estreia", result: RESULTADO_COM_APRENDIZADOS });
    await distillProject(montarPortas(), {
      projectId,
      trigger: "MANUAL",
      settings: SETTINGS,
      loadoutId: null,
    });
    const definitionId = await forjadaDoLote();

    const descartada = exigirOk(
      await discardForgedAchievement(handle.db, { userId: USER, definitionId }),
      "o descarte",
    );
    expect(descartada.reviewStatus).toBe("DISCARDED");
    const aprovar = await approveForgedAchievement(handle.db, {
      userId: USER,
      definitionId,
      patch: {},
    });
    expect(aprovar?.ok === false && aprovar.failure.code).toBe("FORGED_ALREADY_REVIEWED");
    const renomear = await renameForgedAchievement(handle.db, {
      userId: USER,
      definitionId,
      patch: { name: "x" },
    });
    expect(renomear?.ok === false && renomear.failure.code).toBe("FORGED_DISCARDED");
    expect(
      await listForgedAchievements(handle.db, { userId: USER, reviewStatus: "DISCARDED" }),
    ).toHaveLength(1);
    expect(await listForgedAchievements(handle.db, { userId: USER })).toEqual([]);
  });
});

describe("infraestrutura do Distiller", () => {
  it("o Loadout do Escriba é semeado uma vez e resolvido pela configuração ou pelo nome", async () => {
    const primeiro = await seedKnowledgeLoadout(handle.db, { userId: USER });
    expect(primeiro.loadoutId).not.toBeNull();
    const segundo = await seedKnowledgeLoadout(handle.db, { userId: USER });
    expect(segundo).toEqual({ loadoutId: primeiro.loadoutId, created: false, reason: null });

    const porNome = await findKnowledgeScribeLoadout(handle.db, { userId: USER, loadoutId: null });
    expect(porNome?.id).toBe(primeiro.loadoutId);
    const escolhido = await findKnowledgeScribeLoadout(handle.db, {
      userId: USER,
      loadoutId: equipamento.loadoutId,
    });
    expect(escolhido?.id).toBe(equipamento.loadoutId);
    const inexistente = await findKnowledgeScribeLoadout(handle.db, {
      userId: USER,
      loadoutId: "01996d00-0000-7000-8000-0000000000ff",
    });
    expect(inexistente?.id).toBe(primeiro.loadoutId);
  });

  it("lotes RUNNING órfãos são fechados na reconciliação; o pedido de lote conta os pendentes", async () => {
    await expedicao({ title: "Parser", result: RESULTADO_COM_APRENDIZADOS });
    await handle.pool.query(
      "insert into distillation_run (id, user_id, project_id, status, trigger, started_at) values ($1, $2, $3, 'RUNNING', 'TIMER', now() - interval '2 hours')",
      ["01996d00-0000-7000-8000-00000000abcd", USER, projectId],
    );
    const { reconciled } = await reconcileStaleDistillationRuns(handle.db, { userId: USER });
    expect(reconciled).toEqual(["01996d00-0000-7000-8000-00000000abcd"]);
    const lotes = await listDistillationRuns(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { status: "FAILED" },
    });
    expect(lotes.items[0]?.error).toContain("Worker reiniciou");

    expect(await requestDistillation(handle.db, { userId: USER, projectId })).toEqual({
      pendingCandidates: 3,
    });
  });
});
