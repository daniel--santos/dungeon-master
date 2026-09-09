/**
 * O adapter do Antigravity CLI (`agy`) no host.
 *
 * Adapter direto, e não provider do Sandcastle (planejamento v0.4, Fase 3B): o
 * que muda em relação aos outros três é só o argv e o dialeto de NDJSON, e os
 * dois cabem na base que `@dungeon-master/runtime-sandcastle` já expõe. Spawn
 * sem shell, cauda limitada, kill de árvore com confirmação e os dois relógios
 * continuam sendo do `AgentRuntime`.
 *
 * Todo comportamento afirmado aqui foi medido contra a CLI 1.1.27 no Windows em
 * 07/09/2026; os comandos e as saídas estão no `README.md` deste pacote, seção
 * "Contrato da CLI 1.1.27".
 */

import type {
  HarnessExecutionRequest,
  HarnessSignal,
  ResolvedPermission,
} from "@dungeon-master/runtime";
import {
  capabilities,
  DEFAULT_OUTPUT_TAG,
  PERMISSION_DENIED_DIAGNOSTIC_CODE,
} from "@dungeon-master/runtime";
import type { UsageSummary } from "@dungeon-master/contracts";
import {
  asNumber,
  asRecord,
  asString,
  createCliHarnessAdapter,
  describeToolInput,
  interpretAgyModels,
  parseJsonObject,
  parseSemverish,
  type CliArgs,
  type CliHarnessDefinition,
} from "@dungeon-master/runtime-sandcastle";

/**
 * Chaves de ambiente que o `agy` precisa enxergar.
 *
 * `HOME`/`USERPROFILE` porque é de lá que sai `~/.gemini/antigravity-cli`, onde
 * moram as configurações, as conversas e o cache. A credencial em si **não**
 * está lá — o spike provou que uma home vazia continua autenticada, porque o
 * token vem do chaveiro do sistema —, mas sem a home a CLI perde o histórico de
 * conversa, e sem histórico não há resume.
 *
 * As `GOOGLE_*`/`GEMINI_*` entram por precaução: o ADR 0002 mediu que o `agy`
 * 1.1.27 **não** as consome, mas elas são inertes quando ignoradas e evitam um
 * diagnóstico difícil se uma versão futura passar a lê-las.
 *
 * **`AGY_ADC_AUTH` fica de fora, e isso é deliberado.** É o interruptor de
 * Application Default Credentials, o único caminho não interativo que o ADR 0002
 * encontrou — e ele **quebra o host autenticado**: com ele ligado a CLI para de
 * usar o token do cofre do sistema operacional e passa a exigir um arquivo de
 * credencial que no host não existe. Repassá-lo da allow-list transformaria uma
 * variável deixada no ambiente para um experimento de container em falha de
 * autenticação em todo Run de host, sem nada no log ligando as duas coisas.
 */
const ANTIGRAVITY_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "SHELL",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "CLOUD_ML_REGION",
];

/** Esforço de raciocínio aceito pela CLI 1.1.27. */
export type AntigravityEffort = "low" | "medium" | "high";

export interface AntigravityOptions {
  /** Executável procurado no PATH. Padrão: `agy`. */
  readonly binary?: string;
  /** Esforço de raciocínio, quando o Loadout não disser outra coisa. */
  readonly effort?: AntigravityEffort;
  /** Agente nomeado da CLI (`--agent`). */
  readonly agent?: string;
  /** Argumentos extras fixos do adapter, em array. */
  readonly extraArgs?: readonly string[];
}

/**
 * A matriz do Antigravity, com o que foi exercitado de fato.
 *
 * Os dois `false` que surpreendem:
 *
 * **`nativePermissions`.** A CLI tem allow-list — `permissions.allow` em
 * `~/.gemini/antigravity-cli/settings.json`, com regras `command(git)` e
 * `write_file(*)` — mas em modo headless (`-p`) as regras de **comando** não
 * são consultadas: qualquer `run_command` é auto-negado, e o único jeito de
 * executar comando é `--dangerously-skip-permissions`, que libera tudo. Medido
 * nos quatro valores de `toolPermission` e com as regras carregadas (o log da
 * CLI confirma `stored 3 allow`). Prometer permissão nativa aqui mostraria na
 * interface uma barreira por comando que a nossa allow-list não constrói.
 *
 * **`agentSelection`.** A flag `--agent` existe, mas `agy agents` não lista
 * nenhum agente nesta instalação, então não houve como exercitar a seleção. A
 * regra da matriz é a mesma de sempre: só entra `true` o que a suíte prova.
 */
