import type { WorkflowDefinition, WorkflowStepDefinition } from "@dungeon-master/contracts";
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
  type FakeCommandScript,
  type MemoryWorkflowStore,
  type ScriptedResponse,
} from "./testing/index.js";

/**
 * O runner sobre as portas em memória.
 *
 * O que estes testes provam é a **coreografia**: ordem, retomada, gate, retry,
 * timeout, cancelamento. Processo e git de verdade têm testes próprios
 * (`process-command-executor.test.ts`, `git-checkout-snapshot.test.ts`); a
 * fiação com o banco é provada no Worker, com PostgreSQL embutido.
 */

const RUN_ID = "01990000-0000-7000-8000-00000000abcd";

/** A "Expedição guiada" da semente: Analyze → Plan → [Approval] → Execute → Validate. */
const EXPEDICAO_GUIADA: WorkflowDefinition = WorkflowDefinitionSchema.parse({
  name: "Expedição guiada",
  steps: [
    { type: "agent", key: "analyze", name: "Analisar", prompt: "Analise a tarefa." },
    {
      type: "agent",
      key: "plan",
      name: "Planejar",
      dependsOn: ["analyze"],
      includeOutputsOf: ["analyze"],
      prompt: "Escreva o plano.",
    },
    {
      type: "approval",
      key: "approve-plan",
      name: "Aprovar o plano",
      dependsOn: ["plan"],
      gateKey: "plan",
      title: "Aprovar o plano de implementação",
      description: "O plano precisa de aprovação.",
    },
    {
      type: "agent",
      key: "execute",
      name: "Executar",
      dependsOn: ["approve-plan"],
      includeOutputsOf: ["plan"],
      when: [{ kind: "stepSucceeded", step: "approve-plan" }],
      prompt: "Implemente o plano.",
    },
    {
      type: "validation",
      key: "validate",
      name: "Validar",
      dependsOn: ["execute"],
      argv: ["git", "status", "--porcelain"],
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
  readonly commands: ReturnType<typeof createFakeCommandExecutor>;
  readonly snapshots: ReturnType<typeof createFakeSnapshotter>;
  run(overrides?: Partial<RunWorkflowInput>): Promise<WorkflowOutcome>;
}

function montar(input: {
  definition?: WorkflowDefinition;
  scripts?: Record<string, readonly ScriptedResponse[]>;
  command?: (argv: readonly string[]) => FakeCommandScript;
  run?: Partial<WorkflowRunContext>;
  store?: MemoryWorkflowStore;
}): Harness {
  const definition = input.definition ?? EXPEDICAO_GUIADA;
  const store =
    input.store ?? createMemoryWorkflowStore({ runId: RUN_ID, steps: definition.steps });
  const agent = createScriptedAgentRuntime({ scripts: input.scripts ?? {} });
  const commands = createFakeCommandExecutor(
    (request) => input.command?.(request.argv) ?? { kind: "result", result: { exitCode: 0 } },
  );
  const snapshots = createFakeSnapshotter();
  const run = { ...RUN, ...input.run };

  return {
    store,
    agent,
    commands,
    snapshots,
    run: (overrides) =>
      runWorkflow({
        run,
        definition,
        store,
        agent,
        commands,
        snapshots,
        ...overrides,
      }),
  };
}

function tipos(store: MemoryWorkflowStore): string[] {
  return store.events.map((event) => event.type);
}

describe("Expedição guiada", () => {
  it("roda analyze e plan, abre o gate e devolve paused com o Run esperando", async () => {
    const h = montar({
      scripts: {
        analyze: [completed("Análise feita.", { sessionId: "s-analyze" })],
        plan: [completed("Plano em três passos.", { sessionId: "s-plan" })],
      },
    });

    const outcome = await h.run();

    expect(outcome.kind).toBe("paused");
    if (outcome.kind !== "paused") return;
    expect(outcome.stepKey).toBe("approve-plan");
    expect(outcome.gate.gateKey).toBe("plan");
    expect(outcome.gate.status).toBe("PENDING");

    expect(statusesOf(await h.store.listRunSteps())).toEqual({
      analyze: "SUCCEEDED",
      plan: "SUCCEEDED",
      "approve-plan": "WAITING_APPROVAL",
      execute: "PENDING",
      validate: "PENDING",
    });
    expect(h.store.runStatus).toBe("WAITING_APPROVAL");
    expect(h.store.gates).toHaveLength(1);

    // Todo passo de agente recebe a Task na frente; o do plano leva também o
    // resultado da análise, em texto claro.
    const pedidoDaAnalise = h.agent.requests.find((request) => request.stepKey === "analyze");
    expect(pedidoDaAnalise?.prompt.startsWith("# Tarefa\n\nCriar o CHANGELOG.md do projeto.")).toBe(
      true,
    );
    const pedidoDoPlano = h.agent.requests.find((request) => request.stepKey === "plan");
    expect(pedidoDoPlano?.prompt).toContain("Criar o CHANGELOG.md do projeto.");
    expect(pedidoDoPlano?.prompt).toContain("Escreva o plano.");
    expect(pedidoDoPlano?.prompt).toContain("«Analisar» (analyze)");
    expect(pedidoDoPlano?.prompt).toContain("Análise feita.");

    // A sessão de cada agente foi registrada no Run.
    expect(h.store.harnessSessionIds).toEqual(["s-analyze", "s-plan"]);

    const eventos = tipos(h.store);
    expect(eventos.filter((type) => type === "StepStarted")).toHaveLength(3);
    expect(eventos.filter((type) => type === "StepFinished")).toHaveLength(2);
    expect(eventos).toContain("ApprovalRequested");
    // Nenhum evento terminal de Run no meio do Workflow.
    expect(eventos).not.toContain("RunCompleted");
    expect(eventos).not.toContain("RunStarted");
  });

  it("depois da aprovação, um runner novo sobre o mesmo store continua sem repetir passos", async () => {
    const scripts = {
      analyze: [completed("Análise feita.")],
      plan: [completed("Plano.", { sessionId: "s-plan" })],
      execute: [
        completed("Implementado.", {
          sessionId: "s-execute",
          output: {
            status: "completed",
            summary: "Implementado.",
            artifacts: [{ path: "src/a.ts" }],
            knowledgeCandidates: [{ title: "Dica", content: "Use o snapshot." }],
            discoveredTasks: [{ title: "Cobrir a.ts com testes", rationale: "Ficou sem." }],
          },
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        }),
      ],
    };

    const primeiro = montar({ scripts });
    expect((await primeiro.run()).kind).toBe("paused");

    // A decisão chega pela API enquanto nenhum Worker segura o Run.
    primeiro.store.resolveGate("plan", "approve", "Pode ir.");
    expect(primeiro.store.runStatus).toBe("QUEUED");
    primeiro.store.runStatus = "RUNNING";

    // "Restart": outro runner, outro runtime roteirizado, o mesmo store.
    const segundo = montar({
      scripts,
      store: primeiro.store,
      command: (argv) => ({
        kind: "result",
        result: { exitCode: 0, stdoutTail: argv.join(" ") },
      }),
    });
    const outcome = await segundo.run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    expect(statusesOf(outcome.steps)).toEqual({
      analyze: "SUCCEEDED",
      plan: "SUCCEEDED",
      "approve-plan": "SUCCEEDED",
      execute: "SUCCEEDED",
      validate: "SUCCEEDED",
    });

    // analyze e plan não rodaram de novo no segundo runner.
    expect(segundo.agent.executionsOf("analyze")).toBe(0);
    expect(segundo.agent.executionsOf("plan")).toBe(0);
    expect(segundo.agent.executionsOf("execute")).toBe(1);

    // O prompt de execute leva o plano aprovado.
    const pedido = segundo.agent.requests.find((request) => request.stepKey === "execute");
    expect(pedido?.prompt).toContain("Plano.");

    // A validação rodou o argv no checkout.
    expect(segundo.commands.requests).toEqual([
      { argv: ["git", "status", "--porcelain"], cwd: RUN.checkoutPath },
    ]);

    // O resultado agregado tem o formato do Run simples.
    expect(outcome.result.status).toBe("completed");
    expect(outcome.result.summary).toBe("Implementado.");
    expect(outcome.result["artifacts"]).toEqual([{ path: "src/a.ts" }]);
    expect(outcome.result["knowledgeCandidates"]).toEqual([
      { title: "Dica", content: "Use o snapshot." },
    ]);
    expect(outcome.result["discoveredTasks"]).toEqual([
      { title: "Cobrir a.ts com testes", rationale: "Ficou sem." },
    ]);
    expect(outcome.result.usage?.inputTokens).toBe(10);
    expect(outcome.harnessSessionId).toBe("s-execute");
    expect(outcome.error).toBeUndefined();
  });

  it("um Run pausado reencontra o gate pela chave: nunca um segundo gate", async () => {
    const h = montar({
      scripts: { analyze: [completed("a")], plan: [completed("p")] },
    });
    const primeiro = await h.run();
    expect(primeiro.kind).toBe("paused");

    // O Worker reinicia e reclama o Run enquanto o gate continua pendente.
    h.store.runStatus = "RUNNING";
    const segundo = await h.run();

    expect(segundo.kind).toBe("paused");
    if (segundo.kind !== "paused" || primeiro.kind !== "paused") return;
    expect(segundo.gate.id).toBe(primeiro.gate.id);
    expect(h.store.gates).toHaveLength(1);
    expect(h.store.events.filter((event) => event.type === "ApprovalRequested")).toHaveLength(1);
    expect(h.agent.executionsOf("analyze")).toBe(1);
  });

  it("a definição editada depois não alcança o Run: só a versão congelada conta", async () => {
    const h = montar({
      scripts: { analyze: [completed("a")], plan: [completed("p")], execute: [completed("e")] },
    });
    expect((await h.run()).kind).toBe("paused");
    h.store.resolveGate("plan", "approve");
    h.store.runStatus = "RUNNING";

    // A "edição" do Workflow vigente: um step novo e o prompt de execute trocado.
    const editada: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      ...EXPEDICAO_GUIADA,
      steps: [
        ...EXPEDICAO_GUIADA.steps.map((step) =>
          step.key === "execute" ? { ...step, prompt: "PROMPT NOVO" } : step,
        ),
        {
          type: "knowledge",
          key: "collect",
          name: "Coletar",
          dependsOn: ["validate"],
          mode: "collect",
        },
      ],
    });
    void editada;

    // O runner recebe a versão congelada, e é ela que dita os passos.
    const outcome = await h.run({ definition: EXPEDICAO_GUIADA });
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(Object.keys(statusesOf(outcome.steps))).toEqual([
      "analyze",
      "plan",
      "approve-plan",
      "execute",
      "validate",
    ]);
    const pedido = h.agent.requests.find((request) => request.stepKey === "execute");
    expect(pedido?.prompt).toContain("Implemente o plano.");
    expect(pedido?.prompt).not.toContain("PROMPT NOVO");
  });

  it("recusa do gate pula execute e validate e leva o Run a FAILED com o motivo", async () => {
    const h = montar({
      scripts: { analyze: [completed("a")], plan: [completed("p")], execute: [completed("e")] },
    });
    expect((await h.run()).kind).toBe("paused");
    h.store.resolveGate("plan", "reject", "Plano incompleto.");
    h.store.runStatus = "RUNNING";

    const outcome = await h.run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    expect(statusesOf(outcome.steps)).toEqual({
      analyze: "SUCCEEDED",
      plan: "SUCCEEDED",
      "approve-plan": "FAILED",
      execute: "SKIPPED",
      validate: "SKIPPED",
    });
    expect(h.agent.executionsOf("execute")).toBe(0);

    expect(outcome.error?.code).toBe("APPROVAL_REJECTED");
    expect(outcome.error?.message).toContain("Plano incompleto.");
    expect(outcome.result.status).toBe("failed");
    expect(outcome.result.warnings).toHaveLength(2);
    expect(outcome.result.warnings?.[0]).toContain("stepSucceeded");
    expect(outcome.result.warnings?.[1]).toContain('"execute" terminou em SKIPPED');

    const pulados = h.store.events.filter((event) => event.type === "StepSkipped");
    expect(pulados).toHaveLength(2);
    const execute = h.store.step("execute");
    expect(execute.error?.code).toBe("PREDICATE_FALSE");
    const validate = h.store.step("validate");
    expect(validate.error?.code).toBe("DEPENDENCY_NOT_SUCCEEDED");
  });
});

describe("retentativa e snapshot", () => {
  const comRetry: WorkflowDefinition = WorkflowDefinitionSchema.parse({
    name: "Com retry",
    steps: [
      {
        type: "agent",
        key: "work",
        name: "Trabalhar",
        prompt: "Faça.",
        retry: { maxAttempts: 3 },
      },
    ],
  });

  it("registra o checkout antes da primeira tentativa e restaura antes de cada retentativa", async () => {
    const h = montar({
      definition: comRetry,
      scripts: {
        work: [
          { kind: "failed", message: "primeira caiu", code: "BOOM" },
          { kind: "failed", message: "segunda caiu", code: "BOOM" },
          completed("terceira foi"),
        ],
      },
    });

    const outcome = await h.run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    const step = h.store.step("work");
    expect(step.status).toBe("SUCCEEDED");
    expect(step.attempt).toBe(3);
    expect(step.error).toBeNull();
    expect(h.agent.executionsOf("work")).toBe(3);

    expect(h.snapshots.calls).toEqual([
      { op: "snapshot", stepKey: "work" },
      { op: "restore", stepKey: "work" },
      { op: "restore", stepKey: "work" },
      { op: "discard", stepKey: "work" },
    ]);

    // Cada retentativa é RUNNING → PENDING, e FAILED nunca aparece no meio.
    const transicoes = h.store.transitionsFor("work").map((t) => `${t.from}>${t.to}`);
    expect(transicoes).toEqual([
      "PENDING>RUNNING",
      "RUNNING>PENDING",
      "PENDING>RUNNING",
      "RUNNING>PENDING",
      "PENDING>RUNNING",
      "RUNNING>SUCCEEDED",
    ]);
    expect(tipos(h.store).filter((type) => type === "StepStarted")).toHaveLength(3);
    expect(tipos(h.store).filter((type) => type === "StepFinished")).toHaveLength(1);
  });

  it("a última tentativa falhando assenta FAILED com o erro dela", async () => {
    const h = montar({
      definition: comRetry,
      scripts: {
        work: [
          { kind: "failed", message: "1" },
          { kind: "failed", message: "2" },
          { kind: "failed", message: "3", code: "LAST" },
        ],
      },
    });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    expect(h.store.step("work").status).toBe("FAILED");
    expect(h.store.step("work").error?.code).toBe("LAST");
    expect(outcome.error?.code).toBe("LAST");
    expect(outcome.error?.["stepKey"]).toBe("work");
  });

  it("no checkout CURRENT retenta sem restaurar e registra um Diagnostic", async () => {
    const h = montar({
      definition: comRetry,
      run: { workspaceStrategy: "CURRENT" },
      scripts: { work: [{ kind: "failed", message: "x" }, completed("ok")] },
    });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    expect(h.snapshots.calls.map((call) => call.op)).toEqual(["snapshot", "discard"]);

    const aviso = h.store.events.find(
      (event) => event.type === "Diagnostic" && event.message.includes("sem restaurar o checkout"),
    );
    expect(aviso).toBeDefined();
  });

  it("um snapshot que falha vira aviso, não falha do passo", async () => {
    const h = montar({
      definition: comRetry,
      scripts: { work: [completed("ok")] },
    });
    h.snapshots.failNext = new Error("git indisponível");

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    const aviso = h.store.events.find(
      (event) => event.type === "Diagnostic" && event.detail === "git indisponível",
    );
    expect(aviso).toBeDefined();
  });

  it("um passo sem retry não tira snapshot", async () => {
    const h = montar({ scripts: { analyze: [completed("a")], plan: [completed("p")] } });
    await h.run();
    expect(h.snapshots.calls.filter((call) => call.op === "snapshot")).toHaveLength(0);
  });
});

describe("timeout", () => {
  it("um comando que não termina no teto vai a TIMED_OUT com a árvore morta", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Lento",
      steps: [
        { type: "command", key: "slow", name: "Lento", argv: ["sleep", "1000"], timeoutMs: 50 },
      ],
    });
    const h = montar({ definition, command: () => ({ kind: "hang" }) });

    const outcome = await h.run();

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    const step = h.store.step("slow");
    expect(step.status).toBe("TIMED_OUT");
    expect(step.attempt).toBe(1);
    expect(step.error?.code).toBe("TIMEOUT_COMPLETION");
    expect(step.error?.["processTreeTerminated"]).toBe(true);
    expect(h.commands.terminations).toBe(1);
    expect(outcome.error?.code).toBe("TIMEOUT_COMPLETION");
  });

  it("o timeout conta como tentativa e retenta quando há retry", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Lento com retry",
      steps: [
        {
          type: "command",
          key: "slow",
          name: "Lento",
          argv: ["x"],
          timeoutMs: 30,
          retry: { maxAttempts: 2 },
        },
      ],
    });
    let chamadas = 0;
    const h = montar({
      definition,
      command: () => {
        chamadas += 1;
        return chamadas === 1 ? { kind: "hang" } : { kind: "result", result: { exitCode: 0 } };
      },
    });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    expect(h.store.step("slow").attempt).toBe(2);
    expect(h.store.transitionsFor("slow").map((t) => t.to)).toEqual([
      "RUNNING",
      "PENDING",
      "RUNNING",
      "SUCCEEDED",
    ]);
  });

  it("um step de agente com timeoutMs passa o teto ao runtime e assenta TIMED_OUT", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Agente lento",
      steps: [{ type: "agent", key: "slow-agent", name: "A", prompt: "x", timeoutMs: 1234 }],
    });
    const h = montar({ definition, scripts: { "slow-agent": [{ kind: "timeout" }] } });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    expect(h.agent.requests[0]?.timeoutMs).toBe(1234);
    expect(h.store.step("slow-agent").status).toBe("TIMED_OUT");
  });

  it("sem timeoutMs próprio, um comando usa o teto padrão do Worker", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Sem teto",
      steps: [{ type: "command", key: "cmd", name: "C", argv: ["x"] }],
    });
    const h = montar({ definition, command: () => ({ kind: "hang" }) });

    const outcome = await h.run({ defaultStepTimeoutMs: 30 });
    expect(outcome.kind).toBe("settled");
    expect(h.store.step("cmd").status).toBe("TIMED_OUT");
  });
});

