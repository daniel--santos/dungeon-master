import type {
  AgentStepDefinition,
  ExecutionEvent,
  RunStepResult,
  TaskExecutionResult,
  UsageSummary,
} from "@dungeon-master/contracts";
import { PERMISSION_DENIED_DIAGNOSTIC_CODE } from "@dungeon-master/runtime";

import { buildStepPrompt, collectStepOutputs } from "../prompt.js";
import type { StepAttemptOutcome, StepExecutor } from "./types.js";

/**
 * O executor de um step `agent`.
 *
 * Uma execução de agente por tentativa, pelo mesmo runtime que o Run simples
 * usa — com o mesmo Loadout, o mesmo perfil e a mesma política de permissão,
 * que o Worker resolve uma vez por Run e traduz na porta `StepAgentRuntime`.
 * O que muda em relação ao Run simples é a tradução dos eventos:
 *
 * - **Os eventos terminais do runtime não entram no log do Run.** Um
 *   `RunCompleted` no meio de um Workflow mentiria para quem lê a timeline —
 *   o contrato de `ExecutionEvent` diz que depois dele nada é emitido. O
 *   desfecho do step vira `StepFinished`, escrito pelo runner.
 * - `RunStarted` vira um `Diagnostic` com a versão do harness e o diretório:
 *   o Run já está em `RUNNING` desde antes do primeiro step, e um segundo
 *   `RunStarted` moveria o relógio da interface.
 * - Todo o resto (`TextDelta`, `ToolCall`, `Usage`, `Artifact`,
 *   `SessionCaptured`, `Diagnostic`) passa como está: é a mesma timeline.
 *
 * O resultado estruturado é o `TaskExecutionResult` de sempre. Sem o bloco
 * `<result>`, o desfecho é sintetizado a partir do texto final e o aviso fica
 * gravado — a mesma rede de segurança do Run simples. E a regra de permissão
 * negada também é a mesma: negação mais trabalho inacabado é falta de
 * permissão, não um step bem-sucedido cujo agente ficou bloqueado.
 */
