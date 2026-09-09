/**
 * O harness falso: um `HarnessAdapter` real movido por um script Node.
 *
 * "Falso" é só o modelo. Tudo o mais é verdade: um processo separado, spawn sem
 * shell, stdout NDJSON lido linha a linha, PID, kill de árvore com confirmação
 * por polling. É essa fidelidade que faz dele um teste útil — um duplo em
 * memória provaria a tradução de eventos e nada do que costuma quebrar, que é
 * exatamente processo, sinal e encerramento.
 *
 * Ele também produz o que uma CLI de verdade não produz sob encomenda: silêncio
 * absoluto (timeout ocioso), recusa a `SIGTERM` (escalada para `SIGKILL`) e um
 * neto vivo (prova de que o kill é de árvore).
 */

import { fileURLToPath } from "node:url";

import type { UsageSummary } from "@dungeon-master/contracts";

import { capabilities, type HarnessCapabilities } from "../capabilities.js";
import type {
  HarnessAdapter,
  HarnessContext,
  HarnessExecutionRequest,
  PreflightResult,
} from "../harness.js";
import { PERMISSION_DENIED_DIAGNOSTIC_CODE } from "../harness.js";
import { createHostAdapter, type HarnessSignal, type HostCommand } from "../host-adapter.js";
import type { McpServerSpec } from "../mcp.js";

/** Marcador que o runtime põe no prompt da retentativa de resultado estruturado. */
const RETRY_MARKER = "Sua resposta anterior não produziu";

export const FAKE_AGENT_SCRIPT = fileURLToPath(
  new URL("./fixtures/fake-agent.mjs", import.meta.url),
);

export interface FakeHarnessOptions {
  /** Id do adapter. Padrão: `fake@host`. */
  readonly id?: string;
  /** Sobrescreve a matriz. O padrão liga tudo que o falso realmente faz. */
  readonly capabilities?: Partial<HarnessCapabilities>;
  /** Versão devolvida pelo preflight. Padrão: `0.0.0-fake`. */
  readonly version?: string;
  /** Faz o preflight reprovar, para exercitar o caminho de CLI ausente. */
  readonly preflightProblem?: { readonly code: "NOT_INSTALLED"; readonly message: string };
  /**
   * O que o preflight responde sobre a credencial (Fase 8B). Ausente, o falso
   * não sabe dizer — como uma CLI sem checagem barata.
   */
  readonly authenticated?: boolean;
  /**
   * Roteiro usado quando o prompt é o da retentativa de resultado estruturado.
   *
   * O prompt da retentativa é gerado pelo runtime e não carrega diretivas; sem
   * isto, o falso não teria como se comportar diferente na segunda tentativa.
   */
  readonly retryScript?: string;
  /**
   * Observa cada pedido que chega ao adapter, já resolvido pelo runtime.
   *
   * É como um teste prova o que o runtime entregou — o ambiente por allow-list,
   * os servidores MCP, o prompt com a instrução — sem ler o argv do processo.
   */
  readonly onRequest?: (request: HarnessExecutionRequest) => void;
}

const DEFAULT_CAPABILITIES = capabilities({
  streaming: true,
  structuredOutput: true,
  resume: true,
  forkSession: true,
  toolEvents: true,
  tokenUsage: true,
  modelSelection: true,
  hostExecution: true,
  // O agente falso fala MCP de verdade com a diretiva `@@fake:mcp`: a
  // configuração vai no argv como no Claude Code, e o servidor é subido e
  // chamado pelo protocolo. Provado pelo caso `usesMcpServer` da suíte.
  mcpServers: true,
});

/**
 * A configuração de MCP que o agente falso recebe: a mesma forma do
 * `--mcp-config` do Claude Code, para que a diretiva `mcp` do roteiro a leia
 * como uma CLI de verdade leria.
 */
export function fakeMcpConfig(servers: readonly McpServerSpec[]): string {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    mcpServers[server.name] =
      server.transport === "STDIO"
        ? { type: "stdio", command: server.command, args: [...server.args] }
        : { type: "http", url: server.url };
  }
  return JSON.stringify({ mcpServers });
}

