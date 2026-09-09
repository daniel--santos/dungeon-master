import { buildFtsQuery } from "@dungeon-master/context";
import type { KnowledgeItemType, RunContext, RunResult } from "@dungeon-master/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { createDistillationRun } from "../src/distillation.js";
import { listKnowledgeCandidates } from "../src/knowledge-candidate.js";
import { applyKnowledgeDecisions, upsertProjectSummary } from "../src/knowledge-distiller.js";
import { rejectKnowledgeItem } from "../src/knowledge-item.js";
import {
  claimNextQueuedRun,
  createRun,
  transitionRun,
  writeRunTerminalStatus,
} from "../src/run.js";
import { createDatabaseContextStore, getRunContext, saveRunContext } from "../src/run-context.js";
import { taskDependencies, tasks } from "../src/schema/task.js";
import { addTaskDependency, createTask, getTaskDetail } from "../src/task.js";
import {
  criarEquipamento,
  criarProjectComWorkspace,
  type Equipamento,
  exigirOk,
  limparExecucao,
  USER,
} from "./support.js";

/**
 * O lado do banco do Context Engine (planejamento v0.4, Fase 7): a porta
 * `ContextStore` sobre o PostgreSQL embutido e o registro `run_context`.
 *
 * O que só o PostgreSQL prova: o `ts_rank` sobre o `tsvector` gerado, com o
 * dicionário `simple` e o desempate por data e id; o `UNIQUE (run_id)` com
 * `ON CONFLICT DO NOTHING`, que é a regra "um contexto por Run"; e os dois
 * `CHECK`s da tabela. Os itens do Grimório nascem pelo caminho do Distiller
 * — candidatos gravados no desfecho de Runs de verdade e promovidos pelo
 * mesmo `applyKnowledgeDecisions` do lote —, com a revisão desligada para
 * ficarem `ACTIVE` de saída.
 */

let handle: DatabaseHandle;
let equipamento: Equipamento;
let projectId: string;

const REPO = "C:\\repos\\contexto";

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 8,
    applicationName: "vitest-contexto",
  });
});

beforeEach(async () => {
  await limparExecucao(handle);
  const project = await criarProjectComWorkspace(handle.db, {
    title: "Contexto",
    workspacePath: REPO,
  });
  projectId = project.id;
  equipamento = await criarEquipamento(handle.db, { nome: "contexto" });
});

afterAll(async () => {
  await limparExecucao(handle);
  await handle.close();
});

