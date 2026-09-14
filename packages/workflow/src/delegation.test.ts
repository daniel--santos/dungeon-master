import type { WorkflowDefinition } from "@dungeon-master/contracts";
import { WorkflowDefinitionSchema } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import type { WorkflowRunContext } from "./ports.js";
import { runWorkflow, type RunWorkflowInput, type WorkflowOutcome } from "./runner.js";
import {
  createFakeCommandExecutor,
  createFakeSnapshotter,
  createMemoryWorkflowStore,
  createScriptedAgentRuntime,
  statusesOf,
  type MemoryWorkflowStoreOptions,
  type MemoryWorkflowStore,
  type ScriptedResponse,
} from "./testing/index.js";

/**
 * A autonomia em movimento no motor (Fase 9B), sobre as portas em memória:
 * o step `delegate` abrindo o Run filho e soltando o Worker, a retomada por
 * outro runner reencontrando o filho, o cancelamento em cascata, a
 * profundidade, o orçamento estourando no meio e o Selo concedido ou negado
 * por política. A fiação com o banco é provada no Worker.
 */

const RUN_ID = "01990000-0000-7000-8000-00000000abcd";

const RITUAL_COM_DELEGACAO: WorkflowDefinition = WorkflowDefinitionSchema.parse({
  name: "Análise, revisão delegada e execução",
  steps: [
    { type: "agent", key: "analyze", name: "Analisar", prompt: "Analise a tarefa." },
    {
      type: "delegate",
      key: "review",
      name: "Revisar",
      dependsOn: ["analyze"],
      includeOutputsOf: ["analyze"],
      loadoutRef: "Revisor",
      prompt: "Revise a análise.",
    },
    {
      type: "agent",
      key: "execute",
      name: "Executar",
      dependsOn: ["review"],
      includeOutputsOf: ["review"],
      prompt: "Implemente o que a revisão aprovou.",
    },
  ],
});

const RUN: WorkflowRunContext = {
  runId: RUN_ID,
  harnessKey: "CLAUDE_CODE",
  prompt: "Criar o CHANGELOG.md do projeto.",
  checkoutPath: process.platform === "win32" ? "C:\\checkout" : "/checkout",
  workspaceStrategy: "GIT_WORKTREE",
  executionMode: "HOST",
};

const completed = (
  summary: string,
  extra: Partial<ScriptedResponse & { kind: "completed" }> = {},
) =>
  ({
    kind: "completed",
    output: { status: "completed", summary },
    summary,
    ...extra,
  }) satisfies ScriptedResponse;

interface Harness {
  readonly store: MemoryWorkflowStore;
  readonly agent: ReturnType<typeof createScriptedAgentRuntime>;
  run(overrides?: Partial<RunWorkflowInput>): Promise<WorkflowOutcome>;
}

function montar(input: {
  definition?: WorkflowDefinition;
  scripts?: Record<string, readonly ScriptedResponse[]>;
  store?: MemoryWorkflowStore;
  storeOptions?: Partial<MemoryWorkflowStoreOptions>;
}): Harness {
  const definition = input.definition ?? RITUAL_COM_DELEGACAO;
  const store =
    input.store ??
    createMemoryWorkflowStore({ runId: RUN_ID, steps: definition.steps, ...input.storeOptions });
  const agent = createScriptedAgentRuntime({ scripts: input.scripts ?? {} });
  const commands = createFakeCommandExecutor(() => ({ kind: "result", result: { exitCode: 0 } }));
  const snapshots = createFakeSnapshotter();
  return {
    store,
    agent,
    run: (overrides) =>
      runWorkflow({ run: RUN, definition, store, agent, commands, snapshots, ...overrides }),
  };
}

function tipos(store: MemoryWorkflowStore): string[] {
  return store.events.map((event) => event.type);
}

function codigos(store: MemoryWorkflowStore): string[] {
  return store.events.flatMap((event) =>
    event.type === "Diagnostic" && event.code !== undefined ? [event.code] : [],
  );
}

