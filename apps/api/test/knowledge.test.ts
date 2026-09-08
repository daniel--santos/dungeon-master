import {
  DistillationRequestedSchema,
  DistillationRunPageSchema,
  ExecutionProfileListSchema,
  ForgedAchievementListSchema,
  ForgedAchievementSchema,
  HarnessListSchema,
  KnowledgeCandidatePageSchema,
  KnowledgeItemPageSchema,
  KnowledgeItemSchema,
  LoadoutSchema,
  ProblemDetailsSchema,
  type Project,
  ProjectSchema,
  ProjectSummarySchema,
  type RunResult,
  RunSchema,
} from "@dungeon-master/contracts";
import {
  claimNextQueuedRun,
  createDatabase,
  createDatabaseKnowledgeStore,
  type DatabaseHandle,
  LOCAL_USER_ID,
  seedKnowledgeLoadout,
  transitionRun,
  writeRunTerminalStatus,
} from "@dungeon-master/database";
import { distillProject } from "@dungeon-master/knowledge";
import { createScriptedKnowledgeRuntime } from "@dungeon-master/knowledge/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { App } from "../src/app.js";
import { API_BASE_PATH } from "../src/config.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import { criarApp, definirWorkspace, limparTudo, pedir, tiposDeEvento } from "./support.js";

/**
 * As rotas do Grimório (Fase 6): a lista com busca, a revisão por CAS, o
 * resumo, as decisões, o pedido de lote, os lotes e as forjadas.
 *
 * Os itens nascem de um lote de verdade: uma Expedição grava os candidatos
 * pela mesma porta que o Worker usa, e `distillProject` roda com o store de
 * banco e um modelo roteirizado — o mesmo caminho do Worker, sem o laço. A
 * API só lê e revisa; nada aqui chama um modelo.
 */

let handle: DatabaseHandle;
let app: App;
let project: Project;
let loadoutId: string;
let workspace: string;

const ID_INEXISTENTE = "01996d00-0000-7000-8000-0000000000ff";

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-grimorio",
  });
  app = criarApp(handle);
  workspace = mkdtempSync(join(tmpdir(), "dm-grimorio-"));
});

beforeEach(async () => {
  await limparTudo(handle);
  await handle.pool.query("delete from achievement_definition where user_id = $1", [LOCAL_USER_ID]);
  // `limparTudo` leva o Loadout do Escriba; ele volta pela semente.
  await seedKnowledgeLoadout(handle.db, { userId: LOCAL_USER_ID });

  const criado = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Grimório da Forja" },
  });
  project = ProjectSchema.parse(await criado.json());
  await definirWorkspace(handle, { projectId: project.id, workspacePath: workspace });
  loadoutId = await criarLoadout();
});

afterAll(async () => {
  await limparTudo(handle);
  await handle.close();
  rmSync(workspace, { recursive: true, force: true });
});