describe("predicados e validação", () => {
  it("um predicado que o motor não conhece é fail-closed: pula com o motivo", async () => {
    const definition = {
      name: "Predicado torto",
      steps: [
        { type: "command", key: "first", name: "Primeiro", dependsOn: [], argv: ["x"] },
        {
          type: "command",
          key: "second",
          name: "Segundo",
          dependsOn: ["first"],
          argv: ["y"],
          // Uma versão congelada por um schema antigo: o tipo não existe hoje.
          when: [{ kind: "sempreVerdadeiro" }],
        },
      ],
    } as unknown as WorkflowDefinition;
    const h = montar({ definition });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    expect(h.store.step("second").status).toBe("SKIPPED");
    expect(h.store.step("second").error?.message).toContain("Predicado desconhecido");
    // O motivo tipado vai em `details`, que é o que a interface lê.
    expect(h.store.step("second").error?.details).toMatchObject({
      code: "PREDICATE_FALSE",
      predicate: { kind: "sempreVerdadeiro" },
    });
    expect(h.commands.requests.map((request) => request.argv[0])).toEqual(["x"]);
  });

  it("uma validação reprovada não derruba o Run; o dependente com validationPassed é pulado", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Validação",
      steps: [
        { type: "validation", key: "check", name: "Conferir", argv: ["check"] },
        {
          type: "command",
          key: "publish",
          name: "Publicar",
          dependsOn: ["check"],
          when: [{ kind: "validationPassed", step: "check" }],
          argv: ["publish"],
        },
        {
          type: "command",
          key: "cleanup",
          name: "Limpar",
          dependsOn: ["check"],
          when: [{ kind: "stepSucceeded", step: "check" }],
          argv: ["cleanup"],
        },
      ],
    });
    const h = montar({
      definition,
      command: (argv) => ({
        kind: "result",
        result: { exitCode: argv[0] === "check" ? 3 : 0, stderrTail: "lint falhou" },
      }),
    });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    expect(statusesOf(outcome.steps)).toEqual({
      check: "SUCCEEDED",
      publish: "SKIPPED",
      cleanup: "SUCCEEDED",
    });
    const check = h.store.step("check");
    expect(check.result).toMatchObject({ kind: "validation", verdict: "failed", exitCode: 3 });
    expect(outcome.result.warnings?.some((w) => w.includes("reprovou"))).toBe(true);
  });

  it("artifactExists consulta a sonda do checkout", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Artefato",
      steps: [
        { type: "command", key: "gen", name: "Gerar", argv: ["gen"] },
        {
          type: "command",
          key: "use",
          name: "Usar",
          dependsOn: ["gen"],
          when: [{ kind: "artifactExists", path: "out/report.md" }],
          argv: ["use"],
        },
      ],
    });
    const h = montar({ definition });
    const perguntas: string[] = [];

    const outcome = await h.run({
      artifactExists: (path) => {
        perguntas.push(path);
        return true;
      },
    });
    expect(outcome.kind).toBe("settled");
    expect(perguntas).toEqual(["out/report.md"]);
    expect(h.store.step("use").status).toBe("SUCCEEDED");
  });

  it("o step knowledge consolida os candidatos dos agentes anteriores", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Conhecimento",
      steps: [
        { type: "agent", key: "first", name: "A", prompt: "a" },
        { type: "agent", key: "second", name: "B", dependsOn: ["first"], prompt: "b" },
        { type: "knowledge", key: "collect", name: "K", dependsOn: ["second"], mode: "collect" },
      ],
    });
    const h = montar({
      definition,
      scripts: {
        first: [
          completed("a", {
            output: {
              status: "completed",
              knowledgeCandidates: [{ title: "T1", content: "C1" }],
              discoveredTasks: [{ title: "D1" }],
            },
          }),
        ],
        second: [
          completed("b", {
            output: {
              status: "completed",
              knowledgeCandidates: [{ title: "T2", content: "C2", kind: "gotcha" }],
              discoveredTasks: [{ title: "D2", description: "Depois de D1." }],
            },
          }),
        ],
      },
    });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(h.store.step("collect").result).toEqual({
      kind: "knowledge",
      candidates: [
        { title: "T1", content: "C1" },
        { title: "T2", content: "C2", kind: "gotcha" },
      ],
    });
    expect(outcome.result["knowledgeCandidates"]).toHaveLength(2);
    // As propostas dos dois agentes, na ordem topológica: é daqui que a
    // escrita terminal grava as ProposedTasks do Run com Workflow.
    expect(outcome.result["discoveredTasks"]).toEqual([
      { title: "D1" },
      { title: "D2", description: "Depois de D1." },
    ]);
  });
});

