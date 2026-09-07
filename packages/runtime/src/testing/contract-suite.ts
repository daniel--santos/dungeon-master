/**
 * A suíte de contrato de harness (planejamento v0.4, Fase 3E).
 *
 * Onze casos semânticos que todo harness precisa cumprir, rodados sobre o
 * `AgentRuntime` de verdade — e não sobre o adapter isolado. Testar o adapter
 * sozinho provaria a tradução de eventos; o que quebra na prática é a costura:
 * o processo que não morre, o timeout que não distingue silêncio de teto, o
 * bloco `<result>` que só aparece na linha final do Codex.
 *
 * A suíte roda **sempre** com o harness falso, em qualquer máquina. Com Claude
 * Code, Codex e Pi ela roda só onde a CLI está instalada, com prompts mínimos.
 *
 * Uso:
 *
 * ```ts
 * harnessContractSuite({
 *   name: "harness falso",
 *   createAdapter: () => fakeHarness(),
 *   prompts: { echo: "@@fake:text OK" },
 * });
 * ```
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionEvent } from "@dungeon-master/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createAgentRuntime, type AgentRuntime } from "../agent-runtime.js";
import type { ExecutionRequest } from "../execution-request.js";
import type { HarnessAdapter } from "../harness.js";
import { createHarnessRegistry } from "../registry.js";
import type { ExecutionProfileSnapshot, ModelRef } from "../types.js";
import { createWorkspaceManager } from "../workspace.js";
import { createWorkspaceResolver } from "../workspace-resolver.js";

/** Os onze casos, na ordem em que a Fase 3E os lista. */
export const HARNESS_CONTRACT_CASES = [
  "canRunPrompt",
  "emitsText",
  "emitsToolEvents",
  "returnsFinalResult",
  "returnsStructuredOutput",
  "handlesFailure",
  "canCancel",
  "supportsTimeout",
  "capturesSessionId",
  "reportsVersion",
  "reportsCapabilities",
] as const;

export type HarnessContractCase = (typeof HARNESS_CONTRACT_CASES)[number];

export interface ContractPrompts {
  /** Um prompt barato que produz texto curto e nenhuma ferramenta. */
  readonly echo: string;
  /** Um prompt que obriga uma chamada de ferramenta. */
  readonly tool: string;
  /** Um prompt cujo resultado estruturado é `{ answer: "ok" }`. */
  readonly structured: string;
  /** Um prompt longo o bastante para ser cancelado no meio. */
  readonly slow: string;
}

const DEFAULT_PROMPTS: ContractPrompts = {
  echo: "Responda apenas com a palavra OK, sem usar nenhuma ferramenta.",
  tool: "Use sua ferramenta de shell para executar `git --version` e depois responda apenas OK.",
  structured: 'Responda com o campo answer valendo exatamente "ok".',
  slow: "Conte de 1 até 300, escrevendo um número por linha, sem usar ferramentas.",
};

export interface HarnessContractSuiteOptions {
  /** Nome que aparece no `describe`. */
  readonly name: string;
  createAdapter(): HarnessAdapter | Promise<HarnessAdapter>;
  /**
   * Roda a suíte? Padrão: `true`.
   *
   * É por aqui que os adapters reais somem no CI e nas máquinas sem a CLI
   * instalada, sem que a suíte precise saber o que é uma CLI.
   */
  readonly enabled?: boolean;
  readonly model?: ModelRef;
  readonly prompts?: Partial<ContractPrompts>;
  /** Casos pulados, com o motivo. Aparece no nome do teste. */
  readonly skip?: Partial<Record<HarnessContractCase, string>>;
  /** Teto de tempo de cada caso. Padrão: 120 s. */
  readonly caseTimeoutMs?: number;
  /** Teto de conclusão de um Run normal. Padrão: 110 s. */
  readonly completionMs?: number;
  /** Quando cancelar, no caso `canCancel`. Padrão: 2000 ms. */
  readonly cancelAfterMs?: number;
  /**
   * Como forçar uma falha do harness. O padrão é um modelo inexistente, que
   * faz toda CLI sair com código diferente de zero sem gastar token.
   */
  readonly failure?: { readonly model?: ModelRef; readonly prompt?: string };
}

const OutputSchema = z.object({ answer: z.string() });