async function criarLoadout(): Promise<string> {
  const harnesses = HarnessListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/harnesses` })).json(),
  );
  const harness = harnesses.items.find((item) => item.key === "CLAUDE_CODE");
  const perfis = ExecutionProfileListSchema.parse(
    await (await pedir({ app, method: "GET", path: `${API_BASE_PATH}/execution-profiles` })).json(),
  );
  const perfil = perfis.items.find((item) => item.enabled);

  const agent = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/agents`,
    body: { name: "Engenheiro", role: "ENGINEER", instructions: "Implemente." },
  });
  const { id: agentId } = (await agent.json()) as { id: string };

  const response = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/loadouts`,
    body: { name: "Campo aberto", agentId, harnessId: harness?.id, executionProfileId: perfil?.id },
  });
  expect(response.status).toBe(201);
  return LoadoutSchema.parse(await response.json()).id;
}

/** Uma Expedição inteira pela API e pelas portas do Worker, com o resultado dado. */
async function expedicao(
  result: RunResult,
  title = "Missão",
): Promise<{ runId: string; taskId: string }> {
  const task = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks`,
    body: { projectId: project.id, title },
  });
  const { id: taskId } = (await task.json()) as { id: string };

  const criado = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/tasks/${taskId}/runs`,
    body: { loadoutId },
  });
  expect(criado.status).toBe(201);
  const run = RunSchema.parse(await criado.json());

  await claimNextQueuedRun(handle.db, { userId: LOCAL_USER_ID });
  await transitionRun(handle.db, { userId: LOCAL_USER_ID, runId: run.id, to: "RUNNING" });
  const desfecho = await writeRunTerminalStatus(handle.db, {
    userId: LOCAL_USER_ID,
    runId: run.id,
    status: "SUCCEEDED",
    result,
  });
  expect(desfecho?.ok).toBe(true);
  return { runId: run.id, taskId };
}

const RESULTADO: RunResult = {
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

/** Um lote do Distiller, como o Worker o roda, com o modelo roteirizado. */
async function destilar(input: { humanReview: boolean } = { humanReview: true }) {
  return await distillProject(
    {
      store: createDatabaseKnowledgeStore({ db: handle.db, userId: LOCAL_USER_ID }),
      runtime: createScriptedKnowledgeRuntime(),
    },
    {
      projectId: project.id,
      trigger: "MANUAL",
      settings: { humanReview: input.humanReview, forgeEveryNRuns: 20 },
      loadoutId: null,
    },
  );
}

/** O problem details cru: o schema valida a forma, mas os membros de extensão (`item`, `achievement`) ficam. */
async function problema(response: Response): Promise<Record<string, unknown>> {
  expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
  const raw = (await response.json()) as Record<string, unknown>;
  ProblemDetailsSchema.parse(raw);
  return raw;
}

describe(`GET ${API_BASE_PATH}/projects/{id}/knowledge`, () => {
  it("lista o Grimório com filtros de tipo, revisão e busca textual; 404 sem Project", async () => {
    await expedicao(RESULTADO);
    await destilar();

    const tudo = KnowledgeItemPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/projects/${project.id}/knowledge`,
        })
      ).json(),
    );
    expect(tudo.total).toBe(3);
    expect(tudo.items.every((item) => item.status === "PENDING_REVIEW")).toBe(true);
    expect(tudo.items[0]?.provenance.runId).not.toBeNull();

    const decisoes = KnowledgeItemPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/projects/${project.id}/knowledge?type=DECISION`,
        })
      ).json(),
    );
    expect(decisoes.items.map((item) => item.title)).toEqual(["Usar Drizzle no lugar de Prisma"]);

    const busca = KnowledgeItemPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/projects/${project.id}/knowledge?q=porta%208081`,
        })
      ).json(),
    );
    expect(busca.items.map((item) => item.title)).toEqual(["Porta do serviço"]);

    const pendentes = KnowledgeItemPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/projects/${project.id}/knowledge?review=pending`,
        })
      ).json(),
    );
    expect(pendentes.total).toBe(3);

    const semProject = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/projects/${ID_INEXISTENTE}/knowledge`,
    });
    expect(semProject.status).toBe(404);

    const invalido = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/projects/${project.id}/knowledge?type=X`,
    });
    expect(invalido.status).toBe(400);

    // Os candidatos mostram a decisão e o lote.
    const candidatos = KnowledgeCandidatePageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/knowledge-candidates?status=PROMOTED`,
        })
      ).json(),
    );
    expect(candidatos.total).toBe(3);
    expect(candidatos.items[0]).toMatchObject({ decision: "PROMOTE" });
    expect(candidatos.items[0]?.knowledgeItemId).not.toBeNull();
    expect(candidatos.items[0]?.distillationRunId).not.toBeNull();
  });
});

