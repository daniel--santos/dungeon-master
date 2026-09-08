/**
 * O contrato de um harness (planejamento v0.4, Fase 2A).
 *
 * Um adapter sabe três coisas: montar o argv não interativo de uma CLI,
 * traduzir o stream dela para {@link HarnessEvent}, e matar a árvore de
 * processos que subiu. Ele **não** sabe de timeout, de retry de schema, de
 * worktree nem de política de ambiente: isso é do `AgentRuntime`, que é quem
 * garante que toda execução termina.
 *
 * A divisão importa porque é ela que mantém a promessa da seção 13 do
 * documento técnico: cancelamento e timeout são do domínio, não da biblioteca
 * externa. Um adapter que resolvesse timeout sozinho tornaria a garantia
 * dependente de cada CLI.
 */

import type {
  ExecutionEventOf,
  HarnessKey,
  PreflightProblemCode,
  UsageSummary,
} from "@dungeon-master/contracts";

import type { HarnessCapabilities } from "./capabilities.js";
import type { McpServerSpec } from "./mcp.js";
import type {
  EnforcementLevel,
  ExecutionMode,
  ModelRef,
  PermissionGrant,
  PermissionMode,
  RuntimeResourceLimits,
} from "./types.js";

/**
 * Os eventos que um adapter emite enquanto o agente trabalha.
 *
 * São os não terminais do `ExecutionEvent`, menos `RunStarted`: quem abre e
 * quem fecha o fluxo é o runtime, porque só ele conhece o preflight, os
 * relógios e o resultado estruturado.
 */
export type HarnessStreamEvent = ExecutionEventOf<
  | "TextDelta"
  | "ToolCall"
  | "ToolResult"
  | "Artifact"
  | "Usage"
  | "Diagnostic"
  | "ApprovalRequested"
  | "SessionCaptured"
>;

/**
 * A última coisa que um adapter emite: o processo saiu.
 *
 * Não é um `ExecutionEvent`. O adapter relata o que observou — código de
 * saída, texto final, saída bruta — e o runtime decide se isso é
 * `RunCompleted`, `RunFailed`, `RunTimedOut` ou `RunCancelled`. Sem essa
 * separação, dois adapters chegariam a vereditos diferentes para o mesmo
 * código de saída.
 */
export interface HarnessFinishedEvent {
  readonly type: "HarnessFinished";
  readonly timestamp: string;
  readonly harness: HarnessKey;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Texto final do agente, quando o stream traz um evento de resultado. */
  readonly finalText?: string;
  /**
   * Cauda limitada do texto do assistente, de onde o bloco `<result>` é
   * extraído. Limitada porque um Run longo estoura o teto de string do V8.
   */
  readonly assistantText: string;
  /** Cauda limitada do `stderr`, para o diagnóstico de falha. */
  readonly stderrTail: string;
  readonly harnessSessionId?: string;
  readonly usage?: UsageSummary;
  /** Erro observado pelo adapter (spawn falhou, stream inválido, CLI reclamou). */
  readonly error?: { readonly message: string; readonly retryable: boolean };
}

export type HarnessEvent = HarnessStreamEvent | HarnessFinishedEvent;

/** O evento fecha o stream do adapter? */
export function isHarnessFinished(event: HarnessEvent): event is HarnessFinishedEvent {
  return event.type === "HarnessFinished";
}

/**
 * Código do `Diagnostic` que um adapter emite quando o harness nega uma
 * ferramenta.
 *
 * Mora aqui, e não em cada adapter, porque quem reage a ele é o Worker: um
 * código por harness obrigaria o Worker a conhecer os três. É também o que
 * permite ao harness falso produzir a mesma situação sem CLI instalada.
 */
export const PERMISSION_DENIED_DIAGNOSTIC_CODE = "PERMISSION_DENIED";