/** Um adapter completo, sem CLI instalada e sem rede. */
export function fakeHarness(options: FakeHarnessOptions = {}): HarnessAdapter {
  const version = options.version ?? "0.0.0-fake";

  return createHostAdapter({
    id: options.id ?? "fake@host",
    // O falso se apresenta como Claude Code porque `HarnessKey` é fechado e
    // inventar um valor de teste no enum de domínio o deixaria visível em
    // produção. A suíte de contrato não olha a chave.
    key: "CLAUDE_CODE",
    capabilities: { ...DEFAULT_CAPABILITIES, ...options.capabilities },
    environmentKeys: ["DM_FAKE_HARNESS_EXTRA"],

    preflight: (_context: HarnessContext): Promise<PreflightResult> =>
      Promise.resolve(
        options.preflightProblem === undefined
          ? {
              installed: true,
              version,
              executablePath: FAKE_AGENT_SCRIPT,
              ...(options.authenticated === undefined
                ? {}
                : {
                    authenticated: options.authenticated,
                    authReason: `o harness falso foi configurado como ${
                      options.authenticated ? "autenticado" : "não autenticado"
                    }`,
                  }),
              problems: [],
            }
          : {
              installed: false,
              problems: [{ ...options.preflightProblem, fatal: true }],
            },
      ),

    buildCommand: (request): HostCommand => {
      options.onRequest?.(request);

      const args = [FAKE_AGENT_SCRIPT];
      if (request.model !== undefined) args.push("--model", request.model.id);
      if (request.resume !== undefined) args.push("--session", request.resume.harnessSessionId);
      if (request.permission.mode === "BYPASS") args.push("--dangerous");
      if (request.mcpServers !== undefined && request.mcpServers.length > 0) {
        args.push("--mcp-config", fakeMcpConfig(request.mcpServers));
      }
      if (request.extraArgs !== undefined) args.push(...request.extraArgs);

      const prompt =
        options.retryScript !== undefined && request.prompt.includes(RETRY_MARKER)
          ? `${options.retryScript}\n${request.prompt}`
          : request.prompt;

      // `process.execPath` e não `node`: o agente falso precisa rodar no mesmo
      // Node do worker, e um `node` do PATH pode ser outro.
      return { command: process.execPath, args, stdin: prompt };
    },

    parseLine: parseFakeLine,

    describeExit: (exitCode, stderrTail) => ({
      message: `O agente falso saiu com código ${String(exitCode)}. ${stderrTail.trim()}`.trim(),
      retryable: false,
    }),
  });
}

/** Traduz o NDJSON do agente falso. Pura, e por isso testável linha a linha. */
export function parseFakeLine(line: string): readonly HarnessSignal[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;

  switch (obj["type"]) {
    case "session":
      return typeof obj["id"] === "string" ? [{ kind: "session", id: obj["id"] }] : [];
    case "text":
      return typeof obj["text"] === "string" ? [{ kind: "text", text: obj["text"] }] : [];
    case "result":
      return typeof obj["text"] === "string" ? [{ kind: "result", text: obj["text"] }] : [];
    case "tool_call":
      return typeof obj["name"] === "string"
        ? [
            {
              kind: "tool_call",
              ...(typeof obj["id"] === "string" ? { id: obj["id"] } : {}),
              name: obj["name"],
              args: typeof obj["args"] === "string" ? obj["args"] : "",
            },
          ]
        : [];
    case "tool_result":
      return [
        {
          kind: "tool_result",
          ...(typeof obj["id"] === "string" ? { id: obj["id"] } : {}),
          ...(typeof obj["name"] === "string" ? { name: obj["name"] } : {}),
          ok: obj["ok"] !== false,
          output: typeof obj["output"] === "string" ? obj["output"] : "",
        },
      ];
    case "usage": {
      const usage: UsageSummary = {
        inputTokens: numberOr(obj["inputTokens"], 0),
        outputTokens: numberOr(obj["outputTokens"], 0),
        cacheReadInputTokens: numberOr(obj["cacheReadInputTokens"], 0),
        cacheCreationInputTokens: numberOr(obj["cacheCreationInputTokens"], 0),
      };
      return [{ kind: "usage", usage }];
    }
    case "permission_denied": {
      // A mesma forma que os adapters reais produzem: diagnóstico com código
      // estável, e nada de erro. Quem decide se a negação foi fatal é o Worker,
      // no fim, olhando se o agente entregou o trabalho.
      const tool = typeof obj["tool"] === "string" ? obj["tool"] : "uma ferramenta";
      return [
        {
          kind: "diagnostic",
          level: "WARN",
          code: PERMISSION_DENIED_DIAGNOSTIC_CODE,
          message: `Permissão negada para ${tool}: não há quem aprove nesta sessão`,
          detail: "Libere a ferramenta no ExecutionProfile ou ligue `allowUnsafeBypass`.",
        },
      ];
    }
    case "error":
      return typeof obj["message"] === "string"
        ? [{ kind: "error", message: obj["message"], retryable: false }]
        : [];
    default:
      return [];
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
