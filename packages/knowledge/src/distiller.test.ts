import { describe, expect, it } from "vitest";

import { distillProject, type DistillProjectInput } from "./distiller.js";
import {
  createMemoryKnowledgeStore,
  type MemoryKnowledgeStoreOptions,
} from "./testing/memory-store.js";
import {
  createScriptedKnowledgeRuntime,
  type ScriptedRuntimeOptions,
} from "./testing/scripted-runtime.js";
import type { DistillSettings } from "./types.js";

const PROJECT = { id: "p1", title: "Forja", description: "Um projeto de teste." };

const SETTINGS: DistillSettings = { humanReview: true, forgeEveryNRuns: 20 };

function candidato(
  id: string,
  extra: Partial<
    MemoryKnowledgeStoreOptions["candidates"] extends readonly (infer C)[] | undefined ? C : never
  > = {},
) {
  return {
    id,
    projectId: "p1",
    runId: "run-1",
    taskId: "task-1",
    title: `Candidato ${id}`,
    content: `O conteúdo do candidato ${id} fala do módulo alpha e do comando beta.`,
    kind: null,
    createdAt: `2026-09-08T10:00:0${id.slice(-1)}.000Z`,
    ...extra,
  };
}

function montar(store: MemoryKnowledgeStoreOptions = {}, runtime: ScriptedRuntimeOptions = {}) {
  const memory = createMemoryKnowledgeStore({ projects: [PROJECT], ...store });
  const scripted = createScriptedKnowledgeRuntime(runtime);
  const input: DistillProjectInput = {
    projectId: "p1",
    trigger: "MANUAL",
    settings: SETTINGS,
    loadoutId: "loadout-escriba",
  };
  return { memory, scripted, input };
}