/** Política de permissão já resolvida pelo runtime, pronta para virar argv. */
export interface ResolvedPermission {
  readonly mode: PermissionMode;
  /** Modo nativo do harness, quando `mode` é `CONFIGURED`. */
  readonly harnessMode?: string;
  /**
   * O que foi concedido, sem vocabulário de CLI. O adapter traduz.
   *
   * Presente em `CONFIGURED`. Ausente significa "vale o padrão da ferramenta",
   * que é o que `DEFAULT` quer dizer.
   */
  readonly grant?: PermissionGrant;
  /** O nível que a UI vai mostrar depois que o adapter montar o comando. */
  readonly enforcement: EnforcementLevel;
}

/**
 * Política de rede já resolvida pelo runtime, pronta para virar `--network`.
 *
 * `enforced` é a distinção que o projeto faz em todo lugar entre pedir e impor:
 * `false` no host sempre, e no Docker quando o pedido é `ALLOWLIST` — o Docker
 * liga ou desliga a rede do container, e não filtra por host sem um proxy no
 * meio. Um pedido não imponível vira `Diagnostic`, nunca promessa silenciosa.
 */
export interface ResolvedNetwork {
  readonly access: "NONE" | "ALLOWLIST" | "ALL";
  readonly allowedHosts: readonly string[];
  readonly enforced: boolean;
}

/**
 * Resultado estruturado pedido, já no vocabulário que um adapter usa.
 *
 * Só chega preenchido quando quem chamou o Run forneceu o JSON Schema junto do
 * Standard Schema. A validação continua sendo do runtime, depois: isto aqui é
 * a chance de um harness com schema nativo acertar o formato na primeira vez,
 * em vez de depender de o modelo seguir a instrução do prompt.
 */
export interface HarnessStructuredOutput {
  /** JSON Schema, como objeto. O adapter serializa se a CLI pedir string. */
  readonly jsonSchema: unknown;
  /** Tag onde o runtime vai procurar o bloco. Padrão do runtime: `result`. */
  readonly tag: string;
}

/** Pedido de retomada de sessão. */
export interface ResumeRequest {
  readonly harnessSessionId: string;
  /** Criar uma sessão nova em vez de mutar a original. */
  readonly fork?: boolean;
}

/**
 * O que o runtime entrega a um adapter.
 *
 * `env` já vem montado por allow-list; o adapter não lê `process.env`.
 * `cwd` já vem normalizado e absoluto.
 */
export interface HarnessExecutionRequest {
  /** Identificador da execução. É a chave de {@link HarnessAdapter.cancel}. */
  readonly executionId: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly env: Readonly<Record<string, string>>;
  readonly model?: ModelRef;
  readonly resume?: ResumeRequest;
  readonly permission: ResolvedPermission;
  /**
   * Schema nativo, quando o pedido trouxe `outputSchema.jsonSchema`.
   *
   * Um adapter sem structured output nativo ignora o campo: a instrução do
   * bloco `<result>` já foi acrescentada ao prompt pelo runtime, e é ela que
   * vale para todos.
   */
  readonly outputSchema?: HarnessStructuredOutput;
  /** Argumentos extras do Loadout, já em forma de array. */
  readonly extraArgs?: readonly string[];
  /**
   * Política de rede resolvida. Um adapter de host a ignora, porque no host não
   * há como impor; o backend de container a traduz para `--network`.
   */
  readonly network?: ResolvedNetwork;
  /** Limites de recurso do perfil. Só o backend de container os aplica. */
  readonly resourceLimits?: RuntimeResourceLimits;
  /**
   * Servidores MCP a subir, já filtrados pelo runtime: só chegam a um adapter
   * com `mcpServers: true`. No modo `DOCKER`, já vêm reescritos com o comando
   * de dentro do container (veja `mcpServersForContainer`).
   */
  readonly mcpServers?: readonly McpServerSpec[];
}