describe("delegação feliz", () => {
  it("abre o Run filho, leva step e Run a WAITING_CHILD e devolve waiting", async () => {
    const h = montar({ scripts: { analyze: [completed("Análise: um arquivo a criar.")] } });

    const outcome = await h.run();

    expect(outcome.kind).toBe("waiting");
    if (outcome.kind !== "waiting") return;
    expect(outcome.stepKey).toBe("review");
    const filho = h.store.children.get("review");
    expect(filho?.id).toBe(outcome.childRunId);
    expect(filho?.status).toBe("QUEUED");

    expect(statusesOf(await h.store.listRunSteps())).toEqual({
      analyze: "SUCCEEDED",
      review: "WAITING_CHILD",
      execute: "PENDING",
    });
    expect(h.store.runStatus).toBe("WAITING_CHILD");

    // O prompt do filho leva a Task, o literal do passo e a saída da análise.
    expect(h.store.delegations).toHaveLength(1);
    const pedido = h.store.delegations[0]!;
    expect(pedido.loadoutRef).toBe("Revisor");
    expect(pedido.taskStrategy).toBe("SAME");
    expect(pedido.prompt.startsWith("# Tarefa\n\nCriar o CHANGELOG.md do projeto.")).toBe(true);
    expect(pedido.prompt).toContain("Revise a análise.");
    expect(pedido.prompt).toContain("Análise: um arquivo a criar.");

    expect(codigos(h.store)).toContain("DELEGATION_STARTED");
    expect(h.agent.executionsOf("execute")).toBe(0);
  });

  it("um restart no meio da espera reencontra o filho e não abre um segundo", async () => {
    const primeiro = montar({ scripts: { analyze: [completed("Análise.")] } });
    await primeiro.run();

    // O Worker caiu e subiu; o Run foi reclamado de novo com o filho ainda em voo.
    primeiro.store.runStatus = "RUNNING";
    const segundo = montar({ store: primeiro.store, scripts: {} });
    const outcome = await segundo.run();

    expect(outcome.kind).toBe("waiting");
    expect(primeiro.store.delegations).toHaveLength(1);
    expect(primeiro.store.children.size).toBe(1);
    expect(segundo.agent.executionsOf("analyze")).toBe(0);
  });

  it("o desfecho do filho devolve o Run à fila; o runner seguinte assenta o passo e segue", async () => {
    const primeiro = montar({ scripts: { analyze: [completed("Análise.")] } });
    const espera = await primeiro.run();
    if (espera.kind !== "waiting") throw new Error("esperava waiting");

    // O filho terminou: o banco (aqui, o store) devolve a mãe à fila.
    primeiro.store.settleChild("review", {
      status: "SUCCEEDED",
      resultStatus: "completed",
      summary: "Revisão: aprovado com uma ressalva.",
      usage: {
        inputTokens: 40,
        outputTokens: 10,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });
    expect(primeiro.store.runStatus).toBe("QUEUED");
    expect(codigos(primeiro.store)).toContain("DELEGATION_FINISHED");

    // O Worker reclama o Run: PREPARING → RUNNING, e outro runner continua.
    primeiro.store.runStatus = "RUNNING";
    const segundo = montar({
      store: primeiro.store,
      scripts: {
        execute: [
          completed("Implementado.", {
            usage: {
              inputTokens: 5,
              outputTokens: 5,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
          }),
        ],
      },
    });
    const outcome = await segundo.run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    expect(statusesOf(outcome.steps)).toEqual({
      analyze: "SUCCEEDED",
      review: "SUCCEEDED",
      execute: "SUCCEEDED",
    });

    const review = primeiro.store.step("review");
    expect(review.result).toMatchObject({
      kind: "delegate",
      childRunId: espera.childRunId,
      status: "SUCCEEDED",
      resultStatus: "completed",
      summary: "Revisão: aprovado com uma ressalva.",
    });

    // O execute recebeu a saída do filho no prompt; o consumo do filho entrou na soma.
    const pedido = segundo.agent.requests.find((request) => request.stepKey === "execute");
    expect(pedido?.prompt).toContain("Revisão: aprovado com uma ressalva.");
    expect(pedido?.prompt).toContain(`Run filho ${espera.childRunId} terminou em SUCCEEDED`);
    expect(outcome.result.usage).toMatchObject({ inputTokens: 45, outputTokens: 15 });
    expect(outcome.result.summary).toBe("Implementado.");
    expect(segundo.agent.executionsOf("analyze")).toBe(0);
    expect(tipos(primeiro.store).filter((type) => type === "StepFinished")).toHaveLength(3);
  });

  it("um filho que falhou assenta o passo em FAILED com DELEGATION_FAILED e o Run falha", async () => {
    const primeiro = montar({ scripts: { analyze: [completed("Análise.")] } });
    await primeiro.run();
    primeiro.store.settleChild("review", {
      status: "TIMED_OUT",
      error: { code: "TIMEOUT_IDLE", message: "o revisor ficou mudo" },
    });
    primeiro.store.runStatus = "RUNNING";

    const outcome = await montar({ store: primeiro.store }).run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe("DELEGATION_FAILED");
    expect(outcome.error?.message).toContain("o revisor ficou mudo");
    expect(statusesOf(outcome.steps)).toEqual({
      analyze: "SUCCEEDED",
      review: "FAILED",
      execute: "SKIPPED",
    });
  });
});

describe("cancelamento em cascata", () => {
  it("um cancelamento pedido durante a espera fecha o passo que esperava e os pendentes", async () => {
    const primeiro = montar({ scripts: { analyze: [completed("Análise.")] } });
    await primeiro.run();

    // O laço ocioso do Worker faz isto pelo banco; aqui o runner reclamado
    // de novo encontra a marca e cancela o que estava aberto.
    primeiro.store.cancelRequested = true;
    primeiro.store.runStatus = "RUNNING";
    const outcome = await montar({ store: primeiro.store }).run();

    expect(outcome.kind).toBe("cancelled");
    if (outcome.kind !== "cancelled") return;
    expect(statusesOf(outcome.steps)).toEqual({
      analyze: "SUCCEEDED",
      review: "CANCELLED",
      execute: "CANCELLED",
    });
  });
});

describe("profundidade e recusas da delegação", () => {
  it("DELEGATION_DEPTH_EXCEEDED assenta o passo em FAILED sem retentar", async () => {
    const h = montar({
      scripts: { analyze: [completed("Análise.")] },
      storeOptions: {
        delegation: () => ({
          ok: false,
          code: "DELEGATION_DEPTH_EXCEEDED",
          detail: "O Run mãe está na profundidade 2; o teto é 2.",
        }),
      },
    });

    const outcome = await h.run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe("DELEGATION_DEPTH_EXCEEDED");
    expect(h.store.step("review").error?.code).toBe("DELEGATION_DEPTH_EXCEEDED");
    expect(h.store.children.size).toBe(0);
    expect(statusesOf(outcome.steps).execute).toBe("SKIPPED");
  });
});

describe("orçamento no meio do Workflow", () => {
  it("BLOCK no teto assenta o passo em FAILED com BUDGET_EXCEEDED sem subir agente", async () => {
    let checagens = 0;
    const h = montar({
      definition: WorkflowDefinitionSchema.parse({
        name: "Dois agentes",
        steps: [
          { type: "agent", key: "first", name: "A", prompt: "a", retry: { maxAttempts: 3 } },
          { type: "agent", key: "second", name: "B", prompt: "b", dependsOn: ["first"] },
        ],
      }),
      scripts: { first: [completed("a feito")], second: [completed("b feito")] },
      storeOptions: {
        budget: () => {
          checagens += 1;
          return checagens === 1
            ? {
                blocked: null,
                warnings: [
                  { budgetId: "B-warn", name: "aviso", action: "WARN", reason: "80% do teto." },
                ],
              }
            : {
                blocked: {
                  budgetId: "B-1",
                  name: "por Run",
                  action: "BLOCK",
                  reason: 'O orçamento "por Run" (B-1) está no teto de maxTokens (100 de 100).',
                },
                warnings: [],
              };
        },
      },
    });

    const outcome = await h.run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe("BUDGET_EXCEEDED");
    expect(statusesOf(outcome.steps)).toEqual({ first: "SUCCEEDED", second: "FAILED" });
    expect(h.agent.executionsOf("first")).toBe(1);
    expect(h.agent.executionsOf("second")).toBe(0);
    expect(h.store.step("second").error).toMatchObject({
      code: "BUDGET_EXCEEDED",
      budgetId: "B-1",
    });
    const diagnosticos = codigos(h.store);
    expect(diagnosticos).toContain("BUDGET_WARNED");
    expect(diagnosticos).toContain("BUDGET_EXCEEDED");
  });

  it("um passo com retry não retenta um estouro de orçamento", async () => {
    const h = montar({
      definition: WorkflowDefinitionSchema.parse({
        name: "Com retry",
        steps: [{ type: "agent", key: "only", name: "A", prompt: "a", retry: { maxAttempts: 3 } }],
      }),
      scripts: { only: [completed("a")] },
      storeOptions: {
        budget: () => ({
          blocked: { budgetId: "B-1", name: "por Run", action: "BLOCK", reason: "no teto" },
          warnings: [],
        }),
      },
    });

    const outcome = await h.run();

    expect(outcome.kind).toBe("settled");
    expect(h.store.step("only").status).toBe("FAILED");
    expect(h.store.step("only").attempt).toBe(1);
    expect(h.agent.executionsOf("only")).toBe(0);
  });
});

describe("Selo por política", () => {
  const RITUAL_COM_SELO: WorkflowDefinition = WorkflowDefinitionSchema.parse({
    name: "Com Selo",
    steps: [
      { type: "agent", key: "plan", name: "Planejar", prompt: "Planeje." },
      {
        type: "approval",
        key: "approve-plan",
        name: "Aprovar o plano",
        dependsOn: ["plan"],
        gateKey: "plan",
        title: "Aprovar o plano",
      },
      {
        type: "agent",
        key: "execute",
        name: "Executar",
        dependsOn: ["approve-plan"],
        when: [{ kind: "stepSucceeded", step: "approve-plan" }],
        prompt: "Execute.",
      },
    ],
  });

  it("AUTO_APPROVE concede o gate na hora, com a autoria da política, e o passo segue sem pausar", async () => {
    const h = montar({
      definition: RITUAL_COM_SELO,
      scripts: { plan: [completed("Plano.")], execute: [completed("Executado.")] },
      storeOptions: {
        gatePolicy: () => ({
          action: "AUTO_APPROVE",
          policyId: "01996d00-0000-7000-8000-0000000000p1",
        }),
      },
    });

    const outcome = await h.run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    expect(statusesOf(outcome.steps)).toEqual({
      plan: "SUCCEEDED",
      "approve-plan": "SUCCEEDED",
      execute: "SUCCEEDED",
    });
    expect(h.store.gates[0]?.status).toBe("GRANTED");
    expect(h.store.step("approve-plan").result).toMatchObject({
      kind: "approval",
      decision: "approve",
      gateId: h.store.gates[0]?.id,
    });

    const concedido = h.store.events.find((event) => event.type === "ApprovalGranted");
    expect(concedido).toMatchObject({
      grantedBy: "POLICY:01996d00-0000-7000-8000-0000000000p1",
      decidedBy: "01996d00-0000-7000-8000-0000000000p1",
    });
    expect(tipos(h.store)).toContain("ApprovalRequested");
    // Nunca pausou: o Run ficou em RUNNING do primeiro ao último passo.
    expect(h.store.runStatus).toBe("RUNNING");
  });

  it("DENY recusa o gate na hora: APPROVAL_REJECTED, execute pulado, Run FAILED", async () => {
    const h = montar({
      definition: RITUAL_COM_SELO,
      scripts: { plan: [completed("Plano.")], execute: [completed("Executado.")] },
      storeOptions: {
        gatePolicy: () => ({
          action: "DENY",
          policyId: "01996d00-0000-7000-8000-0000000000p2",
          reason: 'A política "sem execução à noite" casou e recusa.',
        }),
      },
    });

    const outcome = await h.run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe("APPROVAL_REJECTED");
    expect(outcome.error?.message).toContain("sem execução à noite");
    expect(statusesOf(outcome.steps)).toEqual({
      plan: "SUCCEEDED",
      "approve-plan": "FAILED",
      execute: "SKIPPED",
    });
    const recusado = h.store.events.find((event) => event.type === "ApprovalRejected");
    expect(recusado).toMatchObject({ rejectedBy: "POLICY:01996d00-0000-7000-8000-0000000000p2" });
    expect(h.agent.executionsOf("execute")).toBe(0);
  });

  it("sem política que decida, o gate pausa como sempre", async () => {
    const h = montar({
      definition: RITUAL_COM_SELO,
      scripts: { plan: [completed("Plano.")] },
      storeOptions: { gatePolicy: () => undefined },
    });

    const outcome = await h.run();

    expect(outcome.kind).toBe("paused");
    expect(h.store.runStatus).toBe("WAITING_APPROVAL");
  });
});