export const ANTIGRAVITY_CAPABILITIES = capabilities({
  streaming: true,
  // `--json-schema` valida no lado da CLI e devolve `result.structured_output`
  // já conforme. O adapter reembala esse objeto no bloco `<result>`, que é onde
  // o runtime valida com o Standard Schema — as duas coisas somam.
  structuredOutput: true,
  resume: true,
  // Não há `--fork-session`: `--conversation <id>` continua a mesma conversa.
  forkSession: false,
  // `--input-format stream-json` existe e foi documentado no spike, mas a
  // sessão contínua não entra nesta fase.
  multiTurnProcess: false,
  toolEvents: true,
  tokenUsage: true,
  modelSelection: true,
  agentSelection: false,
  nativePermissions: false,
  hostExecution: true,
  // Gate próprio (planejamento v0.4, Fase 3D): a credencial do `agy` vem do
  // chaveiro do sistema, e montar isso num container é decisão do ADR daquela
  // fase, não deste adapter.
  dockerExecution: false,
  // Fase 7. O `agy` 1.1.27 só conhece servidor MCP pela configuração global
  // do usuário (`~/.gemini/config/mcp_config.json`, a mesma da IDE, escrita
  // por `agy mcp add`): não há flag de linha de comando, não há variável de
  // ambiente e um `.mcp.json` no workspace **não** é lido — medido em
  // 08/09/2026 (README, "Servidores MCP"). Escopar um servidor por Run
  // exigiria reescrever a configuração global do usuário a cada Expedição, e
  // dois Runs em paralelo se sobrescreveriam. Fica `false`, com aviso.
  mcpServers: false,
});

/**
 * A definição do Antigravity: argv, parser e capabilities.
 *
 * Mora separada do adapter pelo mesmo motivo das outras três: o dia em que a
 * Fase 3D ligar o modo `DOCKER`, o mesmo `buildArgs` e o mesmo `parseLine`
 * entram num `createDockerAdapter` sem que um `ToolCall` mude de forma entre os
 * modos.
 */
export function antigravityDefinition(options: AntigravityOptions = {}): CliHarnessDefinition {
  return {
    id: "antigravity@host",
    key: "ANTIGRAVITY",
    capabilities: ANTIGRAVITY_CAPABILITIES,
    environmentKeys: ANTIGRAVITY_ENV_KEYS,
    binary: options.binary ?? "agy",
    versionArgs: ["--version"],
    installHint:
      "Instale o Antigravity CLI a partir de https://antigravity.google e autentique rodando `agy` uma vez.",
    parseVersion: (stdout, stderr) => parseSemverish(stdout, stderr),
    parseLine: parseAntigravityLine,
    buildArgs: (request): CliArgs => buildAntigravityArgs(request, options),
    // `agy models` (1.1.27): lista com código 0 quando há sessão no cofre do
    // sistema, "Please sign in" com 1 quando não há. Um ou dois segundos, com
    // rede, sem gastar token — o preflight não interativo do ADR 0002. A
    // allow-list de ambiente deste adapter deixa `AGY_ADC_AUTH` de fora, e é
    // isso que impede o falso negativo descrito lá.
    detectAuthentication: async ({ run }) => interpretAgyModels(await run(["models"])),
    describeExit: (exitCode, stderrTail) => {
      const tail = stderrTail.trim();
      if (tail.length === 0) return undefined;
      return {
        message: `agy saiu com código ${String(exitCode)}: ${tail.slice(0, 500)}`,
        // Credencial ausente e modelo inexistente não melhoram com
        // retentativa; cota e rede melhoram. Na dúvida, retentável.
        retryable:
          !/not (?:logged in|authenticated|signed in)|no authentication|invalid model|not recognized as a known model/i.test(
            tail,
          ),
      };
    },
  };
}

/** Adapter do Antigravity rodando no host. */
export function antigravity(options: AntigravityOptions = {}) {
  return createCliHarnessAdapter(antigravityDefinition(options));
}

