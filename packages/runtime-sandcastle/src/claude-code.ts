// Adapted from Sandcastle — src/AgentProvider.ts@e99f832 (provider `claudeCode`
// e `parseStreamJsonLine`)
// Copyright (c) 2026 Matt Pocock. Licensed under the MIT License.
// Changes: o argv deixou de ser uma string de shell montada por concatenação e
// virou array, porque este projeto nunca usa shell (CLAUDE.md, seção 8); o
// parser deixou de descartar as ferramentas fora de uma allow-list de quatro
// nomes e passou a traduzir todas, mais `tool_result`, `permission_denied` e o
// consumo de tokens da linha `result`; `--dangerously-skip-permissions` deixou
// de ser o padrão e passou a exigir política explícita. Verificado contra a CLI
// 2.1.263 em 07/09/2026.

import type { HarnessSignal } from "@dungeon-master/runtime";
import { capabilities } from "@dungeon-master/runtime";
import type { UsageSummary } from "@dungeon-master/contracts";

import {
  createCliHarnessAdapter,
  parseSemverish,
  type CliArgs,
  type CliHarnessDefinition,
} from "./cli-adapter.js";
import {
  asNumber,
  asRecord,
  asString,
  describeToolInput,
  flattenContent,
  parseJsonObject,
} from "./parse-utils.js";

/**
 * Chaves de ambiente que a CLI do Claude precisa enxergar.
 *
 * `HOME`/`USERPROFILE` e `APPDATA` porque é lá que ficam `~/.claude` e as
 * credenciais de OAuth; as `ANTHROPIC_*` e `CLAUDE_*` porque são a outra forma
 * de autenticar. Nada além disso: o restante do ambiente do worker não é
 * assunto do agente.
 */
const CLAUDE_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "SHELL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CONFIG_DIR",
  "AWS_REGION",
  "AWS_PROFILE",
  "CLOUD_ML_REGION",
  "GOOGLE_APPLICATION_CREDENTIALS",
];

export interface ClaudeCodeOptions {
  /** Executável procurado no PATH. Padrão: `claude`. */
  readonly binary?: string;
  /** Esforço de raciocínio, quando a CLI aceitar. */
  readonly effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Argumentos extras fixos do adapter, em array. */
  readonly extraArgs?: readonly string[];
}

export const CLAUDE_CODE_CAPABILITIES = capabilities({
  streaming: true,
  structuredOutput: true,
  resume: true,
  forkSession: true,
  toolEvents: true,
  tokenUsage: true,
  modelSelection: true,
  agentSelection: true,
  nativePermissions: true,
  hostExecution: true,
  // Fase 2C. Prometer aqui antes de existir seria o tipo de suposição que a
  // matriz de capabilities existe para evitar.
  dockerExecution: false,
});

/** Adapter do Claude Code rodando no host. */
export function claudeCode(options: ClaudeCodeOptions = {}) {
  const definition: CliHarnessDefinition = {
    id: "claude-code@host",
    key: "CLAUDE_CODE",
    capabilities: CLAUDE_CODE_CAPABILITIES,
    environmentKeys: CLAUDE_ENV_KEYS,
    binary: options.binary ?? "claude",
    versionArgs: ["--version"],
    installHint: "Instale com `npm i -g @anthropic-ai/claude-code` e autentique com `claude`.",
    parseVersion: (stdout, stderr) => parseSemverish(stdout, stderr),
    parseLine: parseClaudeLine,
    buildArgs: (request): CliArgs => {
      const args = ["--print", "--verbose", "--output-format", "stream-json"];

      if (request.model !== undefined) args.push("--model", request.model.id);
      if (options.effort !== undefined) args.push("--effort", options.effort);

      // `--permission-mode` e `--dangerously-skip-permissions` são mutuamente
      // exclusivos na CLI. O modo padrão não passa nenhum dos dois: vale o
      // padrão da própria ferramenta, que é o mais restritivo.
      if (request.permission.mode === "BYPASS") {
        args.push("--dangerously-skip-permissions");
      } else if (
        request.permission.mode === "CONFIGURED" &&
        request.permission.harnessMode !== undefined
      ) {
        args.push("--permission-mode", request.permission.harnessMode);
      }

      if (request.resume !== undefined) {
        args.push("--resume", request.resume.harnessSessionId);
        if (request.resume.fork === true) args.push("--fork-session");
      }

      if (options.extraArgs !== undefined) args.push(...options.extraArgs);
      if (request.extraArgs !== undefined) args.push(...request.extraArgs);

      // O prompt vai pelo stdin, e não no argv: no Windows a linha de comando
      // inteira tem teto de 32767 caracteres, e um prompt com contexto de
      // projeto passa disso sem esforço.
      return { args, stdin: request.prompt };
    },
    describeExit: (exitCode, stderrTail) => {
      const tail = stderrTail.trim();
      if (tail.length === 0) return undefined;
      return {
        message: `claude saiu com código ${String(exitCode)}: ${tail.slice(0, 500)}`,
        // Autenticação e modelo inválido não melhoram com retentativa; o resto
        // (rede, limite de taxa) melhora. Na dúvida, retentável — o worker tem
        // teto de tentativas e um `false` errado descarta trabalho.
        retryable: !/not (?:logged in|authenticated)|invalid api key|unknown model/i.test(tail),
      };
    },
  };

  return createCliHarnessAdapter(definition);
}

