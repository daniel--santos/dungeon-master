// Adapted from Sandcastle — src/AgentProvider.ts@e99f832 (provider `pi` e
// `parsePiStreamLine`)
// Copyright (c) 2026 Matt Pocock. Licensed under the MIT License.
// Changes: argv em array no lugar da string de shell; o parser passou a
// traduzir `tool_execution_start`/`tool_execution_end` — o original casa os
// nomes de ferramenta contra uma tabela em maiúsculas (`Bash`) e o Pi emite em
// minúsculas (`bash`), então nenhuma chamada de ferramenta chegava aos eventos
// — e a ler o consumo de tokens de `message_end`. Verificado contra a CLI
// 0.85.1 em 07/09/2026.

import type { HarnessSignal, ResolvedPermission } from "@dungeon-master/runtime";
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
 * O Pi busca credencial por provedor, e o provedor é escolha do usuário.
 *
 * A lista é maior que a dos outros dois porque uma chave de qualquer um dos
 * provedores suportados é o que faz o Pi funcionar; deixar de fora a do
 * provedor configurado produziria uma falha de autenticação difícil de
 * diagnosticar.
 */
const PI_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "SHELL",
  "PI_HOME",
  "PI_OFFLINE",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "CEREBRAS_API_KEY",
  "ZAI_API_KEY",
];

export interface PiOptions {
  /** Executável procurado no PATH. Padrão: `pi`. */
  readonly binary?: string;
  readonly provider?: string;
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  readonly extraArgs?: readonly string[];
}

export const PI_CAPABILITIES = capabilities({
  streaming: true,
  structuredOutput: true,
  resume: true,
  // `--fork` existe e cria uma sessão nova a partir de outra; ele ainda não foi
  // exercitado na suíte de contrato, e a matriz só promete o que está provado.
  forkSession: false,
  toolEvents: true,
  tokenUsage: true,
  modelSelection: true,
  // `--tools` é uma allow-list de **ferramenta** de verdade, e o adapter a usa.
  // Ainda assim isto é `false`: uma vez que `bash` está na lista, qualquer
  // comando roda, e o Pi não tem como recusar `rm -rf` e aceitar `git status`.
  // Prometer permissão nativa aqui mostraria na interface uma proteção por
  // comando que não existe.
  nativePermissions: false,
  hostExecution: true,
  dockerExecution: false,
});

/**
 * A definição do Pi: argv, parser e capabilities.
 *
 * Mora separada do adapter porque os dois modos de execução a compartilham: no
 * host ela vira `createCliHarnessAdapter`; no Docker, o mesmo `buildArgs` e o
 * mesmo `parseLine` entram num `createDockerAdapter`. É o que garante que um
 * `ToolCall` chega à interface igual nos dois modos — a exigência da seção 17 do
 * documento técnico.
 */
export function piDefinition(options: PiOptions = {}): CliHarnessDefinition {
  return {
    id: "pi@host",
    key: "PI",
    capabilities: PI_CAPABILITIES,
    environmentKeys: PI_ENV_KEYS,
    binary: options.binary ?? "pi",
    versionArgs: ["--version"],
    installHint:
      "Instale com `npm i -g @earendil-works/pi-coding-agent` e configure um provedor com `pi auth`.",
    parseVersion: (stdout, stderr) => parseSemverish(stdout, stderr),
    parseLine: parsePiLine,
    buildArgs: (request): CliArgs => {
      const args = ["-p", "--mode", "json"];

      if (options.provider !== undefined) args.push("--provider", options.provider);
      if (request.model !== undefined) args.push("--model", request.model.id);
      if (options.thinking !== undefined) args.push("--thinking", options.thinking);
      // `--session <id>` resolve uma sessão existente e continua nela.
      if (request.resume !== undefined) args.push("--session", request.resume.harnessSessionId);
      if (request.permission.mode === "BYPASS") {
        args.push("--approve");
      } else if (request.permission.mode === "CONFIGURED") {
        // `--tools` é o que o Pi expõe de mais próximo de uma allow-list: ele
        // decide quais ferramentas existem, não quais comandos passam. É um
        // degrau real — sem `bash` na lista o agente não executa nada — e é o
        // motivo de `nativePermissions` continuar `false`.
        const tools = piToolsFor(request.permission.grant);
        if (tools.length > 0) args.push("--tools", tools.join(","));
        if (request.permission.harnessMode === "no-approve") args.push("--no-approve");
      }

      if (options.extraArgs !== undefined) args.push(...options.extraArgs);
      if (request.extraArgs !== undefined) args.push(...request.extraArgs);

      return { args, stdin: request.prompt };
    },
    describeExit: (exitCode, stderrTail) => {
      const tail = stderrTail.trim();
      if (tail.length === 0) return undefined;
      return {
        message: `pi saiu com código ${String(exitCode)}: ${tail.slice(0, 500)}`,
        retryable: !/no api key|not authenticated|unknown model|no model/i.test(tail),
      };
    },
  };
}

