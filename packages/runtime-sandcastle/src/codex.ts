// Adapted from Sandcastle — src/AgentProvider.ts@e99f832 (provider `codex`,
// `parseCodexStreamLine` e `parseCodexUsage`)
// Copyright (c) 2026 Matt Pocock. Licensed under the MIT License.
// Changes: argv em array no lugar da string de shell; o padrão deixou de ser
// `--dangerously-bypass-approvals-and-sandbox` e passou a exigir política
// explícita; o parser ganhou `item.started`/`item.completed` de
// `command_execution` como par ToolCall/ToolResult, `file_change` como
// `Artifact`, e `turn.failed` como erro. `codex exec fork` não existe na CLI
// 0.147.0, então `forkSession` é `false` em vez de prometido. Verificado contra
// a CLI 0.147.0 em 07/09/2026.

import type { HarnessSignal, McpServerSpec } from "@dungeon-master/runtime";
import { capabilities } from "@dungeon-master/runtime";
import type { UsageSummary } from "@dungeon-master/contracts";

import {
  createCliHarnessAdapter,
  parseSemverish,
  type CliArgs,
  type CliHarnessDefinition,
} from "./cli-adapter.js";
import { asNumber, asRecord, asString, parseJsonObject } from "./parse-utils.js";

/** `CODEX_HOME` guarda config e credenciais; sem ele a CLI não acha o login. */
const CODEX_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "SHELL",
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
];

export interface CodexOptions {
  /** Executável procurado no PATH. Padrão: `codex`. */
  readonly binary?: string;
  readonly effort?: "low" | "medium" | "high" | "xhigh";
  /**
   * Rodar fora de um repositório git. Padrão: `true`.
   *
   * A checagem do Codex existe para proteger quem roda no diretório errado;
   * aqui o diretório é escolhido pelo runtime — o worktree do Run ou o
   * `workspace_path` — e a checagem só atrapalharia um Run legítimo em pasta
   * sem git.
   */
  readonly skipGitRepoCheck?: boolean;
  readonly extraArgs?: readonly string[];
}

export const CODEX_CAPABILITIES = capabilities({
  streaming: true,
  structuredOutput: true,
  resume: true,
  // `codex exec fork` não existe na 0.147.0; só `resume`.
  forkSession: false,
  toolEvents: true,
  tokenUsage: true,
  modelSelection: true,
  nativePermissions: true,
  hostExecution: true,
  dockerExecution: false,
  // Fase 7. `-c mcp_servers.<nome>.command/args` sobe o servidor em `exec`;
  // `env_vars` repassa as variáveis pelo **nome** (o Codex não herda o
  // ambiente para servidores MCP — medido: só ~20 variáveis chegam sem ele);
  // `default_tools_approval_mode="approve"` é o que faz a chamada rodar com
  // `approval_policy="never"`, senão ela sai como "user cancelled MCP tool
  // call". A chamada aparece no stream como item `mcp_tool_call` com `server`
  // e `tool`. Medido contra a 0.147.0 em 08/09/2026; provado pelo caso
  // `usesMcpServer` da suíte de contrato.
  mcpServers: true,
});

/**
 * A definição do Codex CLI: argv, parser e capabilities.
 *
 * Mora separada do adapter porque os dois modos de execução a compartilham: no
 * host ela vira `createCliHarnessAdapter`; no Docker, o mesmo `buildArgs` e o
 * mesmo `parseLine` entram num `createDockerAdapter`. É o que garante que um
 * `ToolCall` chega à interface igual nos dois modos — a exigência da seção 17 do
 * documento técnico.
 */