/** Traduz uma linha do `--output-format stream-json` do Claude Code. */
export function parseClaudeLine(line: string): readonly HarnessSignal[] {
  const obj = parseJsonObject(line);
  if (obj === undefined) return [];

  switch (obj["type"]) {
    case "system":
      return parseSystem(obj);
    case "assistant":
      return parseAssistant(obj);
    case "user":
      return parseUser(obj);
    case "result":
      return parseResult(obj);
    case "rate_limit_event":
      return parseRateLimit(obj);
    default:
      // `stream_event`, `thinking_tokens` e o que a CLI inventar depois. Uma
      // linha desconhecida não é erro: o formato evolui e o adapter precisa
      // sobreviver a uma versão menor.
      return [];
  }
}

function parseSystem(obj: Record<string, unknown>): readonly HarnessSignal[] {
  if (obj["subtype"] === "init") {
    const sessionId = asString(obj["session_id"]);
    return sessionId === undefined ? [] : [{ kind: "session", id: sessionId }];
  }
  if (obj["subtype"] === "permission_denied") {
    const tool = asString(obj["tool_name"]) ?? "ferramenta";
    const reason = asString(obj["decision_reason"]) ?? asString(obj["message"]) ?? "sem motivo";
    // Uma permissão negada não é falha do Run: é a política funcionando. Vira
    // diagnóstico para que a interface consiga mostrar por que o agente parou.
    return [
      {
        kind: "diagnostic",
        level: "WARN",
        message: `Permissão negada para ${tool}: ${reason}`,
      },
    ];
  }
  return [];
}

function parseAssistant(obj: Record<string, unknown>): readonly HarnessSignal[] {
  const message = asRecord(obj["message"]);
  const content = message?.["content"];
  if (!Array.isArray(content)) return [];

  const signals: HarnessSignal[] = [];
  for (const entry of content) {
    const block = asRecord(entry);
    if (block === undefined) continue;

    if (block["type"] === "text") {
      const text = asString(block["text"]);
      if (text !== undefined && text.length > 0) signals.push({ kind: "text", text });
      continue;
    }

    if (block["type"] === "tool_use") {
      const name = asString(block["name"]);
      if (name === undefined) continue;
      const id = asString(block["id"]);
      signals.push({
        kind: "tool_call",
        ...(id === undefined ? {} : { id }),
        name,
        args: describeToolInput(name, block["input"]),
      });
    }
  }
  return signals;
}

function parseUser(obj: Record<string, unknown>): readonly HarnessSignal[] {
  const message = asRecord(obj["message"]);
  const content = message?.["content"];
  if (!Array.isArray(content)) return [];

  const signals: HarnessSignal[] = [];
  for (const entry of content) {
    const block = asRecord(entry);
    if (block === undefined || block["type"] !== "tool_result") continue;
    const id = asString(block["tool_use_id"]);
    signals.push({
      kind: "tool_result",
      ...(id === undefined ? {} : { id }),
      ok: block["is_error"] !== true,
      output: flattenContent(block["content"]),
    });
  }
  return signals;
}

function parseResult(obj: Record<string, unknown>): readonly HarnessSignal[] {
  const signals: HarnessSignal[] = [];

  const usage = parseClaudeUsage(obj["usage"], asNumber(obj["total_cost_usd"]));
  if (usage !== undefined) signals.push({ kind: "usage", usage });

  if (obj["is_error"] === true) {
    const message =
      asString(obj["result"]) ?? asString(obj["subtype"]) ?? "O Claude Code reportou um erro.";
    signals.push({ kind: "error", message, retryable: true });
    return signals;
  }

  const text = asString(obj["result"]);
  if (text !== undefined) signals.push({ kind: "result", text });
  return signals;
}

function parseRateLimit(obj: Record<string, unknown>): readonly HarnessSignal[] {
  const info = asRecord(obj["rate_limit_info"]);
  const status = asString(info?.["status"]);
  // `allowed` é o caso normal e apareceria em toda linha; só o que atrapalha
  // vira evento.
  if (status === undefined || status === "allowed") return [];
  return [
    {
      kind: "diagnostic",
      level: "WARN",
      message: `Limite de taxa do Claude Code: ${status}.`,
    },
  ];
}

/** Mapeia o objeto de `usage` do Claude para o nosso. */
export function parseClaudeUsage(value: unknown, costUsd?: number): UsageSummary | undefined {
  const usage = asRecord(value);
  if (usage === undefined) return undefined;

  const input = asNumber(usage["input_tokens"]);
  const output = asNumber(usage["output_tokens"]);
  if (input === undefined || output === undefined) return undefined;

  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: asNumber(usage["cache_read_input_tokens"]) ?? 0,
    cacheCreationInputTokens: asNumber(usage["cache_creation_input_tokens"]) ?? 0,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}