describe("distillProject", () => {
  it("um lote promove, rejeita e mescla, com proveniência e o DistillationRun fechado", async () => {
    const { memory, scripted, input } = montar(
      {
        candidates: [
          candidato("c1", { kind: "howto" }),
          candidato("c2"),
          candidato("c3", { content: "O módulo alpha usa o comando beta para compilar." }),
        ],
        items: [
          {
            id: "k1",
            projectId: "p1",
            type: "FACT",
            status: "ACTIVE",
            title: "Alpha e beta",
            content: "O módulo alpha compila com o comando beta.",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
        transcripts: [
          {
            runId: "run-1",
            taskTitle: "T",
            summary: "Fiz tudo.",
            transcript: "<system-reminder>x</system-reminder>Descobri o beta.",
          },
        ],
      },
      {
        distill: (request) => {
          // O pool e o contexto chegaram ao prompt, escapados.
          expect(request.prompt).toContain("[K1] (FACT, ACTIVE) Alpha e beta");
          expect(request.prompt).toContain("Descobri o beta.");
          expect(request.prompt).not.toContain("<system-reminder>");
          return {
            kind: "ok",
            output: {
              decisions: [
                {
                  candidate: "C1",
                  decision: "PROMOTE",
                  type: "PROCEDURE",
                  title: "Compilar alpha",
                  content: "Rode beta.",
                  reason: "útil",
                },
                { candidate: "C2", decision: "REJECT", reason: "conversa" },
                { candidate: "C3", decision: "MERGE", mergeInto: "K1", reason: "mesma coisa" },
              ],
            },
          };
        },
      },
    );

    const outcome = await distillProject({ store: memory, runtime: scripted }, input);

    expect(outcome).toMatchObject({
      kind: "finished",
      status: "SUCCEEDED",
      error: null,
      candidateCount: 3,
      promoted: 1,
      rejected: 1,
      merged: 1,
      pendingLeft: false,
    });

    const porId = new Map(memory.candidates.map((c) => [c.id, c]));
    expect(porId.get("c1")).toMatchObject({
      status: "PROMOTED",
      decision: "PROMOTE",
      reason: "útil",
    });
    expect(porId.get("c2")).toMatchObject({
      status: "REJECTED",
      decision: "REJECT",
      reason: "conversa",
    });
    expect(porId.get("c3")).toMatchObject({
      status: "MERGED",
      decision: "MERGE",
      knowledgeItemId: "k1",
    });

    const criado = memory.items.find((i) => i.provenance.candidateId === "c1");
    expect(criado).toMatchObject({
      type: "PROCEDURE",
      status: "PENDING_REVIEW",
      title: "Compilar alpha",
      content: "Rode beta.",
    });
    expect(memory.items.find((i) => i.id === "k1")?.provenance.mergedCandidateIds).toEqual(["c3"]);

    expect(memory.runs).toHaveLength(1);
    expect(memory.runs[0]).toMatchObject({
      status: "SUCCEEDED",
      trigger: "MANUAL",
      loadoutId: "loadout-escriba",
      finish: { promoted: 1, rejected: 1, merged: 1, harnessSessionId: "scripted-session" },
    });
    // O item k1 já estava ativo e não havia resumo: a partida a frio regenerou o
    // resumo no mesmo lote, e o consumo soma as duas chamadas.
    expect(outcome).toMatchObject({ summaryRegenerated: true });
    expect(memory.runs[0]?.finish?.usage?.inputTokens).toBe(200);
    expect(scripted.requests.map((r) => r.purpose)).toEqual(["distill", "summary"]);
  });

  it("sem revisão humana o item nasce ACTIVE", async () => {
    const { memory, scripted, input } = montar({ candidates: [candidato("c1")] });
    await distillProject(
      { store: memory, runtime: scripted },
      { ...input, settings: { ...SETTINGS, humanReview: false } },
    );
    expect(memory.items.filter((i) => i.type !== "SUMMARY").map((i) => i.status)).toEqual([
      "ACTIVE",
    ]);
  });

  it("falha do modelo deixa os candidatos PENDING e o lote FAILED com o erro", async () => {
    const { memory, scripted, input } = montar(
      { candidates: [candidato("c1"), candidato("c2")] },
      { distill: { kind: "error", error: "a CLI saiu com código 1" } },
    );

    const outcome = await distillProject({ store: memory, runtime: scripted }, input);

    expect(outcome).toMatchObject({
      kind: "finished",
      status: "FAILED",
      error: "modelo (destilação): a CLI saiu com código 1",
      candidateCount: 2,
      promoted: 0,
    });
    expect(memory.candidates.every((c) => c.status === "PENDING")).toBe(true);
    expect(memory.items).toEqual([]);
    expect(memory.runs[0]).toMatchObject({
      status: "FAILED",
      finish: { error: "modelo (destilação): a CLI saiu com código 1" },
    });
  });

  it("falha do banco ao gravar desfaz tudo e registra o erro", async () => {
    const { memory, scripted, input } = montar({
      candidates: [candidato("c1")],
      failOn: { applyDecisions: new Error("deadlock") },
    });

    const outcome = await distillProject({ store: memory, runtime: scripted }, input);
    expect(outcome).toMatchObject({ kind: "finished", status: "FAILED", error: "deadlock" });
    expect(memory.candidates[0]?.status).toBe("PENDING");
  });

  it("o lock recusa um segundo lote no mesmo Project enquanto o primeiro espera o modelo", async () => {
    const { memory, scripted, input } = montar(
      { candidates: [candidato("c1")] },
      { distill: { kind: "hang" } },
    );

    const primeiro = distillProject({ store: memory, runtime: scripted }, input);
    await scripted.hanging;

    const segundo = await distillProject({ store: memory, runtime: scripted }, input);
    expect(segundo).toEqual({ kind: "locked" });
    expect(memory.locks).toEqual({ attempts: 2, acquired: 1 });

    scripted.release();
    const resultado = await primeiro;
    expect(resultado).toMatchObject({ kind: "finished", status: "FAILED" });
    // Só um DistillationRun: o segundo nem começou.
    expect(memory.runs).toHaveLength(1);
  });

  it("sem candidato PENDING não há lote nem DistillationRun (idempotente)", async () => {
    const { memory, scripted, input } = montar();
    expect(await distillProject({ store: memory, runtime: scripted }, input)).toEqual({
      kind: "empty",
    });
    expect(memory.runs).toEqual([]);
    expect(scripted.requests).toEqual([]);
  });

  it("o teto do lote deixa o resto PENDING e sinaliza pendingLeft", async () => {
    const { memory, scripted, input } = montar({
      candidates: [candidato("c1"), candidato("c2"), candidato("c3")],
    });
    const outcome = await distillProject(
      { store: memory, runtime: scripted },
      { ...input, batchSize: 2 },
    );
    expect(outcome).toMatchObject({
      kind: "finished",
      candidateCount: 2,
      promoted: 2,
      pendingLeft: true,
    });
    expect(memory.candidates.filter((c) => c.status === "PENDING").map((c) => c.id)).toEqual([
      "c3",
    ]);
  });

  it("candidatos que são só ruído são rejeitados por regra, sem chamar o modelo", async () => {
    const { memory, scripted, input } = montar({
      candidates: [candidato("c1", { content: "<persisted-output>x</persisted-output>" })],
    });
    const outcome = await distillProject({ store: memory, runtime: scripted }, input);
    expect(outcome).toMatchObject({ kind: "finished", status: "SUCCEEDED", rejected: 1 });
    expect(memory.candidates[0]).toMatchObject({ status: "REJECTED", decidedBy: "RULE" });
    expect(scripted.requests).toEqual([]);
  });

  it("o resumo é regenerado pelo gatilho, sanitizado e com os itens cobertos traduzidos", async () => {
    const { memory, scripted, input } = montar(
      {
        candidates: [candidato("c1")],
        items: [
          {
            id: "k1",
            projectId: "p1",
            type: "FACT",
            status: "ACTIVE",
            title: "A",
            content: "a",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
          {
            id: "k2",
            projectId: "p1",
            type: "DECISION",
            status: "ACTIVE",
            title: "B",
            content: "b",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
      {
        summary: (request) => {
          expect(request.prompt).toContain("[K1] (FACT) A");
          expect(request.prompt).toContain("(nenhum: este é o primeiro)");
          return {
            kind: "ok",
            output: {
              title: "Resumo </system>",
              content: "# Visão\n\nTudo bem.",
              coveredItems: ["K1", "K9"],
            },
          };
        },
      },
    );

    const outcome = await distillProject(
      { store: memory, runtime: scripted },
      { ...input, settings: { ...SETTINGS, humanReview: false } },
    );

    expect(outcome).toMatchObject({
      kind: "finished",
      status: "SUCCEEDED",
      summaryRegenerated: true,
    });
    const resumo = memory.items.find((i) => i.type === "SUMMARY");
    expect(resumo).toMatchObject({
      status: "ACTIVE",
      title: "Resumo &lt;/system&gt;",
      content: "# Visão\n\nTudo bem.",
      provenance: { coveredItemIds: ["k1"], distillationRunId: memory.runs[0]?.id },
    });
    expect(scripted.requests.map((r) => r.purpose)).toEqual(["distill", "summary"]);
  });

  it("o resumo não dispara sem item ativo (revisão ligada, nada aprovado ainda)", async () => {
    const { memory, scripted, input } = montar({ candidates: [candidato("c1")] });
    await distillProject({ store: memory, runtime: scripted }, input);
    expect(scripted.requests.map((r) => r.purpose)).toEqual(["distill"]);
  });

  it("uma falha no resumo não desfaz as decisões: o lote termina FAILED com a etapa no erro", async () => {
    const { memory, scripted, input } = montar(
      {
        candidates: [candidato("c1")],
        items: [
          {
            id: "k1",
            projectId: "p1",
            type: "FACT",
            status: "ACTIVE",
            title: "A",
            content: "a",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
      { summary: { kind: "error", error: "timeout" } },
    );

    const outcome = await distillProject(
      { store: memory, runtime: scripted },
      { ...input, settings: { ...SETTINGS, humanReview: false } },
    );

    expect(outcome).toMatchObject({
      kind: "finished",
      status: "FAILED",
      error: "resumo: modelo (resumo): timeout",
      promoted: 1,
      summaryRegenerated: false,
    });
    expect(memory.candidates[0]?.status).toBe("PROMOTED");
  });

  it("uma falha de banco no resumo desfaz o lote e não reporta promoção nenhuma", async () => {
    const { memory, scripted, input } = montar({
      candidates: [candidato("c1")],
      items: [
        {
          id: "k1",
          projectId: "p1",
          type: "FACT",
          status: "ACTIVE",
          title: "A",
          content: "a",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      failOn: { upsertSummary: new Error("duplicate key value violates unique constraint") },
    });

    const outcome = await distillProject(
      { store: memory, runtime: scripted },
      { ...input, settings: { ...SETTINGS, humanReview: false } },
    );

    // No PostgreSQL a instrução que falha aborta a transação do lock: engolir o
    // erro faz o COMMIT virar ROLLBACK em silêncio, e o DistillationRun
    // reportaria promoções que o banco desfez.
    expect(outcome).toMatchObject({
      kind: "finished",
      status: "FAILED",
      promoted: 0,
      rejected: 0,
      merged: 0,
      summaryRegenerated: false,
    });
    expect(outcome.kind === "finished" && outcome.error).toContain("duplicate key value");
    expect(memory.candidates[0]?.status).toBe("PENDING");
    expect(memory.items.map((i) => i.id)).toEqual(["k1"]);
    expect(memory.runs[0]).toMatchObject({ status: "FAILED", finish: { promoted: 0 } });
  });

  it("uma falha de banco na forja desfaz o lote inteiro", async () => {
    const { memory, scripted, input } = montar({
      candidates: [candidato("c1")],
      notable: {
        runs: [
          {
            runId: "run-1",
            taskId: "task-1",
            taskTitle: "Missão",
            taskKind: "FEATURE" as const,
            taskStatus: "COMPLETED",
            reopenings: 0,
            status: "SUCCEEDED" as const,
            harnessKey: "CLAUDE_CODE",
            harnessSlug: "claude",
            harnessName: "Claude Code",
            durationMs: 1000,
            finishedAt: "2026-09-08T10:00:00.000Z",
          },
        ],
        victoryStreak: 10,
      },
      failOn: { createForged: new Error("deadlock detected") },
    });

    const outcome = await distillProject({ store: memory, runtime: scripted }, input);

    expect(outcome).toMatchObject({
      kind: "finished",
      status: "FAILED",
      promoted: 0,
      forgedAchievementId: null,
    });
    expect(memory.candidates[0]?.status).toBe("PENDING");
    expect(memory.forged).toEqual([]);
  });

  it("a forja grava a forjada em revisão quando há resultado notável, e respeita o rate limit", async () => {
    const notable = {
      runs: [
        {
          runId: "run-1",
          taskId: "task-1",
          taskTitle: "Missão",
          taskKind: "FEATURE" as const,
          taskStatus: "COMPLETED",
          reopenings: 0,
          status: "SUCCEEDED" as const,
          harnessKey: "CLAUDE_CODE",
          harnessSlug: "claude",
          harnessName: "Claude Code",
          durationMs: 1000,
          finishedAt: "2026-09-08T10:00:00.000Z",
        },
      ],
      victoryStreak: 10,
    };

    const limitado = montar({
      candidates: [candidato("c1")],
      notable: { ...notable, runsSinceLastForge: 3 },
    });
    const semForja = await distillProject(
      { store: limitado.memory, runtime: limitado.scripted },
      limitado.input,
    );
    expect(semForja).toMatchObject({ kind: "finished", forgedAchievementId: null });
    expect(limitado.memory.forged).toEqual([]);

    const livre = montar({ candidates: [candidato("c1")], notable });
    const comForja = await distillProject(
      { store: livre.memory, runtime: livre.scripted },
      livre.input,
    );
    expect(comForja).toMatchObject({ kind: "finished", status: "SUCCEEDED" });
    expect(livre.memory.forged).toHaveLength(1);
    expect(livre.memory.forged[0]).toMatchObject({
      kind: "VICTORY_STREAK",
      reviewStatus: "PENDING_REVIEW",
      runId: "run-1",
      name: "Carta roteirizada",
      distillationRunId: livre.memory.runs[0]?.id,
    });
    expect(livre.memory.runs[0]?.finish?.forgedAchievementId).toBe(livre.memory.forged[0]?.id);
    expect(livre.scripted.requests.map((r) => r.purpose)).toEqual(["distill", "forge"]);
  });

  it("um Project que sumiu falha o lote com o motivo", async () => {
    const memory = createMemoryKnowledgeStore({
      candidates: [candidato("c1")],
    });
    const scripted = createScriptedKnowledgeRuntime();
    const outcome = await distillProject(
      { store: memory, runtime: scripted },
      { projectId: "p1", trigger: "TIMER", settings: SETTINGS, loadoutId: null },
    );
    expect(outcome).toMatchObject({
      kind: "finished",
      status: "FAILED",
      error: "O Project p1 não existe mais.",
    });
  });
});