export function codexDefinition(options: CodexOptions = {}): CliHarnessDefinition {
  return {
    id: "codex@host",
    key: "CODEX",
    capabilities: CODEX_CAPABILITIES,
    environmentKeys: CODEX_ENV_KEYS,
    binary: options.binary ?? "codex",
    versionArgs: ["--version"],
    installHint: "Instale com `npm i -g @openai/codex` e autentique com `codex login`.",
    parseVersion: (stdout, stderr) => parseSemverish(stdout, stderr),
    parseLine: parseCodexLine,
    buildArgs: (request): CliArgs => {
      const args = ["exec"];

      // `resume` é um subcomando, e não uma flag: ele vem logo depois de `exec`.
      if (request.resume !== undefined) args.push("resume", request.resume.harnessSessionId);

      args.push("--json");
      if ((options.skipGitRepoCheck ?? true) === true) args.push("--skip-git-repo-check");
      if (request.model !== undefined) args.push("-m", request.model.id);
      if (options.effort !== undefined) {
        args.push("-c", `model_reasoning_effort="${options.effort}"`);
      }

      if (request.permission.mode === "BYPASS") {
        args.push("--dangerously-bypass-approvals-and-sandbox");
      } else if (request.permission.mode === "CONFIGURED") {
        // O Codex não tem allow-list por comando: ele tem **sandbox**, que é uma
        // barreira melhor. `workspace-write` deixa o agente escrever no
        // diretório de trabalho e rodar comandos ali dentro, e recusa o resto —
        // inclusive rede. Traduzir a concessão para o modo de sandbox é mais
        // honesto que fingir uma lista de comandos que a CLI não aplicaria.
        const sandbox =
          request.permission.harnessMode ??
          (request.permission.grant?.workspaceWrite === true ? "workspace-write" : "read-only");
        args.push("-s", sandbox);

        // Em `exec` não há ninguém para aprovar nada. Dizer isso à CLI é o que
        // impede um pedido de escalonamento de ficar esperando resposta que não
        // vem; o comando é recusado e o agente segue ou falha, mas não pendura.
        args.push("-c", 'approval_policy="never"');
      }

      args.push(...codexMcpArgs(request.mcpServers));

      if (options.extraArgs !== undefined) args.push(...options.extraArgs);
      if (request.extraArgs !== undefined) args.push(...request.extraArgs);

      // `-` diz ao Codex para ler as instruções do stdin. Sem ele, um stdin
      // aberto vira um bloco `<stdin>` **anexado** ao prompt posicional, e o
      // agente recebe o prompt duas vezes.
      args.push("-");
      return { args, stdin: request.prompt };
    },
    describeExit: (exitCode, stderrTail) => {
      const tail = stderrTail.trim();
      if (tail.length === 0) return undefined;
      return {
        message: `codex saiu com código ${String(exitCode)}: ${tail.slice(0, 500)}`,
        retryable: !/not logged in|unauthorized|unsupported model|unknown model/i.test(tail),
      };
    },
  };
}

/** Adapter do Codex CLI rodando no host. */
export function codex(options: CodexOptions = {}) {
  return createCliHarnessAdapter(codexDefinition(options));
}

/**
 * Um valor de string em TOML, para os `-c chave=valor` do Codex.
 *
 * String literal (aspas simples) sempre que der: nela `\\` é um caractere e
 * não um escape, que é o que um caminho do Windows precisa. Quando o valor tem
 * aspas simples ou caractere de controle, cai na string básica com escapes.
 */
