import type {
  ExecutionEvent,
  HarnessCapabilities,
  Run,
  TaskExecutionResult,
} from "@dungeon-master/contracts";
import {
  TaskExecutionResultSchema,
  TASK_EXECUTION_RESULT_INSTRUCTION,
} from "@dungeon-master/contracts";
import {
  appendRunEvent,
  checkBudgetsForRunningRun,
  createApprovalGate,
  findChildRunByStep,
  listCancelRequestedRunIds,
  listRunSteps,
  openDelegation,
  transitionRunStep,
  updateRunExecutionFields,
  type Database,
} from "@dungeon-master/database";
import type { AgentRuntime, ExecutionRequest, McpServerSpec } from "@dungeon-master/runtime";
import type { StepAgentRuntime, WorkflowStore } from "@dungeon-master/workflow";

import { buildPrompt } from "./execute-run.js";
import type { Logger } from "./logger.js";
import type { ResolvedRunPolicies } from "./policy.js";
import { toRunEventInput } from "./run-events.js";
import { normalizeArtifactPath } from "./workspace-outcome.js";

/**
 * A fiação das portas do motor de Workflow com os repositórios reais.
 *
 * `@dungeon-master/workflow` não conhece banco nem Loadout; o que ele pede
 * está em `ports.ts`, e é aqui que cada porta vira uma chamada de
 * `@dungeon-master/database` ou do `AgentRuntime`. O motor fica testável em
 * memória, e o Worker continua sendo o único lugar que conhece os dois lados.
 */

export function createDatabaseWorkflowStore(input: {
  readonly db: Database;
  readonly userId: string;
  readonly run: Run;
  /** O Project do Run: o escopo dos orçamentos re-checados por passo (Fase 9B). */
  readonly projectId: string;
  readonly logger: Logger | undefined;
  /** Chamado quando um step de agente captura a sessão do harness. */
  readonly onHarnessSession: (harnessSessionId: string) => void;
}): WorkflowStore {
  const { db, userId, run, logger } = input;
  const runId = run.id;

  return {
    listRunSteps: () => listRunSteps(db, { userId, runId }),

    transitionRunStep: async (transition) => {
      const moved = await transitionRunStep(db, {
        userId,
        runId,
        stepKey: transition.stepKey,
        from: transition.from,
        to: transition.to,
        ...(transition.incrementAttempt === undefined
          ? {}
          : { incrementAttempt: transition.incrementAttempt }),
        ...(transition.patch === undefined ? {} : { patch: transition.patch }),
      });
      if (moved === null) return { ok: false, code: "RUN_STEP_NOT_FOUND" };
      if (moved.ok) return { ok: true, step: moved.value };
      if (moved.failure.code === "RUN_STEP_STATUS_CHANGED") {
        return { ok: false, code: "RUN_STEP_STATUS_CHANGED", current: moved.failure.current };
      }
      return {
        ok: false,
        code: "RUN_STEP_TRANSITION_REJECTED",
        from: moved.failure.rejection.from,
        to: moved.failure.rejection.to,
      };
    },

    createApprovalGate: async (gate) => {
      const created = await createApprovalGate(db, {
        userId,
        runId,
        stepKey: gate.stepKey,
        gateKey: gate.gateKey,
        title: gate.title,
        description: gate.description ?? null,
      });
      if (created === null) {
        return { ok: false, code: "RUN_NOT_FOUND", detail: `O Run ${runId} não existe.` };
      }
      if (!created.ok) {
        return { ok: false, code: created.failure.code, detail: JSON.stringify(created.failure) };
      }
      return {
        ok: true,
        gate: created.value.gate,
        created: created.value.created,
        policyDecision: created.value.policyDecision,
      };
    },

    openDelegation: async (delegation) => {
      const aberto = await openDelegation(db, {
        userId,
        parentRunId: runId,
        stepKey: delegation.stepKey,
        loadoutRef: delegation.loadoutRef,
        prompt: delegation.prompt,
        taskStrategy: delegation.taskStrategy,
      });
      if (aberto === null) {
        return { ok: false, code: "RUN_NOT_FOUND", detail: `O Run ${runId} não existe.` };
      }
      if (!aberto.ok) {
        return {
          ok: false,
          code: aberto.failure.code,
          detail: describeDelegationFailure(aberto.failure),
        };
      }
      return { ok: true, child: aberto.value.child, created: aberto.value.created };
    },

    findChildRun: (stepKey) =>
      findChildRunByStep(db, { userId, parentRunId: runId, parentStepKey: stepKey }),

    checkStepBudget: async () => {
      const check = await checkBudgetsForRunningRun(db, {
        userId,
        runId,
        projectId: input.projectId,
        loadoutId: run.loadoutId,
      });
      const toBreach = (breach: (typeof check.warnings)[number]) => ({
        budgetId: breach.budgetId,
        name: breach.name,
        action: breach.action,
        reason: breach.reason,
      });
      return {
        blocked: check.blocked === null ? null : toBreach(check.blocked),
        warnings: check.warnings.map(toBreach),
      };
    },

    isCancelRequested: async () => {
      const pedidos = await listCancelRequestedRunIds(db, { userId, runIds: [runId] });
      return pedidos.includes(runId);
    },

    appendEvent: async (event) => {
      await appendRunEvent(db, {
        userId,
        runId,
        event: toRunEventInput(event),
        ...(logger === undefined ? {} : { logger }),
      });
    },

    recordHarnessSession: async (harnessSessionId) => {
      input.onHarnessSession(harnessSessionId);
      try {
        await updateRunExecutionFields(db, { userId, runId, harnessSessionId });
      } catch (error) {
        // Observabilidade: a sessão vai de novo na escrita terminal, e um
        // `UPDATE` perdido aqui não pode derrubar o passo.
        logger?.warn({ err: error, runId }, "não consegui gravar a sessão do harness no Run");
      }
    },
  };
}

