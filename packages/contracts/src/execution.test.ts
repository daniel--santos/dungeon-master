import { describe, expect, it } from "vitest";

import { AGENT_ROLE_VALUES, AgentRoleSchema } from "./agent.js";
import { DashboardEventTypeSchema, REGISTRY_EVENT_TYPE_VALUES } from "./dashboard-event.js";
import {
  ENFORCEMENT_LEVEL_VALUES,
  EXECUTION_MODE_VALUES,
  WORKSPACE_STRATEGY_VALUES,
} from "./execution-profile.js";
import { HARNESS_KEY_VALUES, HarnessCapabilitiesSchema } from "./harness.js";
import { WORKSPACE_KIND_VALUES } from "./project.js";
import { RUN_STATUS_VALUES, RunEventListQuerySchema, RunResultSchema, RunSchema } from "./run.js";

const UUID = "01996d00-0000-7000-8000-000000000001";

describe("enums de execução", () => {
  it("usam SCREAMING_SNAKE_CASE, como manda a convenção de camadas", () => {
    const enums = [
      RUN_STATUS_VALUES,
      EXECUTION_MODE_VALUES,
      WORKSPACE_STRATEGY_VALUES,
      HARNESS_KEY_VALUES,
      ENFORCEMENT_LEVEL_VALUES,
      WORKSPACE_KIND_VALUES,
      AGENT_ROLE_VALUES,
    ];

    for (const valores of enums) {
      for (const valor of valores) {
        expect(valor, valor).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it("AgentRole tem os quatro papéis do glossário", () => {
    expect(AgentRoleSchema.safeParse("ARCHITECT").success).toBe(true);
    expect(AgentRoleSchema.safeParse("BARD").success).toBe(false);
  });
});

describe("HarnessCapabilities", () => {
  it("exige todos os campos: uma capability ausente seria lida de dois jeitos", () => {
    const completa = {
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
    };

    expect(HarnessCapabilitiesSchema.safeParse(completa).success).toBe(true);

    const { resume: _resume, ...semResume } = completa;
    expect(HarnessCapabilitiesSchema.safeParse(semResume).success).toBe(false);
  });
});

describe("RunResult", () => {
  it("exige o veredito e aceita campos que as fases seguintes vão acrescentar", () => {
    const parsed = RunResultSchema.parse({
      status: "completed",
      summary: "Feito.",
      discoveredTasks: [{ title: "vem da Fase 5" }],
    });

    expect(parsed.status).toBe("completed");
    // O objeto é aberto de propósito: fechá-lo agora faria a API descartar em
    // silêncio o que o worker já sabe produzir.
    expect(parsed).toHaveProperty("discoveredTasks");
  });

  it("recusa um veredito fora do vocabulário", () => {
    expect(RunResultSchema.safeParse({ status: "COMPLETED" }).success).toBe(false);
  });
});

describe("Run", () => {
  it("aceita os campos nulos de um Run recém-criado", () => {
    const snapshotDeLoadout = {
      loadoutId: UUID,
      name: "Engenheiro com Claude Code",
      version: 1,
      agent: { id: UUID, name: "Engenheiro", role: "ENGINEER", instructions: "Implemente." },
      harness: {
        id: UUID,
        key: "CLAUDE_CODE",
        name: "Claude Code",
        capabilities: {
          streaming: true,
          structuredOutput: true,
          resume: true,
          multiTurnProcess: false,
          toolEvents: true,
          tokenUsage: true,
          modelSelection: true,
          agentSelection: true,
          nativePermissions: true,
          hostExecution: true,
          dockerExecution: true,
        },
      },
      model: null,
      executionProfileId: UUID,
      skills: [],
      tools: [],
      mcpServers: [],
      knowledgePolicy: { includeProjectSummary: true, includeDecisions: true, maxItems: 20 },
      contextPolicy: {
        includeParentContext: true,
        includeDependencyContext: true,
        maxTokens: 0,
      },
      capturedAt: "2026-09-07T12:00:00.000Z",
    };

    const parsed = RunSchema.parse({
      id: UUID,
      taskId: UUID,
      projectId: UUID,
      status: "QUEUED",
      harnessKey: "CLAUDE_CODE",
      harnessVersion: null,
      harnessSessionId: null,
      modelKey: null,
      executionMode: "HOST",
      workspacePath: null,
      workflowVersionId: null,
      resumedFromRunId: null,
      loadoutId: UUID,
      loadoutVersion: 1,
      loadoutSnapshot: snapshotDeLoadout,
      executionProfileSnapshot: {
        executionProfileId: UUID,
        name: "Campo aberto",
        mode: "HOST",
        workspaceStrategy: "GIT_WORKTREE",
        enforcement: "HARNESS_NATIVE",
        permissionPolicy: {
          workspaceWrite: true,
          commandExecution: "ALLOWLIST",
          allowedCommands: [],
          deniedCommands: [],
        },
        environmentPolicy: { allowedVariables: [], inheritPath: true },
        networkPolicy: { access: "ALL", allowedHosts: [] },
        capturedAt: "2026-09-07T12:00:00.000Z",
      },
      prompt: "Faça a coisa.",
      attempt: 1,
      startedAt: null,
      finishedAt: null,
      cancelRequestedAt: null,
      result: null,
      error: null,
      createdAt: "2026-09-07T12:00:00.000Z",
      updatedAt: "2026-09-07T12:00:00.000Z",
    });

    expect(parsed.attempt).toBe(1);
    expect(parsed.loadoutSnapshot.harness.key).toBe("CLAUDE_CODE");
  });
});

describe("RunEventListQuery", () => {
  it("aceita cursor e limite como texto, que é o que a URL carrega", () => {
    expect(RunEventListQuerySchema.safeParse({ after: "42", limit: "100" }).success).toBe(true);
  });

  it("recusa cursor negativo e limite zero", () => {
    expect(RunEventListQuerySchema.safeParse({ after: "-1" }).success).toBe(false);
    expect(RunEventListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });
});

describe("eventos de cadastro", () => {
  it("entram no vocabulário do stream de dashboard", () => {
    for (const type of REGISTRY_EVENT_TYPE_VALUES) {
      expect(DashboardEventTypeSchema.safeParse(type).success, type).toBe(true);
    }
  });

  it("os fatos de Run também, porque vêm do diário do Project", () => {
    for (const type of ["run.created", "run.status_changed", "run.cancel_requested"]) {
      expect(DashboardEventTypeSchema.safeParse(type).success, type).toBe(true);
    }
  });
});