/** Uma Task e um Run dela levado ao desfecho dado, pelas portas do Worker. */
async function expedicao(input: {
  taskId?: string;
  title?: string;
  parentTaskId?: string;
  status?: "SUCCEEDED" | "FAILED";
  result?: RunResult;
}): Promise<{ runId: string; taskId: string }> {
  const taskId =
    input.taskId ??
    exigirOk(
      await createTask(handle.db, {
        userId: USER,
        projectId,
        title: input.title ?? "Missão",
        ...(input.parentTaskId === undefined ? {} : { parentTaskId: input.parentTaskId }),
      }),
      "a criação da Task",
    ).id;
  const run = exigirOk(
    await createRun(handle.db, { userId: USER, taskId, loadoutId: equipamento.loadoutId }),
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
  return { runId: run.id, taskId };
}

/**
 * Páginas do Grimório pelo caminho do Distiller: candidatos gravados no
 * desfecho de um Run, promovidos com a revisão desligada. Devolve os ids na
 * ordem dos candidatos.
 */
async function promoverPaginas(
  paginas: ReadonlyArray<{
    type: Exclude<KnowledgeItemType, "SUMMARY">;
    title: string;
    content: string;
  }>,
): Promise<string[]> {
  const { runId } = await expedicao({
    title: `Origem ${String(paginas.length)}`,
    result: {
      status: "completed",
      summary: "Aprendi coisas.",
      knowledgeCandidates: paginas.map((pagina) => ({
        title: pagina.title,
        content: pagina.content,
      })),
    },
  });
  const candidatos = await listKnowledgeCandidates(handle.db, {
    userId: USER,
    page: 1,
    pageSize: 50,
    filters: { runId },
  });
  // Os candidatos nascem na mesma transação, na ordem do resultado, e o id é
  // UUIDv7: ordenar por id é ordenar por posição.
  const porPosicao = [...candidatos.items].sort((a, b) => (a.id < b.id ? -1 : 1));
  const lote = await createDistillationRun(handle.db, {
    userId: USER,
    projectId,
    trigger: "MANUAL",
    loadoutId: null,
  });
  const aplicado = await applyKnowledgeDecisions(handle.db, {
    userId: USER,
    projectId,
    distillationRunId: lote.id,
    humanReview: false,
    provenance: { harnessSessionId: null, usage: null },
    decisions: porPosicao.map((candidato, indice) => {
      const pagina = paginas[indice];
      if (pagina === undefined) throw new Error("candidato sem página");
      return {
        candidateId: candidato.id,
        decision: "PROMOTE" as const,
        decidedBy: "RULE" as const,
        reason: "teste",
        item: { type: pagina.type, title: pagina.title, content: pagina.content },
      };
    }),
  });
  return [...aplicado.createdItemIds];
}

describe("a porta ContextStore sobre o PostgreSQL", () => {
  it("busca as páginas por ts_rank, só ACTIVE, sem resumo nem decisão, com desempate por data e id", async () => {
    const [fraca, forte, meia, decisao] = await promoverPaginas([
      {
        type: "FACT",
        title: "Convenção de commits",
        content: "Mensagens no imperativo, em português.",
      },
      {
        type: "FACT",
        title: "Porta do serviço de widgets",
        content: "O serviço de widgets escuta na porta 48213.",
      },
      {
        type: "PROCEDURE",
        title: "Subir o serviço",
        content: "pnpm dev sobe o serviço na porta padrão.",
      },
      {
        type: "DECISION",
        title: "Serviço de widgets em Hono",
        content: "O serviço de widgets usa Hono, e a porta é fixa.",
      },
    ]);
    const [recusada] = await promoverPaginas([
      {
        type: "FACT",
        title: "Porta antiga do serviço de widgets",
        content: "A porta do serviço de widgets era 8080.",
      },
    ]);
    if (recusada === undefined) throw new Error("sem item recusado");
    // Um item `ACTIVE` não passa pela revisão; para tirá-lo do Grimório, o
    // caminho do usuário é arquivar. Aqui basta que ele saia de `ACTIVE`.
    await handle.pool.query(
      "update knowledge_item set status = 'ARCHIVED', archived_at = now() where id = $1",
      [recusada],
    );

    const store = createDatabaseContextStore(handle.db, { userId: USER });
    const query = buildFtsQuery("Registrar a porta do serviço de widgets\n\nEscreva PORT.txt.");
    if (query === null) throw new Error("sem consulta");

    const encontradas = await store.searchKnowledgeItems({ projectId, query, limit: 10 });
    expect(encontradas.map((item) => item.id)).toEqual([forte, meia]);
    expect(encontradas[0]?.score).toBeGreaterThan(encontradas[1]?.score ?? 0);
    expect(encontradas.map((item) => item.id)).not.toContain(fraca);
    expect(encontradas.map((item) => item.id)).not.toContain(decisao);

    // O teto vale.
    expect(await store.searchKnowledgeItems({ projectId, query, limit: 1 })).toHaveLength(1);
    expect(await store.searchKnowledgeItems({ projectId, query, limit: 0 })).toEqual([]);

    // Determinístico: a mesma pergunta, a mesma resposta.
    const denovo = await store.searchKnowledgeItems({ projectId, query, limit: 10 });
    expect(denovo).toEqual(encontradas);
  });

  it("entrega o resumo ACTIVE corrente e as decisões mais recentes, até o teto", async () => {
    const store = createDatabaseContextStore(handle.db, { userId: USER });
    expect(await store.loadProjectSummary({ projectId })).toBeNull();
    expect(await store.listRecentDecisions({ projectId, limit: 5 })).toEqual([]);

    const [d1] = await promoverPaginas([
      { type: "DECISION", title: "Primeira", content: "Decidimos A." },
    ]);
    const [d2] = await promoverPaginas([
      { type: "DECISION", title: "Segunda", content: "Decidimos B." },
    ]);
    const [d3] = await promoverPaginas([
      { type: "DECISION", title: "Terceira", content: "Decidimos C." },
    ]);
    const [pendente] = await promoverPaginas([
      { type: "DECISION", title: "Quarta", content: "Decidimos D." },
    ]);
    if (pendente === undefined) throw new Error("sem item");
    await handle.pool.query(
      "update knowledge_item set status = 'ARCHIVED', archived_at = now() where id = $1",
      [pendente],
    );

    const decisoes = await store.listRecentDecisions({ projectId, limit: 2 });
    expect(decisoes.map((d) => d.id)).toEqual([d3, d2]);
    expect(decisoes[0]).toMatchObject({
      type: "DECISION",
      title: "Terceira",
      content: "Decidimos C.",
    });
    expect((await store.listRecentDecisions({ projectId, limit: 10 })).map((d) => d.id)).toEqual([
      d3,
      d2,
      d1,
    ]);

    const lote = await createDistillationRun(handle.db, {
      userId: USER,
      projectId,
      trigger: "MANUAL",
      loadoutId: null,
    });
    const resumo = await upsertProjectSummary(handle.db, {
      userId: USER,
      projectId,
      distillationRunId: lote.id,
      title: "Resumo do Project",
      content: "Um Project com três decisões.",
      coveredItemIds: [d1, d2, d3].filter((id): id is string => id !== undefined),
      provenance: { harnessSessionId: null, usage: null },
    });
    expect(await store.loadProjectSummary({ projectId })).toEqual({
      id: resumo.id,
      title: "Resumo do Project",
      content: "Um Project com três decisões.",
      version: 1,
    });
  });

  it("carrega a mãe e as dependências com o último resultado, e os artefatos dos Runs anteriores", async () => {
    const mae = exigirOk(
      await createTask(handle.db, {
        userId: USER,
        projectId,
        title: "Épico",
        description: "O épico.",
      }),
      "a mãe",
    );
    const dep = exigirOk(
      await createTask(handle.db, { userId: USER, projectId, title: "Base" }),
      "a dependência",
    );
    const esta = exigirOk(
      await createTask(handle.db, { userId: USER, projectId, title: "Esta", parentTaskId: mae.id }),
      "esta Task",
    );
    exigirOk(
      await addTaskDependency(handle.db, {
        userId: USER,
        taskId: esta.id,
        dependsOnTaskId: dep.id,
      }),
      "a aresta",
    );

    // A ordem respeita a máquina de estados: uma Task só roda de novo depois de
    // um veredito `failed` (o Run é `SUCCEEDED`, a Task volta a `FAILED`), a
    // dependência precisa estar `COMPLETED` antes desta Task rodar, e a mãe só
    // conclui com a filha resolvida.
    await expedicao({ taskId: dep.id, result: { status: "completed", summary: "Base pronta." } });
    // Um Run anterior desta Task (veredito `failed`, para ela poder rodar de
    // novo), e o "corrente", que fica de fora da busca por artefatos.
    const { runId: runAnterior } = await expedicao({
      taskId: esta.id,
      result: {
        status: "failed",
        summary: "Tentativa anterior.",
        // O item torto no meio: ele é pulado, e o de depois mantém a posição
        // do array (2), para o id `<runId>:<posição>` continuar estável.
        artifacts: [
          { path: "src/a.ts" },
          { caminho: "torto" } as never,
          { path: "src/b.ts", summary: "Parte B" },
        ],
      },
    });
    const { runId: runCorrente } = await expedicao({
      taskId: esta.id,
      result: { status: "completed", artifacts: [{ path: "src/corrente.ts" }] },
    });
    // Dois Runs bem-sucedidos da mãe: o mais recente é o "último resultado".
    await expedicao({
      taskId: mae.id,
      result: {
        status: "failed",
        summary: "Primeira tentativa.",
        artifacts: [{ path: "docs/velho.md" }],
      },
    });
    // Um Run falho da mãe não conta: nem resultado, nem artefato.
    await expedicao({
      taskId: mae.id,
      status: "FAILED",
      result: { status: "failed", summary: "Não deu.", artifacts: [{ path: "nao.md" }] },
    });
    const { runId: runMae } = await expedicao({
      taskId: mae.id,
      result: {
        status: "completed",
        summary: "Segunda tentativa.",
        artifacts: [{ path: "docs/novo.md", kind: "report", summary: "Desenho" }],
      },
    });

    const store = createDatabaseContextStore(handle.db, { userId: USER });

    const lineage = await store.loadTaskLineage({ taskId: esta.id });
    expect(lineage.parent).toEqual({
      id: mae.id,
      title: "Épico",
      description: "O épico.",
      status: "COMPLETED",
      kind: "FEATURE",
      latestResultSummary: "Segunda tentativa.",
    });
    expect(lineage.dependencies).toEqual([
      {
        id: dep.id,
        title: "Base",
        description: null,
        status: "COMPLETED",
        kind: "FEATURE",
        latestResultSummary: "Base pronta.",
      },
    ]);
    expect(await store.loadTaskLineage({ taskId: mae.id })).toEqual({
      parent: null,
      dependencies: [],
    });

    const artifacts = await store.listPriorArtifacts({
      taskIds: [esta.id, mae.id],
      excludeRunId: runCorrente,
      limit: 10,
    });
    expect(artifacts).toEqual([
      {
        runId: runMae,
        taskId: mae.id,
        position: 0,
        path: "docs/novo.md",
        kind: "report",
        summary: "Desenho",
      },
      {
        runId: expect.any(String) as string,
        taskId: mae.id,
        position: 0,
        path: "docs/velho.md",
        kind: null,
        summary: null,
      },
      {
        runId: runAnterior,
        taskId: esta.id,
        position: 0,
        path: "src/a.ts",
        kind: null,
        summary: null,
      },
      {
        runId: runAnterior,
        taskId: esta.id,
        position: 2,
        path: "src/b.ts",
        kind: null,
        summary: "Parte B",
      },
    ]);
    expect(
      await store.listPriorArtifacts({
        taskIds: [esta.id, mae.id],
        excludeRunId: runCorrente,
        limit: 2,
      }),
    ).toHaveLength(2);
    expect(
      await store.listPriorArtifacts({ taskIds: [], excludeRunId: runCorrente, limit: 2 }),
    ).toEqual([]);
  });

  it("a linhagem para na fronteira do Project, mesmo com a aresta já no banco", async () => {
    const outro = await criarProjectComWorkspace(handle.db, {
      title: "Outra Campanha",
      workspacePath: "C:\\repos\\outro",
    });

    const daqui = exigirOk(
      await createTask(handle.db, { userId: USER, projectId, title: "Desta Campanha" }),
      "a Task daqui",
    );
    const dela = exigirOk(
      await createTask(handle.db, {
        userId: USER,
        projectId: outro.id,
        title: "Segredo da outra Campanha",
        description: "O texto que não pode atravessar.",
      }),
      "a Task de lá",
    );

    // A porta recusa a aresta entre Projects diferentes...
    const recusa = await addTaskDependency(handle.db, {
      userId: USER,
      taskId: daqui.id,
      dependsOnTaskId: dela.id,
    });
    expect(recusa).toMatchObject({ ok: false, failure: { code: "DEPENDENCY_IN_OTHER_PROJECT" } });

    // ...e a leitura também, porque uma versão anterior deixou a aresta gravada.
    await handle.db
      .insert(taskDependencies)
      .values({ userId: USER, taskId: daqui.id, dependsOnTaskId: dela.id });
    await handle.db
      .update(tasks)
      .set({ parentTaskId: dela.id })
      .where(and(eq(tasks.id, daqui.id), eq(tasks.userId, USER)));

    const store = createDatabaseContextStore(handle.db, { userId: USER });
    expect(await store.loadTaskLineage({ taskId: daqui.id })).toEqual({
      parent: null,
      dependencies: [],
    });

    const detalhe = await getTaskDetail(handle.db, { userId: USER, taskId: daqui.id });
    expect(detalhe?.dependencies).toEqual([]);
    const deLa = await getTaskDetail(handle.db, { userId: USER, taskId: dela.id });
    expect(deLa?.dependents).toEqual([]);
  });
});

/** O nome da constraint que o PostgreSQL recusou, por baixo do erro do Drizzle. */
async function constraintRecusada(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const causa = (error as { cause?: { constraint?: string } }).cause ?? error;
    return (causa as { constraint?: string }).constraint ?? null;
  }
}

