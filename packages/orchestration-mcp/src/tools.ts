import { isTerminalRunStatus } from "@dungeon-master/domain";
import { z } from "zod";

import {
  AWAIT_DEFAULT_TIMEOUT_MS,
  AWAIT_MAX_TIMEOUT_MS,
  AWAIT_POLL_INTERVAL_MS,
  formatChildOutcome,
  formatDelegated,
  formatLoadouts,
  formatNotFound,
  LOADOUT_REF_MAX_CHARS,
  PROMPT_MAX_CHARS,
} from "./format.js";
import type { OrchestrationToolStore } from "./store.js";

/**
 * As três ferramentas de delegação, como funções puras sobre a porta.
 *
 * O servidor MCP (`server.ts`) as registra; os testes de unidade as chamam
 * direto, com o store em memória. A validação dos argumentos acontece aqui,
 * com os mesmos schemas que o servidor publica.
 */

/** Nome canônico do servidor. É o prefixo que o agente vê: `mcp__orchestration__…`. */
export const ORCHESTRATION_MCP_SERVER_NAME = "orchestration" as const;

export const ORCHESTRATION_TOOL_NAMES = ["list_loadouts", "delegate_task", "await_run"] as const;

export type OrchestrationToolName = (typeof ORCHESTRATION_TOOL_NAMES)[number];

export const ORCHESTRATION_TOOL_INPUTS = {
  list_loadouts: {},
  delegate_task: {
    loadout: z
      .string()
      .trim()
      .min(1)
      .max(LOADOUT_REF_MAX_CHARS)
      .describe("O Loadout do Run filho: o nome exato, ou o id, como em list_loadouts."),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(PROMPT_MAX_CHARS)
      .describe(
        "O pedido completo e autocontido para o filho. Ele não vê a sua conversa: tudo o que " +
          "precisa saber vai aqui.",
      ),
    taskStrategy: z
      .enum(["SAME", "CHILD"])
      .optional()
      .describe(
        "`SAME` (padrão) roda o filho na mesma Task deste Run; `CHILD` cria uma Task filha para ele.",
      ),
  },
  await_run: {
    runId: z.uuid().describe("O id do Run filho, como veio de delegate_task."),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(AWAIT_MAX_TIMEOUT_MS)
      .optional()
      .describe(
        `Quanto esperar, em milissegundos. Padrão ${String(AWAIT_DEFAULT_TIMEOUT_MS)}; ` +
          `máximo ${String(AWAIT_MAX_TIMEOUT_MS)}. Chame de novo se o filho ainda não terminou.`,
      ),
  },
} as const;

export const ORCHESTRATION_TOOL_DESCRIPTIONS: Readonly<Record<OrchestrationToolName, string>> = {
  list_loadouts:
    "Lista os Loadouts (agente + harness + perfil) a que este Run pode delegar trabalho, com nome e id.",
  delegate_task:
    "Abre um Run filho com outro Loadout para fazer um pedido seu, e devolve o id do filho. " +
    "O filho roda de verdade neste Project, conta no orçamento deste Run e obedece aos mesmos " +
    "disjuntores e políticas. Use await_run para esperar o desfecho.",
  await_run:
    "Espera um Run filho aberto por delegate_task terminar e devolve o estado, o veredito e o " +
    "resumo dele. Se o tempo de espera acabar antes, devolve o estado atual; chame de novo.",
};

export interface ToolText {
  readonly text: string;
  /** `true` quando os argumentos foram recusados ou a delegação foi negada. */
  readonly isError?: boolean;
}

export interface OrchestrationTools {
  listLoadouts(): Promise<ToolText>;
  delegateTask(input: {
    readonly loadout: string;
    readonly prompt: string;
    readonly taskStrategy?: "SAME" | "CHILD" | undefined;
  }): Promise<ToolText>;
  awaitRun(input: {
    readonly runId: string;
    readonly timeoutMs?: number | undefined;
  }): Promise<ToolText>;
}

const DelegateSchema = z.object(ORCHESTRATION_TOOL_INPUTS.delegate_task);
const AwaitSchema = z.object(ORCHESTRATION_TOOL_INPUTS.await_run);

function rejected(error: z.ZodError): ToolText {
  const motivos = error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "argumentos"}: ${issue.message}`)
    .join("; ");
  return { text: `Argumentos inválidos — ${motivos}.`, isError: true };
}

export interface CreateOrchestrationToolsOptions {
  /** O relógio e a espera, injetáveis para os testes não dormirem de verdade. */
  readonly now?: (() => number) | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly pollIntervalMs?: number | undefined;
}

export function createOrchestrationTools(
  store: OrchestrationToolStore,
  options: CreateOrchestrationToolsOptions = {},
): OrchestrationTools {
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = options.pollIntervalMs ?? AWAIT_POLL_INTERVAL_MS;

  return {
    async listLoadouts() {
      return { text: formatLoadouts(await store.listLoadouts()) };
    },

    async delegateTask(input) {
      const parsed = DelegateSchema.safeParse(input);
      if (!parsed.success) return rejected(parsed.error);
      const outcome = await store.delegate({
        loadoutRef: parsed.data.loadout,
        prompt: parsed.data.prompt,
        taskStrategy: parsed.data.taskStrategy ?? "SAME",
      });
      if (!outcome.ok) {
        return { text: `Delegação recusada (${outcome.code}): ${outcome.reason}`, isError: true };
      }
      return { text: formatDelegated(outcome.child) };
    },

    async awaitRun(input) {
      const parsed = AwaitSchema.safeParse(input);
      if (!parsed.success) return rejected(parsed.error);
      const limite = now() + (parsed.data.timeoutMs ?? AWAIT_DEFAULT_TIMEOUT_MS);

      for (;;) {
        const child = await store.getChild(parsed.data.runId);
        if (child === null) return { text: formatNotFound(parsed.data.runId), isError: true };
        if (isTerminalRunStatus(child.status)) return { text: formatChildOutcome(child, false) };
        if (now() >= limite) return { text: formatChildOutcome(child, true) };
        await sleep(Math.min(pollIntervalMs, Math.max(1, limite - now())));
      }
    },
  };
}