describe("cancelamento", () => {
  it("entre passos: a marca no banco cancela os restantes sem rodar mais nada", async () => {
    const h = montar({
      scripts: {
        analyze: [completed("a")],
        plan: [completed("p")],
      },
    });
    // O agente de analyze termina e, antes do próximo passo, o usuário cancela.
    const original = h.agent.execute.bind(h.agent);
    h.agent.execute = (request) => {
      if (request.stepKey === "analyze") h.store.cancelRequested = true;
      return original(request);
    };

    const outcome = await h.run();

    expect(outcome.kind).toBe("cancelled");
    if (outcome.kind !== "cancelled") return;
    expect(outcome.processTreeTerminated).toBe(true);
    expect(statusesOf(outcome.steps)).toEqual({
      analyze: "SUCCEEDED",
      plan: "CANCELLED",
      "approve-plan": "CANCELLED",
      execute: "CANCELLED",
      validate: "CANCELLED",
    });
    expect(h.agent.executionsOf("plan")).toBe(0);
  });

  it("durante um passo: o sinal mata o comando e o passo termina CANCELLED", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Cancelável",
      steps: [
        { type: "command", key: "long", name: "Longo", argv: ["long"] },
        { type: "command", key: "after", name: "Depois", dependsOn: ["long"], argv: ["after"] },
      ],
    });
    const controller = new AbortController();
    const h = montar({
      definition,
      command: () => {
        setTimeout(() => controller.abort(), 20);
        return { kind: "hang" };
      },
    });

    const outcome = await h.run({ signal: controller.signal });

    expect(outcome.kind).toBe("cancelled");
    if (outcome.kind !== "cancelled") return;
    expect(outcome.processTreeTerminated).toBe(true);
    expect(outcome.terminationMethod).toBe("fake-kill");
    expect(h.commands.terminations).toBe(1);
    expect(statusesOf(outcome.steps)).toEqual({ long: "CANCELLED", after: "CANCELLED" });
    const finished = h.store.events.find(
      (event) => event.type === "StepFinished" && event.stepKey === "long",
    );
    expect(finished).toMatchObject({ status: "CANCELLED" });
  });

  it("durante um passo de agente: o runtime devolve RunCancelled e o Run termina cancelado", async () => {
    const controller = new AbortController();
    const h = montar({
      scripts: { analyze: [{ kind: "hang" }] },
    });
    setTimeout(() => controller.abort(), 20);

    const outcome = await h.run({ signal: controller.signal });
    expect(outcome.kind).toBe("cancelled");
    if (outcome.kind !== "cancelled") return;
    expect(outcome.reason).toBe("AbortSignal");
    expect(h.store.step("analyze").status).toBe("CANCELLED");
    expect(h.store.step("plan").status).toBe("CANCELLED");
  });
});