export function tomlString(value: string): string {
  // eslint-disable-next-line no-control-regex -- os controles são o alvo.
  if (!value.includes("'") && !/[\u0000-\u001f\u007f]/.test(value)) return `'${value}'`;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    // eslint-disable-next-line no-control-regex -- idem.
    .replace(
      /[\u0000-\u001f\u007f]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  return `"${escaped}"`;
}

/**
 * Os `-c` que ligam os servidores MCP do pedido no Codex.
 *
 * Cada chave é um override de `config.toml`, no argv, e nada é gravado no
 * `~/.codex` do usuário. `env_vars` leva só **nomes**: o valor de
 * `DATABASE_URL` fica no ambiente do processo do Codex, que o repassa ao
 * servidor. `enabled_tools` fecha a lista quando o servidor a declara.
 */
export function codexMcpArgs(servers: readonly McpServerSpec[] | undefined): string[] {
  const args: string[] = [];
  for (const server of servers ?? []) {
    const prefix = `mcp_servers.${server.name}`;
    if (server.transport === "STDIO") {
      args.push("-c", `${prefix}.command=${tomlString(server.command)}`);
      args.push("-c", `${prefix}.args=[${server.args.map(tomlString).join(", ")}]`);
      if (server.envKeys !== undefined && server.envKeys.length > 0) {
        args.push("-c", `${prefix}.env_vars=[${server.envKeys.map(tomlString).join(", ")}]`);
      }
    } else {
      args.push("-c", `${prefix}.url=${tomlString(server.url)}`);
    }
    if (server.tools !== undefined && server.tools.length > 0) {
      args.push("-c", `${prefix}.enabled_tools=[${server.tools.map(tomlString).join(", ")}]`);
    }
    args.push("-c", `${prefix}.default_tools_approval_mode="approve"`);
  }
  return args;
}

/** O nome canônico de uma chamada MCP no diário: o mesmo do Claude Code. */
function mcpToolName(item: Record<string, unknown>): string {
  const server = asString(item["server"]) ?? "mcp";
  const tool = asString(item["tool"]) ?? "tool";
  return `mcp__${server}__${tool}`;
}

/** Traduz uma linha do `codex exec --json`. */
export function parseCodexLine(line: string): readonly HarnessSignal[] {
  const obj = parseJsonObject(line);
  if (obj === undefined) return [];

  switch (obj["type"]) {
    case "thread.started": {
      const id = asString(obj["thread_id"]);
      return id === undefined ? [] : [{ kind: "session", id }];
    }
    case "item.started":
      return parseItemStarted(asRecord(obj["item"]));
    case "item.completed":
      return parseItemCompleted(asRecord(obj["item"]));
    case "turn.completed": {
      const usage = parseCodexUsage(obj["usage"]);
      return usage === undefined ? [] : [{ kind: "usage", usage }];
    }
    case "turn.failed":
    case "error": {
      const error = asRecord(obj["error"]);
      const message =
        asString(error?.["message"]) ?? asString(obj["message"]) ?? "O Codex reportou um erro.";
      return [{ kind: "error", message, retryable: true }];
    }
    default:
      return [];
  }
}

function parseItemStarted(item: Record<string, unknown> | undefined): readonly HarnessSignal[] {
  if (item === undefined) return [];
  const id = asString(item["id"]);

  if (item["type"] === "command_execution") {
    const command = asString(item["command"]);
    if (command === undefined) return [];
    return [
      { kind: "tool_call", ...(id === undefined ? {} : { id }), name: "Bash", args: command },
    ];
  }

  // Uma chamada a servidor MCP leva servidor e ferramenta no nome, no mesmo
  // formato do Claude Code, para o diário dizer "buscou no Grimório" e não
  // "mcp_tool_call". Os argumentos vão como JSON, que é o que a CLI entrega.
  if (item["type"] === "mcp_tool_call") {
    const argumentos = item["arguments"];
    return [
      {
        kind: "tool_call",
        ...(id === undefined ? {} : { id }),
        name: mcpToolName(item),
        args: argumentos === undefined || argumentos === null ? "" : JSON.stringify(argumentos),
      },
    ];
  }

  // Os demais tipos de item (`file_change`, `web_search`)
  // também são trabalho do agente; o nome do tipo é o melhor rótulo disponível.
  const type = asString(item["type"]);
  if (type === undefined || type === "agent_message" || type === "reasoning") return [];
  return [{ kind: "tool_call", ...(id === undefined ? {} : { id }), name: type, args: "" }];
}

function parseItemCompleted(item: Record<string, unknown> | undefined): readonly HarnessSignal[] {
  if (item === undefined) return [];
  const id = asString(item["id"]);

  if (item["type"] === "agent_message") {
    const text = asString(item["text"]);
    if (text === undefined) return [];
    // O Codex não tem evento de resultado separado: a última mensagem do agente
    // **é** o resultado. Emitir os dois deixa o texto na timeline e no resumo.
    return [
      { kind: "text", text },
      { kind: "result", text },
    ];
  }

  if (item["type"] === "command_execution") {
    const exitCode = asNumber(item["exit_code"]);
    return [
      {
        kind: "tool_result",
        ...(id === undefined ? {} : { id }),
        name: "Bash",
        ok: exitCode === 0,
        output: asString(item["aggregated_output"]) ?? "",
      },
    ];
  }

  if (item["type"] === "mcp_tool_call") {
    const error = asRecord(item["error"]);
    const message = asString(error?.["message"]);
    const result = asRecord(item["result"]);
    const content = result?.["content"];
    const texto = Array.isArray(content)
      ? content
          .map((block) => asString(asRecord(block)?.["text"]))
          .filter((text): text is string => text !== undefined)
          .join("\n")
      : "";
    const ok = asString(item["status"]) !== "failed" && error === undefined;
    return [
      {
        kind: "tool_result",
        ...(id === undefined ? {} : { id }),
        name: mcpToolName(item),
        ok,
        output: ok ? texto : (message ?? texto ?? "A chamada MCP falhou."),
      },
    ];
  }

  if (item["type"] === "file_change") {
    const changes = item["changes"];
    const signals: HarnessSignal[] = [];
    if (Array.isArray(changes)) {
      for (const entry of changes) {
        const change = asRecord(entry);
        const path = asString(change?.["path"]);
        if (path === undefined) continue;
        const kind = asString(change?.["kind"]);
        signals.push({
          kind: "artifact",
          path,
          ...(kind === undefined ? {} : { artifactKind: kind }),
        });
      }
    }
    signals.push({
      kind: "tool_result",
      ...(id === undefined ? {} : { id }),
      name: "file_change",
      ok: true,
      output: `${String(signals.length)} arquivo(s) alterado(s)`,
    });
    return signals;
  }

  const type = asString(item["type"]);
  if (type === undefined || type === "reasoning") return [];
  return [
    {
      kind: "tool_result",
      ...(id === undefined ? {} : { id }),
      name: type,
      ok: asString(item["status"]) !== "failed",
      output: asString(item["text"]) ?? "",
    },
  ];
}

/**
 * Mapeia o `usage` do Codex para o nosso.
 *
 * No Codex, `input_tokens` é o **total** de entrada e `cached_input_tokens` é
 * um subconjunto já incluído nele. Somar os dois contaria o cache duas vezes na
 * janela de contexto, então a parte cacheada vai para `cacheReadInputTokens` e
 * o resto para `inputTokens`. (Mesma decisão do Sandcastle.)
 */
export function parseCodexUsage(value: unknown): UsageSummary | undefined {
  const usage = asRecord(value);
  if (usage === undefined) return undefined;

  const input = asNumber(usage["input_tokens"]);
  const cached = asNumber(usage["cached_input_tokens"]) ?? 0;
  const output = asNumber(usage["output_tokens"]);
  if (input === undefined || output === undefined) return undefined;

  return {
    inputTokens: Math.max(0, input - cached),
    outputTokens: output,
    cacheReadInputTokens: cached,
    cacheCreationInputTokens: asNumber(usage["cache_write_input_tokens"]) ?? 0,
  };
}