describe("revisão e edição de itens", () => {
  it("aprovar e recusar são CAS com 409 e o item atual; editar sobe a versão; arquivar só de ACTIVE", async () => {
    await expedicao(RESULTADO);
    await destilar();
    const pagina = KnowledgeItemPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/projects/${project.id}/knowledge`,
        })
      ).json(),
    );
    const [primeiro, segundo] = pagina.items;
    if (primeiro === undefined || segundo === undefined) throw new Error("sem itens");

    const aprovado = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/knowledge-items/${primeiro.id}/approve`,
      body: { note: "Vale." },
    });
    expect(aprovado.status).toBe(200);
    expect(KnowledgeItemSchema.parse(await aprovado.json())).toMatchObject({
      status: "ACTIVE",
      reviewNote: "Vale.",
    });

    const denovo = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/knowledge-items/${primeiro.id}/reject`,
      body: {},
    });
    expect(denovo.status).toBe(409);
    const conflito = await problema(denovo);
    expect((conflito as { item?: { status?: string } }).item?.status).toBe("ACTIVE");

    const recusado = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/knowledge-items/${segundo.id}/reject`,
      body: { note: "Fora do escopo." },
    });
    expect(recusado.status).toBe(200);
    expect(KnowledgeItemSchema.parse(await recusado.json())).toMatchObject({ status: "REJECTED" });

    const eventos = await tiposDeEvento(handle);
    expect(eventos.filter((t) => t === "knowledge.item.reviewed")).toHaveLength(2);
    expect(eventos.filter((t) => t === "knowledge_item.promoted")).toHaveLength(1);

    const editado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/knowledge-items/${primeiro.id}`,
      body: { title: "Título novo", type: "CONSTRAINT" },
    });
    expect(editado.status).toBe(200);
    expect(KnowledgeItemSchema.parse(await editado.json())).toMatchObject({
      title: "Título novo",
      type: "CONSTRAINT",
      version: 2,
    });

    const arquivarRecusado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/knowledge-items/${segundo.id}`,
      body: { archived: true },
    });
    expect(arquivarRecusado.status).toBe(409);

    const arquivado = await pedir({
      app,
      method: "PATCH",
      path: `${API_BASE_PATH}/knowledge-items/${primeiro.id}`,
      body: { archived: true },
    });
    expect(KnowledgeItemSchema.parse(await arquivado.json())).toMatchObject({ status: "ARCHIVED" });

    const lido = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/knowledge-items/${primeiro.id}`,
    });
    expect(KnowledgeItemSchema.parse(await lido.json()).archivedAt).not.toBeNull();

    expect(
      (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/knowledge-items/${ID_INEXISTENTE}`,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await pedir({
          app,
          method: "PATCH",
          path: `${API_BASE_PATH}/knowledge-items/${primeiro.id}`,
          body: { type: "SUMMARY" },
        })
      ).status,
    ).toBe(400);
  });
});

describe("resumo, decisões, pedido de lote e lotes", () => {
  it("o resumo é regenerado sem revisão; as decisões saem em ordem; o pedido responde 202", async () => {
    const semResumo = ProjectSummarySchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/projects/${project.id}/summary` })
      ).json(),
    );
    expect(semResumo).toEqual({
      projectId: project.id,
      item: null,
      activeItemCount: 0,
      promotedSinceSummary: 0,
    });

    await expedicao(RESULTADO);

    const pedido = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/projects/${project.id}/distill`,
    });
    expect(pedido.status).toBe(202);
    expect(DistillationRequestedSchema.parse(await pedido.json())).toMatchObject({
      projectId: project.id,
      pendingCandidates: 3,
    });
    expect(
      (
        await pedir({
          app,
          method: "POST",
          path: `${API_BASE_PATH}/projects/${ID_INEXISTENTE}/distill`,
        })
      ).status,
    ).toBe(404);

    await destilar({ humanReview: false });

    const resumo = ProjectSummarySchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/projects/${project.id}/summary` })
      ).json(),
    );
    expect(resumo).toMatchObject({ activeItemCount: 3, promotedSinceSummary: 0 });
    expect(resumo.item).toMatchObject({
      type: "SUMMARY",
      status: "ACTIVE",
      title: "Resumo roteirizado",
    });

    const decisoes = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/projects/${project.id}/decisions`,
    });
    expect(decisoes.status).toBe(200);
    const pagina = KnowledgeItemPageSchema.parse(await decisoes.json());
    expect(pagina.items.map((d) => [d.type, d.title])).toEqual([
      ["DECISION", "Usar Drizzle no lugar de Prisma"],
    ]);
    expect(pagina.items[0]?.provenance.runId).not.toBeNull();
    expect(
      (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/projects/${ID_INEXISTENTE}/decisions`,
        })
      ).status,
    ).toBe(404);

    const lotes = DistillationRunPageSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/distillation-runs?projectId=${project.id}`,
        })
      ).json(),
    );
    expect(lotes.total).toBe(1);
    expect(lotes.items[0]).toMatchObject({
      status: "SUCCEEDED",
      trigger: "MANUAL",
      promoted: 3,
      summaryRegenerated: true,
    });
  });
});