/** Registra o `describe` com os onze casos. */
export function harnessContractSuite(options: HarnessContractSuiteOptions): void {
  const prompts = { ...DEFAULT_PROMPTS, ...options.prompts };
  const caseTimeout = options.caseTimeoutMs ?? 120_000;
  const completionMs = options.completionMs ?? 110_000;
  const cancelAfterMs = options.cancelAfterMs ?? 2_000;

  describe.skipIf(options.enabled === false)(`contrato de harness: ${options.name}`, () => {
    let adapter: HarnessAdapter;
    let runtime: AgentRuntime;
    let workdir: string;
    let runSeq = 0;

    const nextRunId = (label: string): string => {
      runSeq += 1;
      return `contract-${label}-${String(runSeq)}`;
    };

    const profile: ExecutionProfileSnapshot = {
      mode: "HOST",
      workspaceStrategy: "CURRENT",
      permissionPolicy: { mode: "DEFAULT" },
    };

    const buildRequest = (
      label: string,
      overrides: Partial<ExecutionRequest> = {},
    ): ExecutionRequest => ({
      runId: nextRunId(label),
      taskId: "contract-task",
      workspace: { repoPath: workdir },
      harness: { key: adapter.key },
      ...(options.model === undefined ? {} : { model: options.model }),
      loadout: { harness: { key: adapter.key } },
      executionProfile: profile,
      prompt: prompts.echo,
      timeouts: { completionMs, idleMs: Math.min(completionMs, 120_000) },
      ...overrides,
    });

    const collect = async (request: ExecutionRequest): Promise<ExecutionEvent[]> => {
      const events: ExecutionEvent[] = [];
      for await (const event of runtime.execute(request)) events.push(event);
      return events;
    };

    beforeAll(async () => {
      adapter = await options.createAdapter();
      workdir = await mkdtemp(join(tmpdir(), "dm-contract-"));
      runtime = createAgentRuntime({
        registry: createHarnessRegistry([adapter]),
        workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
      });
    }, caseTimeout);

    afterAll(async () => {
      // Um diretório temporário que sobrou não é falha de contrato. No Windows
      // o handle de um processo recém-morto ainda segura o `cwd` por alguns
      // instantes, e o `rmdir` volta `EBUSY`; as retentativas do `fs.rm` cobrem
      // a janela, e o `catch` cobre o resto.
      if (workdir === undefined) return;
      await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
        () => undefined,
      );
    });

    // --------------------------------------------------------- corrida única
    // `canRunPrompt`, `emitsText`, `returnsFinalResult` e `capturesSessionId`
    // olham o mesmo Run: são quatro perguntas sobre a mesma execução, e gastar
    // quatro chamadas de modelo para respondê-las seria desperdício.
    describe("um prompt simples", () => {
      let events: ExecutionEvent[] = [];

      beforeAll(async () => {
        if (allSkipped(options.skip, ["canRunPrompt", "emitsText", "returnsFinalResult"])) return;
        events = await collect(buildRequest("echo"));
      }, caseTimeout);

      testCase(options, "canRunPrompt", "roda um prompt e termina em evento terminal", () => {
        expect(events.at(0)?.type).toBe("RunStarted");
        const last = events.at(-1);
        expect(last?.type, describeEvents(events)).toBe("RunCompleted");
      });

      testCase(options, "emitsText", "emite pelo menos um TextDelta", () => {
        const deltas = events.filter((event) => event.type === "TextDelta");
        expect(deltas.length, describeEvents(events)).toBeGreaterThan(0);
        expect(deltas.some((event) => event.text.trim().length > 0)).toBe(true);
      });

      testCase(options, "returnsFinalResult", "entrega o texto final no RunCompleted", () => {
        const completed = events.find((event) => event.type === "RunCompleted");
        expect(completed, describeEvents(events)).toBeDefined();
        expect(completed?.summary.toLowerCase()).toContain("ok");
      });

      testCase(options, "capturesSessionId", "captura o id de sessão do harness", () => {
        if (!adapter.capabilities.resume) {
          expect(adapter.capabilities.resume).toBe(false);
          return;
        }
        const captured = events.find((event) => event.type === "SessionCaptured");
        expect(captured, describeEvents(events)).toBeDefined();
        expect(captured?.harnessSessionId.length).toBeGreaterThan(0);
      });
    });

    testCase(
      options,
      "emitsToolEvents",
      "traduz chamadas de ferramenta",
      async () => {
        if (!adapter.capabilities.toolEvents) {
          expect(adapter.capabilities.toolEvents).toBe(false);
          return;
        }
        const events = await collect(buildRequest("tool", { prompt: prompts.tool }));
        const calls = events.filter((event) => event.type === "ToolCall");
        expect(calls.length, describeEvents(events)).toBeGreaterThan(0);
        expect(calls[0]?.name.length).toBeGreaterThan(0);
      },
      caseTimeout,
    );

    testCase(
      options,
      "returnsStructuredOutput",
      "valida o bloco <result> pelo schema",
      async () => {
        const events = await collect(
          buildRequest("structured", {
            prompt: prompts.structured,
            outputSchema: { schema: OutputSchema, maxRetries: 1 },
          }),
        );
        const completed = events.find((event) => event.type === "RunCompleted");
        expect(completed, describeEvents(events)).toBeDefined();
        const parsed = OutputSchema.safeParse(completed?.output);
        expect(parsed.success, JSON.stringify(completed?.output)).toBe(true);
      },
      caseTimeout,
    );

    testCase(
      options,
      "handlesFailure",
      "vira RunFailed em vez de lançar",
      async () => {
        const events = await collect(
          buildRequest("failure", {
            ...(options.failure?.prompt === undefined ? {} : { prompt: options.failure.prompt }),
            model: options.failure?.model ?? { id: "modelo-inexistente-dm-teste" },
          }),
        );
        const last = events.at(-1);
        expect(last?.type, describeEvents(events)).toBe("RunFailed");
        if (last?.type === "RunFailed") {
          expect(last.error.message.length).toBeGreaterThan(0);
          expect(typeof last.retryable).toBe("boolean");
        }
      },
      caseTimeout,
    );

    testCase(
      options,
      "canCancel",
      "cancela e confirma o término da árvore de processos",
      async () => {
        const request = buildRequest("cancel", { prompt: prompts.slow });
        const events: ExecutionEvent[] = [];
        const consuming = (async () => {
          for await (const event of runtime.execute(request)) events.push(event);
        })();

        await delay(cancelAfterMs);
        await runtime.cancel(request.runId);
        await consuming;

        const last = events.at(-1);
        expect(last?.type, describeEvents(events)).toBe("RunCancelled");
        if (last?.type === "RunCancelled") {
          // A confirmação é a parte que importa: o código de saída de um kill
          // não é prova, e o evento só sai depois do polling.
          expect(last.processTreeTerminated).toBe(true);
        }
      },
      caseTimeout,
    );

    testCase(
      options,
      "supportsTimeout",
      "distingue o timeout ocioso do de conclusão",
      async () => {
        const idle = await collect(
          buildRequest("idle", {
            prompt: prompts.slow,
            // 100 ms é menos que o tempo de subir qualquer CLI: o silêncio
            // inicial é suficiente, e nenhum token é gasto.
            timeouts: { idleMs: 100, completionMs: 60_000 },
          }),
        );
        const idleLast = idle.at(-1);
        expect(idleLast?.type, describeEvents(idle)).toBe("RunTimedOut");
        if (idleLast?.type === "RunTimedOut") {
          expect(idleLast.kind).toBe("IDLE");
          expect(idleLast.processTreeTerminated).toBe(true);
        }

        const completion = await collect(
          buildRequest("completion", {
            prompt: prompts.slow,
            timeouts: { idleMs: 60_000, completionMs: 1_500 },
          }),
        );
        const completionLast = completion.at(-1);
        expect(completionLast?.type, describeEvents(completion)).toBe("RunTimedOut");
        if (completionLast?.type === "RunTimedOut") {
          expect(completionLast.kind).toBe("COMPLETION");
          expect(completionLast.processTreeTerminated).toBe(true);
        }
      },
      caseTimeout,
    );

    testCase(
      options,
      "reportsVersion",
      "o preflight informa instalação e versão",
      async () => {
        const preflight = await adapter.preflight({ mode: "HOST" });
        expect(preflight.installed, JSON.stringify(preflight.problems)).toBe(true);
        expect(preflight.version).toBeTypeOf("string");
        expect((preflight.version ?? "").length).toBeGreaterThan(0);
      },
      caseTimeout,
    );

    testCase(options, "reportsCapabilities", "a matriz de capabilities é completa", () => {
      const keys = [
        "streaming",
        "structuredOutput",
        "resume",
        "forkSession",
        "multiTurnProcess",
        "toolEvents",
        "tokenUsage",
        "modelSelection",
        "agentSelection",
        "nativePermissions",
        "hostExecution",
        "dockerExecution",
      ] as const;
      for (const key of keys) {
        expect(typeof adapter.capabilities[key], `capability ${key}`).toBe("boolean");
      }
      expect(adapter.capabilities.hostExecution).toBe(true);
      expect(adapter.id.length).toBeGreaterThan(0);
    });
  });
}

function testCase(
  options: HarnessContractSuiteOptions,
  name: HarnessContractCase,
  description: string,
  body: () => void | Promise<void>,
  timeoutMs?: number,
): void {
  const reason = options.skip?.[name];
  if (reason !== undefined) {
    it.skip(`${name}: ${description} — pulado: ${reason}`, body);
    return;
  }
  it(`${name}: ${description}`, body, timeoutMs);
}

function allSkipped(
  skip: HarnessContractSuiteOptions["skip"],
  names: readonly HarnessContractCase[],
): boolean {
  return names.every((name) => skip?.[name] !== undefined);
}

/** Resumo do fluxo, usado como mensagem de falha. Sem ele, um teste vermelho não diz nada. */
function describeEvents(events: readonly ExecutionEvent[]): string {
  return events
    .map((event) => {
      if (event.type === "RunFailed") return `RunFailed(${event.error.message})`;
      if (event.type === "Diagnostic") return `Diagnostic(${event.level}: ${event.message})`;
      if (event.type === "RunTimedOut") return `RunTimedOut(${event.kind})`;
      return event.type;
    })
    .join(" → ");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