/** Adapter do Pi rodando no host. */
export function pi(options: PiOptions = {}) {
  return createCliHarnessAdapter(piDefinition(options));
}

/**
 * A concessão do domínio virando a allow-list de `--tools` do Pi.
 *
 * `grep`, `find` e `ls` vêm desligadas por padrão na CLI; quando a lista é
 * passada explicitamente, elas precisam entrar, senão o agente perde a busca e
 * volta a fazer tudo por `bash` — o oposto do que restringir ferramenta
 * pretende.
 *
 * `powershell` acompanha `bash` porque no Windows é ela que o Pi usa; separar
 * as duas deixaria a mesma política com efeitos diferentes por sistema.
 */
export function piToolsFor(grant: ResolvedPermission["grant"]): string[] {
  if (grant === undefined) return [];

  const tools = ["read", "grep", "find", "ls"];
  if (grant.workspaceWrite) tools.push("edit", "write");
  if (grant.commandExecution === "ALLOWLIST" && grant.allowedCommands.length > 0) {
    tools.push("bash", "powershell");
  }
  return tools;
}

/** Traduz uma linha do `pi -p --mode json`. */
export function parsePiLine(line: string): readonly HarnessSignal[] {
  const obj = parseJsonObject(line);
  if (obj === undefined) return [];

  switch (obj["type"]) {
    case "session": {
      // A **única** aparição do id de sessão do Pi é esta linha de cabeçalho;
      // nenhum evento seguinte o repete. Perder esta linha é perder o resume.
      const id = asString(obj["id"]);
      return id === undefined ? [] : [{ kind: "session", id }];
    }
    case "message_update": {
      const event = asRecord(obj["assistantMessageEvent"]);
      if (event?.["type"] !== "text_delta") return [];
      const delta = asString(event["delta"]);
      return delta === undefined || delta.length === 0 ? [] : [{ kind: "text", text: delta }];
    }
    case "message_end": {
      const message = asRecord(obj["message"]);
      if (message?.["role"] !== "assistant") return [];
      const usage = parsePiUsage(message["usage"]);
      return usage === undefined ? [] : [{ kind: "usage", usage }];
    }
    case "tool_execution_start": {
      const name = asString(obj["toolName"]);
      if (name === undefined) return [];
      const id = asString(obj["toolCallId"]);
      return [
        {
          kind: "tool_call",
          ...(id === undefined ? {} : { id }),
          name,
          args: describeToolInput(name, obj["args"]),
        },
      ];
    }
    case "tool_execution_end": {
      const name = asString(obj["toolName"]);
      const id = asString(obj["toolCallId"]);
      return [
        {
          kind: "tool_result",
          ...(id === undefined ? {} : { id }),
          ...(name === undefined ? {} : { name }),
          ok: obj["isError"] !== true,
          output: flattenContent(obj["result"]),
        },
      ];
    }
    case "agent_error":
    case "error": {
      // O Pi manda erro de autenticação e de limite de taxa pelo **stdout**,
      // não pelo stderr; sem esta tradução, a falha chegaria como uma saída
      // vazia e um código diferente de zero sem explicação.
      const message =
        asString(obj["message"]) ??
        asString(asRecord(obj["error"])?.["message"]) ??
        "O Pi reportou um erro.";
      return [{ kind: "error", message, retryable: true }];
    }
    case "agent_end":
      return parseAgentEnd(obj);
    default:
      return [];
  }
}

function parseAgentEnd(obj: Record<string, unknown>): readonly HarnessSignal[] {
  const messages = obj["messages"];
  if (!Array.isArray(messages)) return [];

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = asRecord(messages[index]);
    if (message?.["role"] !== "assistant") continue;
    const text = flattenContent(message["content"]);
    return text.length > 0 ? [{ kind: "result", text }] : [];
  }
  return [];
}

/** Mapeia o `usage` do Pi para o nosso. */
export function parsePiUsage(value: unknown): UsageSummary | undefined {
  const usage = asRecord(value);
  if (usage === undefined) return undefined;

  const input = asNumber(usage["input"]);
  const output = asNumber(usage["output"]);
  if (input === undefined || output === undefined) return undefined;

  const cost = asNumber(asRecord(usage["cost"])?.["total"]);
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: asNumber(usage["cacheRead"]) ?? 0,
    cacheCreationInputTokens: asNumber(usage["cacheWrite"]) ?? 0,
    ...(cost === undefined ? {} : { costUsd: cost }),
  };
}