/**
 * Uma linha NDJSON com o prompt do usuário, no formato de `--input-format
 * stream-json`.
 *
 * **Esta é a peça menos óbvia do adapter.** O `-p` do `agy` toma o prompt como
 * *valor da flag*: `agy -p "texto"` funciona, e `echo texto | agy -p` faz a CLI
 * engolir a flag seguinte como prompt e reclamar. Não há como mandar o prompt
 * pelo stdin em modo texto — e mandar pelo argv esbarraria no teto de 32767
 * caracteres da linha de comando do Windows, que um prompt com contexto de
 * projeto passa sem esforço.
 *
 * A saída é `--input-format stream-json`: com ela a CLI lê uma mensagem NDJSON
 * por linha do stdin e roda um turno para cada. Uma linha só é exatamente um
 * turno, que é o que este adapter faz — e mantém a convenção dos outros três,
 * onde o prompt sempre viaja pelo stdin.
 */
export function encodeUserMessage(prompt: string): string {
  return `${JSON.stringify({
    event: "user",
    message: { role: "user", content: [{ type: "text", text: prompt }] },
  })}\n`;
}

/**
 * O argv do Antigravity para um pedido já resolvido.
 *
 * `-p=` com valor vazio é o que entra em modo print sem consumir o próximo
 * argumento como prompt; o prompt de verdade vai pelo stdin.
 *
 * `--add-dir <cwd>` não é enfeite: sem ele o agente não trata o diretório de
 * trabalho como workspace e escreve os arquivos em
 * `~/.gemini/antigravity-cli/scratch`. Medido — o primeiro Run do spike criou
 * o `OLA.md` na scratch da CLI, e não no repositório.
 */
export function buildAntigravityArgs(
  request: HarnessExecutionRequest,
  options: AntigravityOptions = {},
): CliArgs {
  const args = [
    "-p=",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--add-dir",
    request.cwd,
    // Em modo print o que sobra de comando de barra é expansão de skill que
    // ninguém pediu; desligar deixa o prompt ser só o prompt.
    "--disable-slash-commands",
  ];

  if (request.model !== undefined) args.push("--model", request.model.id);
  if (options.agent !== undefined) args.push("--agent", options.agent);
  if (options.effort !== undefined) args.push("--effort", options.effort);

  // Structured output nativo. Só quando a tag é a padrão: o bloco `<result>`
  // que o parser sintetiza a partir de `result.structured_output` é escrito com
  // ela, e uma tag customizada faria o runtime procurar onde não está. Nesse
  // caso vale o caminho comum a todos — a instrução no prompt.
  const jsonSchema = request.outputSchema;
  if (jsonSchema !== undefined && jsonSchema.tag === DEFAULT_OUTPUT_TAG) {
    args.push("--json-schema", JSON.stringify(jsonSchema.jsonSchema));
  }

  if (request.resume !== undefined) args.push("--conversation", request.resume.harnessSessionId);

  // A CLI 1.1.27 tem exatamente um interruptor de permissão utilizável em modo
  // headless, e ele libera tudo. Ele só sai daqui em `BYPASS`, que por sua vez
  // só chega até aqui com isolamento imposto ou com `allowUnsafeBypass` no
  // perfil (`resolvePermission`, em `@dungeon-master/runtime`).
  //
  // `CONFIGURED` **não** vira flag nenhuma de propósito. A allow-list de
  // comandos da CLI não é consultada em modo headless, então traduzi-la seria
  // escrever no argv uma barreira que não existe; o que sobra é o padrão da
  // ferramenta, que nega todo comando. Mais restritivo que o pedido, nunca
  // menos — e o Worker avisa disso no log do Run.
  if (request.permission.mode === "BYPASS") args.push("--dangerously-skip-permissions");

  if (options.extraArgs !== undefined) args.push(...options.extraArgs);
  if (request.extraArgs !== undefined) args.push(...request.extraArgs);

  return { args, stdin: encodeUserMessage(request.prompt) };
}

/**
 * Traduz uma linha do `--output-format stream-json` do Antigravity.
 *
 * O dialeto tem três eventos e nada mais: `init` (uma vez, com o
 * `conversation_id`), `step_update` (muitas, uma por transição de passo) e
 * `result` (uma, no fim). A variação toda mora em `step_type`.
 */