describe("tentativa perdida", () => {
  const comRetry: WorkflowDefinition = WorkflowDefinitionSchema.parse({
    name: "Perdido",
    steps: [
      { type: "agent", key: "work", name: "Trabalhar", prompt: "x", retry: { maxAttempts: 2 } },
      { type: "agent", key: "single", name: "Único", dependsOn: ["work"], prompt: "y" },
    ],
  });

  it("um passo em RUNNING sem processo vivo retenta quando ainda há tentativa", async () => {
    const h = montar({
      definition: comRetry,
      scripts: { work: [completed("de novo")], single: [completed("ok")] },
    });
    // O Worker anterior morreu no meio da primeira tentativa.
    h.store.seedStep("work", { status: "RUNNING", attempt: 1 });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    expect(h.store.step("work").attempt).toBe(2);
    expect(h.agent.executionsOf("work")).toBe(1);
    const aviso = h.store.events.find(
      (event) => event.type === "Diagnostic" && event.message.includes("terminou sem gravar"),
    );
    expect(aviso).toBeDefined();
  });

  it("sem tentativa restante, o passo perdido assenta FAILED com erro claro", async () => {
    const h = montar({ definition: comRetry, scripts: {} });
    h.store.seedStep("work", { status: "SUCCEEDED", attempt: 1 });
    h.store.seedStep("single", { status: "RUNNING", attempt: 1 });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    const single = h.store.step("single");
    expect(single.status).toBe("FAILED");
    expect(single.error?.code).toBe("STEP_ATTEMPT_LOST");
    expect(single.error?.message).toContain("Não há mais tentativas");
    expect(h.agent.executionsOf("single")).toBe(0);
  });
});