describe("o registro run_context", () => {
  function contexto(
    runId: string,
    taskId: string,
    overrides: Partial<RunContext> = {},
  ): RunContext {
    return {
      runId,
      taskId,
      projectId,
      status: "ASSEMBLED",
      text: "## Contexto do projeto (recuperado automaticamente)\n<context>\n</context>",
      query: "porta | widgets",
      sections: [
        {
          kind: "KNOWLEDGE",
          title: "Páginas relevantes",
          items: [
            {
              id: "k1",
              kind: "KNOWLEDGE_ITEM",
              title: "Porta",
              reason: "FTS_MATCH",
              score: 0.3,
              tokens: 12,
              truncated: false,
            },
          ],
          tokens: 20,
          budgetTokens: 1700,
          truncated: false,
        },
      ],
      excluded: [],
      budget: {
        totalTokens: 6000,
        frameTokens: 150,
        summaryMinTokens: 300,
        sections: {
          SUMMARY: 2047,
          DECISIONS: 877,
          KNOWLEDGE: 1755,
          LINEAGE: 702,
          ARTIFACTS: 292,
          SKILLS: 175,
        },
      },
      usage: { estimatedTokens: 170, itemCount: 1, excludedCount: 0 },
      policy: {
        enabled: true,
        budgetTokens: 6000,
        maxKnowledgeItems: 8,
        maxDecisions: 5,
        maxArtifacts: 10,
        includeProjectSummary: true,
        includeDecisions: true,
        includeParentContext: true,
        includeDependencyContext: true,
        source: {
          loadout: {
            id: equipamento.loadoutId,
            version: 1,
            knowledgePolicy: { includeProjectSummary: true, includeDecisions: true, maxItems: 20 },
            contextPolicy: {
              includeParentContext: true,
              includeDependencyContext: true,
              maxTokens: 0,
            },
          },
          settings: {
            enabled: true,
            budgetTokens: 6000,
            maxKnowledgeItems: 8,
            maxDecisions: 5,
            maxArtifacts: 10,
          },
        },
      },
      inheritedFromRunId: null,
      error: null,
      assembledAt: "2026-09-08T12:00:00.000Z",
      createdAt: "2026-09-08T12:00:00.000Z",
      ...overrides,
    };
  }

  it("grava uma vez por Run: a segunda escrita devolve a primeira", async () => {
    const { runId, taskId } = await expedicao({ title: "Registro" });
    expect(await getRunContext(handle.db, { userId: USER, runId })).toBeNull();

    const primeiro = await saveRunContext(handle.db, {
      userId: USER,
      context: contexto(runId, taskId),
    });
    expect(primeiro.created).toBe(true);
    expect(primeiro.context).toMatchObject({
      runId,
      taskId,
      projectId,
      status: "ASSEMBLED",
      query: "porta | widgets",
    });
    expect(primeiro.context.sections[0]?.items[0]?.score).toBe(0.3);

    const segundo = await saveRunContext(handle.db, {
      userId: USER,
      context: contexto(runId, taskId, { text: "outro texto", query: "outra" }),
    });
    expect(segundo.created).toBe(false);
    expect(segundo.context.text).toBe(primeiro.context.text);
    expect(segundo.context.query).toBe("porta | widgets");

    const lido = await getRunContext(handle.db, { userId: USER, runId });
    expect(lido).toEqual(primeiro.context);
    expect(lido?.assembledAt).toBe("2026-09-08T12:00:00.000Z");
  });

  it("aceita o contexto herdado e o FAILED com erro; recusa ASSEMBLED sem texto", async () => {
    // O veredito `failed` deixa a Task rodar de novo: a retomada é outro Run dela.
    const origem = await expedicao({ title: "Origem", result: { status: "failed" } });
    const retomada = await expedicao({ taskId: origem.taskId });
    const herdado = await saveRunContext(handle.db, {
      userId: USER,
      context: contexto(retomada.runId, retomada.taskId, { inheritedFromRunId: origem.runId }),
    });
    expect(herdado.context.inheritedFromRunId).toBe(origem.runId);

    const falho = await expedicao({ title: "Falho" });
    const gravado = await saveRunContext(handle.db, {
      userId: USER,
      context: contexto(falho.runId, falho.taskId, {
        status: "FAILED",
        text: "",
        sections: [],
        error: "banco caiu",
      }),
    });
    expect(gravado.context).toMatchObject({ status: "FAILED", text: "", error: "banco caiu" });

    const torto = await expedicao({ title: "Torto" });
    expect(
      await constraintRecusada(
        saveRunContext(handle.db, {
          userId: USER,
          context: contexto(torto.runId, torto.taskId, { text: "" }),
        }),
      ),
    ).toBe("run_context_text_ck");
    expect(
      await constraintRecusada(
        saveRunContext(handle.db, {
          userId: USER,
          context: contexto(torto.runId, torto.taskId, { error: "x" }),
        }),
      ),
    ).toBe("run_context_error_ck");
  });

  it("some junto com o Run", async () => {
    const { runId, taskId } = await expedicao({ title: "Cascata" });
    await saveRunContext(handle.db, { userId: USER, context: contexto(runId, taskId) });
    await handle.pool.query("delete from run where id = $1", [runId]);
    expect(await getRunContext(handle.db, { userId: USER, runId })).toBeNull();
  });

  it("rejectKnowledgeItem continua fora do alcance da busca", async () => {
    // Guarda de regressão do filtro por status: um item que saiu de ACTIVE por
    // qualquer caminho não volta ao contexto.
    const [id] = await promoverPaginas([
      { type: "FACT", title: "Porta do serviço", content: "porta 1" },
    ]);
    if (id === undefined) throw new Error("sem item");
    await handle.pool.query("update knowledge_item set status = 'PENDING_REVIEW' where id = $1", [
      id,
    ]);
    const recusado = await rejectKnowledgeItem(handle.db, { userId: USER, knowledgeItemId: id });
    expect(recusado?.ok).toBe(true);
    const store = createDatabaseContextStore(handle.db, { userId: USER });
    expect(
      await store.searchKnowledgeItems({ projectId, query: "porta | serviço", limit: 5 }),
    ).toEqual([]);
  });
});