describe(`Conquistas forjadas em ${API_BASE_PATH}/achievements`, () => {
  it("a forjada do lote fica em revisão e invisível no Hall; renomear, aprovar (CAS) e descartar", async () => {
    // A primeira vitória da Guilda é resultado notável: o lote forja.
    await expedicao(RESULTADO);
    await destilar();

    const emRevisao = ForgedAchievementListSchema.parse(
      await (
        await pedir({ app, method: "GET", path: `${API_BASE_PATH}/achievements/forged` })
      ).json(),
    );
    expect(emRevisao.items).toHaveLength(1);
    const forjada = emRevisao.items[0];
    if (forjada === undefined) throw new Error("sem forjada");
    expect(forjada).toMatchObject({
      reviewStatus: "PENDING_REVIEW",
      name: "Carta roteirizada",
      provenance: { kind: "FIRST_HARNESS_VICTORY" },
    });
    expect((await tiposDeEvento(handle)).includes("achievement.forged")).toBe(true);

    const hall = (await (
      await pedir({ app, method: "GET", path: `${API_BASE_PATH}/achievements?origin=FORGED` })
    ).json()) as { items: unknown[] };
    expect(hall.items).toEqual([]);

    const renomeada = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/achievements/${forjada.id}/rename`,
      body: { name: "Estreia da Guilda" },
    });
    expect(renomeada.status).toBe(200);
    expect(ForgedAchievementSchema.parse(await renomeada.json()).name).toBe("Estreia da Guilda");

    const aprovada = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/achievements/${forjada.id}/approve`,
      body: { flavor: "Uma vitória. A arquibancada anotou." },
    });
    expect(aprovada.status).toBe(200);
    expect(ForgedAchievementSchema.parse(await aprovada.json())).toMatchObject({
      reviewStatus: "APPROVED",
      flavor: "Uma vitória. A arquibancada anotou.",
    });

    const visivel = (await (
      await pedir({ app, method: "GET", path: `${API_BASE_PATH}/achievements?origin=FORGED` })
    ).json()) as {
      items: Array<{ state: string; name: { theme: string } }>;
    };
    expect(visivel.items).toHaveLength(1);
    expect(visivel.items[0]).toMatchObject({
      state: "UNLOCKED",
      name: { theme: "Estreia da Guilda" },
    });

    const descartar = await pedir({
      app,
      method: "POST",
      path: `${API_BASE_PATH}/achievements/${forjada.id}/discard`,
    });
    expect(descartar.status).toBe(409);
    expect(
      ((await problema(descartar)) as { achievement?: { reviewStatus?: string } }).achievement
        ?.reviewStatus,
    ).toBe("APPROVED");

    expect(
      (
        await pedir({
          app,
          method: "POST",
          path: `${API_BASE_PATH}/achievements/${ID_INEXISTENTE}/discard`,
        })
      ).status,
    ).toBe(404);

    const aprovadas = ForgedAchievementListSchema.parse(
      await (
        await pedir({
          app,
          method: "GET",
          path: `${API_BASE_PATH}/achievements/forged?reviewStatus=APPROVED`,
        })
      ).json(),
    );
    expect(aprovadas.items.map((f) => f.id)).toEqual([forjada.id]);
  });
});