export function parseAntigravityLine(line: string): readonly HarnessSignal[] {
  const obj = parseJsonObject(line);
  if (obj === undefined) return [];

  switch (obj["event"]) {
    case "init": {
      // A **única** aparição garantida do id de conversa fora do `result`. Ela
      // vem antes de qualquer trabalho, que é o que permite retomar um Run
      // cancelado no meio.
      const id = asString(obj["conversation_id"]);
      return id === undefined || id.length === 0 ? [] : [{ kind: "session", id }];
    }
    case "step_update":
      return parseStepUpdate(asRecord(obj["step_update"]));
    case "result":
      return parseResult(asRecord(obj["result"]));
    default:
      // Um evento novo numa versão menor não é erro: o formato evolui e o
      // adapter precisa sobreviver a isso sem derrubar o Run.
      return [];
  }
}

function parseStepUpdate(step: Record<string, unknown> | undefined): readonly HarnessSignal[] {
  if (step === undefined) return [];

  const signals: HarnessSignal[] = [];
  const state = asString(step["state"]);

  switch (step["step_type"]) {
    case "agent_response": {
      const delta = asString(step["text_delta"]);
      if (delta !== undefined && delta.length > 0) signals.push({ kind: "text", text: delta });
      break;
    }
    case "tool":
      signals.push(...parseToolStep(step, state));
      break;
    default:
      // `user_input`, `finish` e o que a CLI acrescentar: transições sem
      // conteúdo para a interface.
      break;
  }

  // O consumo aparece por passo **e** somado na linha `result`. Os dois viram
  // evento: o parcial dá a barra de progresso, e o total, que chega por último,
  // é o que fica gravado no Run.
  const usage = parseAntigravityUsage(step["usage"]);
  if (usage !== undefined) signals.push({ kind: "usage", usage });

  return signals;
}

/**
 * Um passo de ferramenta virando `ToolCall` e `ToolResult`.
 *
 * O id de correlação é o `step_index`: a CLI não emite um id de chamada, e sem
 * correlação a interface não consegue casar o resultado com a chamada. O índice
 * é único dentro de uma conversa, que é o escopo de um Run.
 */
function parseToolStep(
  step: Record<string, unknown>,
  state: string | undefined,
): readonly HarnessSignal[] {
  const name = asString(step["tool_name"]);
  if (name === undefined) return [];

  const index = asNumber(step["step_index"]);
  const id = index === undefined ? undefined : `step-${String(index)}`;
  const info = asRecord(step["tool_info"]);

  if (state === "ACTIVE") {
    return [
      {
        kind: "tool_call",
        ...(id === undefined ? {} : { id }),
        name,
        args: describeToolInput(name, info?.["parameters"]),
      },
    ];
  }

  if (state !== "DONE" && state !== "ERROR") return [];

  const error = asRecord(info?.["error"]);
  const message = asString(error?.["message"]);
  const ok = state === "DONE" && error === undefined;

  const signals: HarnessSignal[] = [
    {
      kind: "tool_result",
      ...(id === undefined ? {} : { id }),
      name,
      ok,
      output: ok ? (asString(info?.["output"]) ?? "") : (message ?? "A ferramenta falhou."),
    },
  ];

  const denial = describePermissionDenied(name, message);
  if (denial !== undefined) signals.push(denial);

  return signals;
}

/**
 * Uma recusa de permissão da CLI virando diagnóstico, e não falha imediata.
 *
 * A regra é a mesma dos outros adapters: o Worker é quem decide, no fim, se a
 * negação foi fatal, porque só ele sabe se o agente entregou o trabalho por
 * outro caminho. Aqui o dever é registrar o fato onde ele aconteceu, com um
 * código estável, e dizer o que fazer.
 *
 * O texto é específico do Antigravity de propósito: mandar o usuário
 * acrescentar o comando em `allowedCommands` seria mandá-lo fazer uma coisa que
 * não funciona nesta CLI, porque a allow-list de comando não é consultada em
 * modo headless.
 */
export function describePermissionDenied(
  tool: string,
  message: string | undefined,
): HarnessSignal | undefined {
  if (message === undefined) return undefined;
  if (!/permission (?:check failed|denied)|denied permission/i.test(message)) return undefined;

  return {
    kind: "diagnostic",
    level: "WARN",
    code: PERMISSION_DENIED_DIAGNOSTIC_CODE,
    message: `Permissão negada para ${tool}: ${message.slice(0, 300)}`,
    detail:
      "Em modo headless o `agy` 1.1.27 nega todo comando de shell, e a allow-list de comandos " +
      "do ExecutionProfile não é consultada por ele. Para este harness executar comandos, ligue " +
      "`allowUnsafeBypass` no perfil — ciente de que o agente passa a ter as suas permissões no " +
      "sistema — ou escolha um harness com permissão por comando.",
  };
}

