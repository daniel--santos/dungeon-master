import {
  ExecutionProfileListSchema,
  HarnessListSchema,
  LoadoutSchema,
  type Project,
  ProjectSchema,
  type RunContext,
  RunContextSchema,
  RunSchema,
  type Task,
  TaskSchema,
  UserSettingsSchema,
} from "@dungeon-master/contracts";
import {
  createDatabase,
  type DatabaseHandle,
  LOCAL_USER_ID,
  saveRunContext,
} from "@dungeon-master/database";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { type App, createApp } from "../src/app.js";
import { createSettingsPort } from "../src/composition.js";
import { API_BASE_PATH } from "../src/config.js";
import { createSpecPorts } from "../src/ports.js";
import { PROBLEM_CONTENT_TYPE } from "../src/problem.js";
import { criarApp, definirWorkspace, limparTudo, pedir } from "./support.js";

/**
 * `GET /runs/{id}/context` e as configurações do Context Engine (Fase 7).
 *
 * A API só lê o registro que o Worker grava; aqui ele é gravado pelo mesmo
 * repositório que o Worker usa. As configurações novas aparecem em
 * `GET /settings` com os padrões e passam pelo schema da chave no `PUT`.
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
    applicationName: "vitest-run-context",
  });
  app = criarApp(handle);
  workspace = mkdtempSync(join(tmpdir(), "dm-run-context-"));
});

beforeEach(async () => {
  await limparTudo(handle);
  await handle.pool.query("delete from user_setting where user_id = $1 and key like 'context.%'", [
    LOCAL_USER_ID,
  ]);

  const criado = await pedir({
    app,
    method: "POST",
    path: `${API_BASE_PATH}/projects`,
    body: { title: "Contexto" },
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

async function criarRun(): Promise<{ runId: string; taskId: string }> {
  const task = TaskSchema.parse(
    await (
      await pedir({
        app,
        method: "POST",
        path: `${API_BASE_PATH}/tasks`,
        body: { projectId: project.id, title: "Missão" },
      })
    ).json(),
  ) as Task;
  const run = RunSchema.parse(
    await (
      await pedir({
        app,
        method: "POST",
        path: `${API_BASE_PATH}/tasks/${task.id}/runs`,
        body: { loadoutId },
      })
    ).json(),
  );
  return { runId: run.id, taskId: task.id };
}

function registro(runId: string, taskId: string): RunContext {
  return {
    runId,
    taskId,
    projectId: project.id,
    status: "ASSEMBLED",
    text: "## Contexto do projeto (recuperado automaticamente)\n\n<context>\n<skills>\n- review\n</skills>\n</context>",
    query: "porta | widgets",
    sections: [
      {
        kind: "SKILLS",
        title: "Skills do Loadout",
        items: [
          {
            id: "review",
            kind: "SKILL",
            title: "review",
            reason: "LOADOUT_SKILL",
            score: null,
            tokens: 3,
            truncated: false,
          },
        ],
        tokens: 12,
        budgetTokens: 175,
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
    usage: { estimatedTokens: 160, itemCount: 1, excludedCount: 0 },
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
          id: loadoutId,
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
  };
}

describe("GET /runs/{id}/context", () => {
  it("é 404 para um Run inexistente e para um Run ainda sem contexto", async () => {
    const inexistente = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${ID_INEXISTENTE}/context`,
    });
    expect(inexistente.status).toBe(404);
    expect(inexistente.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);
    expect(((await inexistente.json()) as { detail: string }).detail).toContain("Run");

    const { runId } = await criarRun();
    const semContexto = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${runId}/context`,
    });
    expect(semContexto.status).toBe(404);
    expect(((await semContexto.json()) as { detail: string }).detail).toContain("RunContext");
  });

  it("devolve o registro gravado pelo Worker, validado pelo contrato", async () => {
    const { runId, taskId } = await criarRun();
    await saveRunContext(handle.db, { userId: LOCAL_USER_ID, context: registro(runId, taskId) });

    const response = await pedir({
      app,
      method: "GET",
      path: `${API_BASE_PATH}/runs/${runId}/context`,
    });
    expect(response.status).toBe(200);
    const corpo = RunContextSchema.parse(await response.json());
    expect(corpo).toMatchObject({
      runId,
      taskId,
      projectId: project.id,
      status: "ASSEMBLED",
      query: "porta | widgets",
      inheritedFromRunId: null,
      error: null,
      assembledAt: "2026-09-08T12:00:00.000Z",
    });
    expect(corpo.text).toContain("<context>");
    expect(corpo.sections[0]?.items[0]?.reason).toBe("LOADOUT_SKILL");
    expect(corpo.policy.source.loadout.id).toBe(loadoutId);
  });
});

describe("as configurações do Context Engine", () => {
  // `criarApp` deixa a porta de configurações inerte; aqui ela é a real, e
  // todo o resto fica inerte, como no teste de Settings.
  let appDeSettings: App;

  beforeAll(() => {
    const inertes = createSpecPorts();
    appDeSettings = createApp({
      probeDatabase: async () => ({ ok: true, latencyMs: 0, error: null }),
      events: inertes.events,
      settings: createSettingsPort({ db: handle.db, userId: LOCAL_USER_ID }),
      work: inertes.work,
      execution: inertes.execution,
      achievements: inertes.achievements,
      hall: inertes.hall,
      pingEnabled: false,
    });
  });

  it("aparecem em GET /settings com os padrões", async () => {
    const response = await pedir({
      app: appDeSettings,
      method: "GET",
      path: `${API_BASE_PATH}/settings`,
    });
    expect(response.status).toBe(200);
    const settings = UserSettingsSchema.parse(await response.json());
    expect(settings).toMatchObject({
      "context.enabled": true,
      "context.budgetTokens": 6000,
      "context.maxKnowledgeItems": 8,
      "context.maxDecisions": 5,
      "context.maxArtifacts": 10,
    });
  });

  it("validam o valor pelo schema da chave", async () => {
    const baixo = await pedir({
      app: appDeSettings,
      method: "PUT",
      path: `${API_BASE_PATH}/settings/context.budgetTokens`,
      body: { value: 100 },
    });
    expect(baixo.status).toBe(400);

    const ok = await pedir({
      app: appDeSettings,
      method: "PUT",
      path: `${API_BASE_PATH}/settings/context.budgetTokens`,
      body: { value: 2500 },
    });
    expect(ok.status).toBe(200);
    expect(UserSettingsSchema.parse(await ok.json())["context.budgetTokens"]).toBe(2500);

    const desligado = await pedir({
      app: appDeSettings,
      method: "PUT",
      path: `${API_BASE_PATH}/settings/context.enabled`,
      body: { value: false },
    });
    expect(desligado.status).toBe(200);
    expect(UserSettingsSchema.parse(await desligado.json())["context.enabled"]).toBe(false);
  });
});
