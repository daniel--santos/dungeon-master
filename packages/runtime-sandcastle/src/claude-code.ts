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

import type {
  HarnessExecutionRequest,
  HarnessSignal,
  ResolvedPermission,
} from "@dungeon-master/runtime";
import { capabilities, PERMISSION_DENIED_DIAGNOSTIC_CODE } from "@dungeon-master/runtime";
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
    buildArgs: (request): CliArgs => buildClaudeCodeArgs(request, options),
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

/**
 * O argv do Claude Code para um pedido já resolvido.
 *
 * Exportada, e não fechada dentro de `claudeCode()`, porque a tradução da
 * política em `--allowedTools` é a peça que mais precisa de teste e a que menos
 * dá para verificar por fora: um argv errado não quebra o Run, ele faz o agente
 * ser negado no meio e reportar que não conseguiu.
 */
export function buildClaudeCodeArgs(
  request: HarnessExecutionRequest,
  options: ClaudeCodeOptions = {},
): CliArgs {
  const args = ["--print", "--verbose", "--output-format", "stream-json"];

  if (request.model !== undefined) args.push("--model", request.model.id);
  if (options.effort !== undefined) args.push("--effort", options.effort);

  // `--permission-mode` e `--dangerously-skip-permissions` são mutuamente
  // exclusivos na CLI. O modo padrão não passa nenhum dos dois: vale o
  // padrão da própria ferramenta, que é o mais restritivo.
  if (request.permission.mode === "BYPASS") {
    args.push("--dangerously-skip-permissions");
  } else {
    if (request.permission.mode === "CONFIGURED") {
      // `acceptEdits` é o piso do modo configurado: ele tira do caminho a
      // confirmação de cada edição. Quem libera **comando** é a
      // `--allowedTools` abaixo, e não o modo — foi essa confusão que fez o
      // primeiro Run desta fase terminar `blocked` sem conseguir commitar.
      args.push("--permission-mode", request.permission.harnessMode ?? "acceptEdits");

      const permitidas = allowedToolsFor(request.permission.grant);
      if (permitidas.length > 0) args.push("--allowedTools", permitidas.join(","));

      const negadas = deniedToolsFor(request.permission.grant);
      if (negadas.length > 0) args.push("--disallowedTools", negadas.join(","));
    }

    // Sem ninguém para responder, o que fosse perguntar é **negado**, e não
    // fica esperando. É a diferença entre um Run que falha dizendo o que
    // faltou na allow-list e um Run pendurado até o timeout de ociosidade.
    args.push("--permission-prompts", "none");
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
}

/**
 * Ferramentas que existem em qualquer Run configurado, porque ler não muda nada.
 *
 * `Glob` e `Grep` entram junto de `Read` de propósito: sem elas o agente
 * procura arquivo com `Bash`, que é exatamente o que a allow-list de comandos
 * deveria evitar.
 */
const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"] as const;

/** As que escrevem no workspace, liberadas só com `workspaceWrite`. */
const WRITE_TOOLS = ["Edit", "Write", "NotebookEdit"] as const;

/** As duas ferramentas de shell da CLI. No Windows a segunda é a preferida. */
const SHELL_TOOLS = ["Bash", "PowerShell"] as const;

/**
 * A concessão do domínio virando `--allowedTools`.
 *
 * O formato de comando é `<Ferramenta>(<prefixo>:*)`, que é como a CLI casa o
 * começo da linha de comando. Um prefixo com espaço (`pnpm test`) funciona
 * igual: o casamento é textual.
 *
 * **`PowerShell` entra junto de `Bash`.** No Windows é ela que o agente tenta
 * primeiro, e uma lista só com `Bash` produz uma negação por tarefa e um turno
 * gasto refazendo o mesmo comando na outra ferramenta — verificado contra a CLI
 * 2.1.263. Liberar as duas com o mesmo prefixo é o que faz a mesma política
 * valer igual nos dois sistemas.
 *
 * Uma allow-list vazia **não** vira `Bash` solto. Conceder a ferramenta inteira
 * porque a lista veio vazia transformaria o perfil mais restritivo no mais
 * permissivo de todos.
 *
 * Limite conhecido, medido na CLI real: um comando composto — `git add X; if
 * ($?) { git commit … }` — não casa com prefixo nenhum, porque a CLI não valida
 * estaticamente as partes de uma cadeia, e é negado mesmo com `git` liberado. O
 * agente reescreve em comandos simples e segue. É por isso que uma negação
 * isolada não reprova o Run.
 */
export function allowedToolsFor(grant: ResolvedPermission["grant"]): string[] {
  if (grant === undefined) return [];

  const tools: string[] = [...READ_ONLY_TOOLS];
  if (grant.workspaceWrite) tools.push(...WRITE_TOOLS);

  if (grant.commandExecution === "ALLOWLIST") {
    for (const comando of grant.allowedCommands) {
      const prefixo = comando.trim();
      if (prefixo.length === 0) continue;
      for (const shell of SHELL_TOOLS) tools.push(`${shell}(${prefixo}:*)`);
    }
  }

  return tools;
}

/**
 * Uma ferramenta negada pela política vira diagnóstico, não falha imediata.
 *
 * A tentação é encerrar o Run na primeira negação. A CLI real desaconselha:
 * medido contra a 2.1.263 no Windows, o agente tenta a ferramenta `PowerShell`,
 * é negado, e refaz o mesmo trabalho com `Bash` — que estava na allow-list —
 * terminando a tarefa. Reprovar aquele Run seria descartar trabalho concluído
 * por causa de uma tentativa que o próprio agente contornou.
 *
 * Quem decide se a negação foi fatal é o **Worker**, no fim: ele já sabe se o
 * agente entregou `completed` ou parou. Aqui o dever é só deixar o fato
 * registrado no ponto em que aconteceu, com um código estável para ninguém
 * precisar interpretar a mensagem, e com o texto que diz o que fazer.
 *
 * `--permission-prompts none` no argv é o que garante que uma negação é
 * imediata em vez de uma espera: sem ninguém para aprovar, a CLI recusa e seg
 * em frente, e o Run nunca fica pendurado até o timeout de ociosidade.
 */
export function describePermissionDenied(input: {
  tool: string | undefined;
  reason: string | undefined;
}): readonly HarnessSignal[] {
  const tool = input.tool ?? "uma ferramenta";
  const reason = input.reason ?? "sem motivo informado";

  return [
    {
      kind: "diagnostic",
      level: "WARN",
      code: PERMISSION_DENIED_DIAGNOSTIC_CODE,
      message: `Permissão negada para ${tool}: ${reason}`,
      detail:
        `Se o Run terminar sem concluir a tarefa, libere ${tool} no ExecutionProfile — em ` +
        "`permissionPolicy.allowedCommands`, quando for um comando — ou, se ele precisa mesmo " +
        "rodar sem barreira, ligue `allowUnsafeBypass` no perfil, ciente de que o agente passa " +
        "a ter as suas permissões no sistema.",
    },
  ];
}

/** Os prefixos negados, que ganham do que a allow-list liberou. */
export function deniedToolsFor(grant: ResolvedPermission["grant"]): string[] {
  if (grant === undefined) return [];
  return grant.deniedCommands
    .map((comando) => comando.trim())
    .filter((comando) => comando.length > 0)
    .flatMap((comando) => SHELL_TOOLS.map((shell) => `${shell}(${comando}:*)`));
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
    return describePermissionDenied({
      tool: asString(obj["tool_name"]),
      reason: asString(obj["decision_reason"]) ?? asString(obj["message"]),
    });
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