describe("definição inválida", () => {
  it("uma versão sem ordem topológica não roda nada e falha o Run", async () => {
    const definition = {
      name: "Ciclo",
      steps: [
        { type: "command", key: "aa", name: "A", dependsOn: ["bb"], argv: ["a"] },
        { type: "command", key: "bb", name: "B", dependsOn: ["aa"], argv: ["b"] },
      ] as WorkflowStepDefinition[],
    };
    const h = montar({ definition: definition as WorkflowDefinition });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe("WORKFLOW_DEFINITION_INVALID");
    expect(statusesOf(outcome.steps)).toEqual({ aa: "CANCELLED", bb: "CANCELLED" });
    expect(h.commands.requests).toHaveLength(0);
  });
});

describe("permissão negada no agente", () => {
  it("negação mais trabalho inacabado reprova o passo com PERMISSION_DENIED", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Negado",
      steps: [{ type: "agent", key: "agent", name: "A", prompt: "x" }],
    });
    const h = montar({
      definition,
      scripts: {
        agent: [
          {
            kind: "completed",
            output: { status: "blocked", summary: "não consegui commitar" },
            diagnostics: [
              {
                code: "PERMISSION_DENIED",
                message: "Permissão negada para Bash(git commit): ninguém aprova",
              },
            ],
          },
        ],
      },
    });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("FAILED");
    const step = h.store.step("agent");
    expect(step.status).toBe("FAILED");
    expect(step.error?.code).toBe("PERMISSION_DENIED");
    expect(step.error?.["deniedTools"]).toEqual(["Bash(git commit)"]);
    expect(step.result).toMatchObject({ kind: "agent", status: "blocked" });
  });

  it("sem o bloco <result>, o desfecho é sintetizado e o aviso fica no diário", async () => {
    const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse({
      name: "Sintetizado",
      steps: [{ type: "agent", key: "agent", name: "A", prompt: "x" }],
    });
    const h = montar({
      definition,
      scripts: { agent: [{ kind: "completed", summary: "Terminei sem bloco." }] },
    });

    const outcome = await h.run();
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result.summary).toBe("Terminei sem bloco.");
    expect(
      h.store.events.some(
        (event) => event.type === "Diagnostic" && event.message.includes("sintetizado"),
      ),
    ).toBe(true);
  });
});