/** A frase de uma recusa de delegação, para o erro do passo. */
function describeDelegationFailure(failure: { code: string } & Record<string, unknown>): string {
  switch (failure.code) {
    case "BUDGET_EXCEEDED":
      return (failure["breach"] as { reason: string }).reason;
    case "BREAKER_OPEN":
      return (failure["breaker"] as { reason: string }).reason;
    case "POLICY_DENIED":
    case "POLICY_REQUIRES_APPROVAL":
      return (failure["decision"] as { reason: string }).reason;
    case "DELEGATION_DEPTH_EXCEEDED":
      return (
        `O Run mãe está na profundidade ${String(failure["parentDepth"])} e o teto é ` +
        `${String(failure["maxDepth"])}.`
      );
    case "LOADOUT_REF_NOT_FOUND":
      return `Não há Loadout com o id ou o nome "${String(failure["loadoutRef"])}".`;
    case "CAPABILITY_BLOCKED":
      return (failure["blockers"] as { message: string }[]).map((b) => b.message).join(" ");
    default:
      return JSON.stringify(failure);
  }
}

export interface StepAgentRuntimeInput {
  readonly runtime: AgentRuntime;
  readonly run: Run;
  readonly repoPath: string;
  readonly checkoutPath: string;
  readonly policies: ResolvedRunPolicies;
  /**
   * A matriz que valeu no capability matching (Fase 8B). Ausente, a do
   * snapshot — é o que decide se o passo pede resultado estruturado.
   */
  readonly capabilities?: Pick<HarnessCapabilities, "structuredOutput">;
  readonly defaultTimeouts: { readonly idleMs: number; readonly completionMs: number };
  /** Versão do harness vista no preflight de cada passo. Vai para o Run. */
  readonly onHarnessVersion: (harnessVersion: string) => void;
  /** Caminhos anunciados como `Artifact` pelo harness; o diff do worktree não os repete. */
  readonly knownArtifacts: Set<string>;
  /**
   * Os servidores MCP do Run, montados uma vez e repetidos em todo passo de
   * agente: o Grimório é o mesmo do primeiro ao último passo.
   */
  readonly mcpServers?: readonly McpServerSpec[];
  /**
   * O bloco de contexto do Run (Fase 7), o mesmo em todo passo de agente.
   * Vazio quando o Run segue sem contexto.
   */
  readonly contextText: string;
}

/**
 * O `StepAgentRuntime`: um `ExecutionRequest` por passo, montado como o Run
 * simples monta o dele.
 *
 * O mesmo Loadout, o mesmo perfil, a mesma política de permissão resolvida
 * uma vez por Run; o que muda por passo é o prompt e, quando o step declara
 * `timeoutMs`, o teto. O `runId` do pedido é o do Run — um passo por vez, e é
 * por esse id que `runtime.cancel` alcança o agente em voo. A retomada de
 * sessão entre passos fica de fora de propósito: cada passo recebe no prompt
 * o que precisa dos anteriores, em texto claro.
 */
export function createStepAgentRuntime(input: StepAgentRuntimeInput): StepAgentRuntime {
  const { run, policies } = input;
  const harness = run.harnessKey;
  const model = run.loadoutSnapshot.model;
  const querSchema = (input.capabilities ?? run.loadoutSnapshot.harness.capabilities)
    .structuredOutput;

  return {
    async *execute(request): AsyncIterable<ExecutionEvent> {
      const completionMs = request.timeoutMs ?? input.defaultTimeouts.completionMs;
      const idleMs = Math.min(input.defaultTimeouts.idleMs, completionMs);

      const execution: ExecutionRequest<TaskExecutionResult> = {
        runId: run.id,
        taskId: run.taskId,
        workspace: { repoPath: input.repoPath, checkoutPath: input.checkoutPath },
        harness: { key: harness, id: run.loadoutSnapshot.harness.id },
        ...(model === null ? {} : { model: { id: model.key, name: model.name } }),
        loadout: {
          id: run.loadoutSnapshot.loadoutId,
          name: run.loadoutSnapshot.name,
          harness: { key: harness, id: run.loadoutSnapshot.harness.id },
          ...(model === null ? {} : { model: { id: model.key, name: model.name } }),
          systemPromptAppend: run.loadoutSnapshot.agent.instructions,
        },
        executionProfile: {
          id: run.executionProfileSnapshot.executionProfileId,
          name: run.executionProfileSnapshot.name,
          mode: run.executionProfileSnapshot.mode,
          workspaceStrategy: run.executionProfileSnapshot.workspaceStrategy,
          permissionPolicy: policies.permission,
          environmentPolicy: policies.environment,
        },
        prompt: buildPrompt(
          run.loadoutSnapshot.agent.instructions,
          request.prompt,
          input.contextText,
        ),
        ...(querSchema
          ? {
              outputSchema: {
                schema: TaskExecutionResultSchema,
                instruction: TASK_EXECUTION_RESULT_INSTRUCTION,
              },
            }
          : {}),
        timeouts: { idleMs, completionMs },
        ...(input.mcpServers === undefined || input.mcpServers.length === 0
          ? {}
          : { mcpServers: input.mcpServers }),
        signal: request.signal,
      };

      for await (const event of input.runtime.execute(execution)) {
        if (event.type === "RunStarted") input.onHarnessVersion(event.harnessVersion);
        if (event.type === "Artifact") input.knownArtifacts.add(normalizeArtifactPath(event.path));
        yield event;
      }
    },
  };
}