/**
 * O que o kill de árvore conseguiu.
 *
 * Deliberadamente mais rico que o `Promise<void>` do rascunho do planejamento:
 * `RunCancelled` carrega a confirmação de término, e um `void` obrigaria o
 * runtime a adivinhar. `terminated: false` é um resultado válido e visível.
 */
export interface HarnessCancelResult {
  /** O desaparecimento da árvore foi confirmado por polling? */
  readonly terminated: boolean;
  /** Último método usado: `taskkill`, `sigterm`, `sigkill`. */
  readonly method?: string;
  readonly elapsedMs: number;
  /** `true` quando não havia execução com esse id (já terminou, ou nunca subiu). */
  readonly notRunning?: boolean;
}

/**
 * Um problema encontrado no preflight.
 *
 * O código vem do enum de `@dungeon-master/contracts`, que é o que a API expõe
 * no preflight do Docker: uma lista só, e não duas para divergirem.
 */
export interface PreflightProblem {
  readonly code: PreflightProblemCode;
  readonly message: string;
  /** Um problema fatal impede a execução; os demais viram `Diagnostic`. */
  readonly fatal: boolean;
}

/**
 * O resultado do preflight (documento técnico, seção 33).
 *
 * `authenticated` é `undefined` quando a checagem não é barata ou não existe:
 * dizer `false` sem prova travaria execuções que funcionariam. A ausência de
 * autenticação detectável **não** é fatal por si só; ela vira um problema não
 * fatal e a CLI reclama sozinha se for o caso.
 */
export interface PreflightResult {
  readonly installed: boolean;
  readonly version?: string;
  /** Caminho do executável resolvido, para o log e para a mensagem de erro. */
  readonly executablePath?: string;
  readonly authenticated?: boolean;
  readonly problems: readonly PreflightProblem[];
}

/** O preflight roda com contexto: o modo pedido e onde o Run vai acontecer. */
export interface HarnessContext {
  readonly mode: ExecutionMode;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Teto de tempo do `--version`. Padrão do adapter: 15 s. */
  readonly timeoutMs?: number;
}

/**
 * Um harness concreto, no host ou em container.
 *
 * `execute` nunca lança: um spawn que falha vira `HarnessFinished` com `error`.
 * É o que permite ao runtime prometer um evento terminal em qualquer caminho.
 */
export interface HarnessAdapter {
  /** Identificador estável do adapter, com o ambiente: `claude-code@host`. */
  readonly id: string;
  readonly key: HarnessKey;
  /**
   * Em que modo de execução este adapter roda. Padrão: `HOST`.
   *
   * O par `(key, executionMode)` é a chave do registry, e não `key` sozinha:
   * `CLAUDE_CODE` tem dois adapters — um que sobe a CLI no host e outro que a
   * sobe dentro de um container — e escolher entre eles é justamente o que o
   * `ExecutionProfile.mode` decide. Deixar o campo opcional mantém os adapters
   * e os dublês de teste que existiam antes da Fase 2C válidos sem mudança.
   */
  readonly executionMode?: ExecutionMode;
  readonly capabilities: HarnessCapabilities;
  /**
   * Chaves do ambiente do worker que a CLI precisa enxergar.
   *
   * `HOME` e `APPDATA` para achar as credenciais, `CODEX_HOME` e afins para a
   * configuração. Entram na allow-list junto com o piso do SO; sem isso, um
   * ambiente montado do zero deixaria toda CLI sem autenticação.
   */
  readonly environmentKeys?: readonly string[];
  preflight(context: HarnessContext): Promise<PreflightResult>;
  execute(request: HarnessExecutionRequest): AsyncIterable<HarnessEvent>;
  cancel(executionId: string): Promise<HarnessCancelResult>;
}

/**
 * Erro de uso do runtime: pedido malformado, estratégia não suportada,
 * adapter ausente. Nasce com `retryable` porque é ele que decide se o worker
 * reenfileira; um pedido malformado nunca melhora com retentativa.
 */
export class RuntimeRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: { code: string; retryable?: boolean; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RuntimeRequestError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }
}