function parseResult(result: Record<string, unknown> | undefined): readonly HarnessSignal[] {
  if (result === undefined) return [];

  const signals: HarnessSignal[] = [];

  const usage = parseAntigravityUsage(result["usage"]);
  if (usage !== undefined) signals.push({ kind: "usage", usage });

  const denied = summarizeDeniedActions(result["denied_actions"]);
  if (denied !== undefined) signals.push(denied);

  const status = asString(result["status"]);

  if (status === "ERROR") {
    const message = asString(result["error"]) ?? "O Antigravity reportou um erro sem mensagem.";
    signals.push({
      kind: "error",
      message,
      // Modelo inexistente e falta de login não melhoram com retentativa.
      retryable:
        !/invalid model selection|not recognized as a known model|not (?:logged in|authenticated|signed in)|no authentication/i.test(
          message,
        ),
    });
    return signals;
  }

  if (status === "CANCELED") {
    // `CANCELED` aparece quando a CLI encerra o turno sem concluir — foi o que
    // o spike viu toda vez que uma ferramenta essencial foi negada. Não é o
    // nosso cancelamento: aquele mata a árvore e não chega a produzir `result`.
    signals.push({
      kind: "error",
      message:
        "O Antigravity encerrou o turno como CANCELED, sem resposta final. " +
        "A causa mais comum é uma ferramenta negada por permissão em modo headless.",
      retryable: false,
    });
    return signals;
  }

  // Structured output nativo: a CLI já validou contra o `--json-schema`. Ele é
  // reembalado no bloco `<result>` porque é lá que o runtime valida com o
  // Standard Schema — e porque assim o caminho nativo e o caminho por prompt
  // desembocam no mesmo lugar.
  const structured = result["structured_output"];
  if (structured !== undefined && structured !== null) {
    signals.push({
      kind: "result",
      text: `<${DEFAULT_OUTPUT_TAG}>${JSON.stringify(structured)}</${DEFAULT_OUTPUT_TAG}>`,
    });
    return signals;
  }

  const response = asString(result["response"]);
  if (response !== undefined && response.length > 0) {
    signals.push({ kind: "result", text: response });
  }
  return signals;
}

/** `denied_actions` da linha final virando um diagnóstico só. */
function summarizeDeniedActions(value: unknown): HarnessSignal | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const nomes = value
    .map((entry) => {
      const record = asRecord(entry);
      return asString(record?.["display_name"]) ?? asString(record?.["action"]);
    })
    .filter((nome): nome is string => nome !== undefined);

  if (nomes.length === 0) return undefined;

  return {
    kind: "diagnostic",
    level: "WARN",
    code: PERMISSION_DENIED_DIAGNOSTIC_CODE,
    message: `O Antigravity negou estas ações por permissão: ${[...new Set(nomes)].join(", ")}.`,
    detail:
      "Em modo headless o `agy` 1.1.27 não consulta allow-list de comando: ou o agente roda sem " +
      "checagem (`allowUnsafeBypass` no ExecutionProfile), ou nenhum comando passa.",
  };
}

/**
 * Mapeia o `usage` do Antigravity para o nosso.
 *
 * `thinking_tokens` não tem campo no `UsageSummary` e é somado ao de saída: ele
 * é cobrado como saída, e jogá-lo fora faria o custo do Run parecer menor do
 * que é. `total_tokens` é ignorado porque é derivado.
 */
export function parseAntigravityUsage(value: unknown): UsageSummary | undefined {
  const usage = asRecord(value);
  if (usage === undefined) return undefined;

  const input = asNumber(usage["input_tokens"]);
  const output = asNumber(usage["output_tokens"]);
  if (input === undefined || output === undefined) return undefined;

  return {
    inputTokens: input,
    outputTokens: output + (asNumber(usage["thinking_tokens"]) ?? 0),
    cacheReadInputTokens: asNumber(usage["cache_read_tokens"]) ?? 0,
    cacheCreationInputTokens: 0,
  };
}

/** Exportada para o teste da tradução de permissão; a CLI não tem allow-list. */
export function permissionFlagsFor(permission: ResolvedPermission): readonly string[] {
  return permission.mode === "BYPASS" ? ["--dangerously-skip-permissions"] : [];
}