export const agentStepExecutor: StepExecutor<AgentStepDefinition> = {
  async execute(context): Promise<StepAttemptOutcome> {
    const { run, step, definition, deps } = context;
    const iniciadoEm = deps.now();

    const outputs = collectStepOutputs(
      definition.includeOutputsOf ?? [],
      context.stepsByKey,
      context.definitionsByKey,
    );
    const prompt = buildStepPrompt(definition.prompt, outputs, { taskPrompt: run.prompt });

    let sessionId: string | undefined;
    let usage: UsageSummary | undefined;
    const ferramentasNegadas = new Set<string>();

    const stream = deps.agent.execute({
      executionId: `${run.runId}:${step.key}:${String(step.attempt)}`,
      stepKey: step.key,
      prompt,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
    });

    for await (const event of stream) {
      switch (event.type) {
        case "RunStarted":
          await context.append(
            diagnostic(event, "INFO", {
              message:
                `Passo «${definition.name}» (${step.key}), tentativa ${String(step.attempt)}: ` +
                `${event.harness} ${event.harnessVersion} em ${event.workspacePath} ` +
                `(${event.executionMode}, ${event.enforcement}).`,
            }),
          );
          break;

        case "SessionCaptured":
          sessionId = event.harnessSessionId;
          await context.append(event);
          await deps.store.recordHarnessSession(event.harnessSessionId);
          break;

        case "Usage":
          usage = event.usage;
          await context.append(event);
          break;

        case "Diagnostic":
          if (event.code === PERMISSION_DENIED_DIAGNOSTIC_CODE) {
            ferramentasNegadas.add(describeDeniedTool(event.message));
          }
          await context.append(event);
          break;

        case "RunCompleted": {
          if (event.harnessSessionId !== undefined) sessionId = event.harnessSessionId;
          if (event.usage !== undefined) usage = event.usage;

          let estruturado = event.output as TaskExecutionResult | undefined;
          if (estruturado === undefined) {
            estruturado = {
              status: "completed",
              summary: event.summary.trim().length > 0 ? event.summary : "(sem resumo do agente)",
            };
            await context.append(
              diagnostic(event, "WARN", {
                message:
                  `O agente do passo «${definition.name}» terminou sem o bloco <result>; o ` +
                  "resultado foi sintetizado a partir do texto final e o veredito assumido " +
                  "como `completed`.",
                detail: "Confira o resumo antes de tratar o passo como concluído.",
              }),
            );
          }

          const result: RunStepResult = {
            kind: "agent",
            status: estruturado.status,
            ...(estruturado.summary === undefined ? {} : { summary: estruturado.summary }),
            output: estruturado,
            ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
            ...(estruturado.artifacts === undefined ? {} : { artifacts: estruturado.artifacts }),
            ...(estruturado.knowledgeCandidates === undefined
              ? {}
              : { knowledgeCandidates: estruturado.knowledgeCandidates }),
            ...(usage === undefined ? {} : { usage }),
          };

          if (estruturado.status !== "completed" && ferramentasNegadas.size > 0) {
            const negadas = [...ferramentasNegadas].sort();
            return {
              kind: "failed",
              result,
              error: {
                code: "PERMISSION_DENIED",
                message:
                  `O agente não concluiu o passo e teve permissão negada para: ${negadas.join(", ")}. ` +
                  (estruturado.summary ?? "Sem resumo do agente."),
                retryable: true,
                deniedTools: negadas,
                agentStatus: estruturado.status,
              },
              summary: `Permissão negada para ${negadas.join(", ")}.`,
            };
          }

          return {
            kind: "succeeded",
            result,
            summary: estruturado.summary ?? `Agente reportou ${estruturado.status}.`,
          };
        }

        case "RunFailed":
          if (event.harnessSessionId !== undefined) sessionId = event.harnessSessionId;
          return {
            kind: "failed",
            error: {
              ...(event.error.code === undefined ? {} : { code: event.error.code }),
              message: event.error.message,
              retryable: event.retryable,
              ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
            },
            summary: event.error.message,
          };

        case "RunTimedOut":
          if (event.harnessSessionId !== undefined) sessionId = event.harnessSessionId;
          return {
            kind: "timed_out",
            error: {
              code: `TIMEOUT_${event.kind}`,
              message:
                event.kind === "IDLE"
                  ? `O agente ficou ${String(event.limitMs)} ms sem emitir nada e a tentativa foi encerrada.`
                  : `A tentativa passou do teto de ${String(event.limitMs)} ms e foi encerrada.`,
              retryable: true,
              processTreeTerminated: event.processTreeTerminated,
              elapsedMs: event.elapsedMs,
              ...(sessionId === undefined ? {} : { harnessSessionId: sessionId }),
            },
            summary: `Timeout ${event.kind} após ${String(event.elapsedMs)} ms.`,
          };

        case "RunCancelled":
          return {
            kind: "cancelled",
            reason: event.reason,
            processTreeTerminated: event.processTreeTerminated,
            terminationMethod: event.terminationMethod,
            summary: "Cancelado durante a execução do agente.",
          };

        default:
          await context.append(event);
      }
    }

    // O runtime promete um evento terminal em todo caminho. Chegar aqui é
    // defeito, e o step não pode ficar `RUNNING` por causa dele.
    return {
      kind: "failed",
      error: {
        code: "NO_TERMINAL_EVENT",
        message:
          "O runtime encerrou o fluxo de eventos sem um evento terminal. O desfecho real " +
          "desta tentativa é desconhecido.",
        retryable: true,
        elapsedMs: deps.now() - iniciadoEm,
      },
      summary: "O runtime terminou sem desfecho.",
    };
  },
};

/** Um `Diagnostic` do motor, carimbado com o harness e o instante do evento de origem. */
function diagnostic(
  origem: ExecutionEvent,
  level: "INFO" | "WARN" | "ERROR",
  input: { message: string; detail?: string },
): ExecutionEvent {
  return {
    type: "Diagnostic",
    timestamp: origem.timestamp,
    harness: origem.harness,
    level,
    source: "RUNTIME",
    message: input.message,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  };
}

/**
 * O nome da ferramenta dentro da mensagem de negação.
 *
 * A mesma leitura que o Worker faz no Run simples: a mensagem é montada pelo
 * adapter e começa com "Permissão negada para X:". Quando o formato não casa,
 * o texto inteiro vale como nome.
 */
export function describeDeniedTool(message: string): string {
  return /^Permissão negada para (.+?):/u.exec(message)?.[1] ?? message;
}
