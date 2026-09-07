import { z } from "zod";

import { HarnessKeySchema } from "./harness.js";

/**
 * `ExecutionEvent` — a linguagem comum de toda execução de agente.
 *
 * Cada harness fala um dialeto NDJSON diferente (documento técnico, seção 12).
 * O adapter traduz o dialeto para esta união e mais nada da aplicação precisa
 * conhecer o formato de cada CLI: a web, o banco e as Conquistas leem só daqui.
 *
 * Três invariantes valem para todo produtor:
 *
 * 1. **Um evento terminal por execução, e ele é o último.** `RunCompleted`,
 *    `RunFailed`, `RunTimedOut` e `RunCancelled` fecham o fluxo; nada é emitido
 *    depois. {@link isTerminalExecutionEventType} é a checagem.
 * 2. **Nada lança para o consumidor.** Falha de preflight, de spawn, de parser
 *    ou de schema vira `RunFailed`; o `AsyncIterable` do runtime termina sempre
 *    por um evento, nunca por exceção.
 * 3. **`RunCancelled` só sai depois da confirmação de término da árvore de
 *    processos** (documento técnico, seção 13). O campo
 *    `processTreeTerminated` diz se a confirmação veio; `false` é honesto e
 *    aparece na interface, em vez de fingir que o processo morreu.
 *
 * O vocabulário de nomes é o da Fase 2D do planejamento, agrupado: `ToolCalled`
 * e `ToolResultReceived` viram `ToolCall`/`ToolResult`, `HarnessSessionCaptured`
 * vira `SessionCaptured`, e os quatro fins de Run viram os quatro eventos
 * terminais.
 */

/** Tipos de evento de execução. Enum fechado: quem escreve só emite um destes. */
export const EXECUTION_EVENT_TYPE_VALUES = [
  "RunStarted",
  "TextDelta",
  "ToolCall",
  "ToolResult",
  "Artifact",
  "Usage",
  "Diagnostic",
  "ApprovalRequested",
  "SessionCaptured",
  "RunCompleted",
  "RunFailed",
  "RunTimedOut",
  "RunCancelled",
] as const;

export const ExecutionEventTypeSchema = z
  .enum(EXECUTION_EVENT_TYPE_VALUES)
  .meta({ id: "ExecutionEventType", description: "Tipos de evento de execução." });

export type ExecutionEventType = z.infer<typeof ExecutionEventTypeSchema>;

/** Os quatro fins possíveis de uma execução. Depois de um deles, nada é emitido. */
export const TERMINAL_EXECUTION_EVENT_TYPES = [
  "RunCompleted",
  "RunFailed",
  "RunTimedOut",
  "RunCancelled",
] as const satisfies readonly ExecutionEventType[];

export type TerminalExecutionEventType = (typeof TERMINAL_EXECUTION_EVENT_TYPES)[number];

/** O tipo fecha o fluxo de eventos? */
export function isTerminalExecutionEventType(
  type: ExecutionEventType,
): type is TerminalExecutionEventType {
  return (TERMINAL_EXECUTION_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Campos que todo evento carrega.
 *
 * `timestamp` é ISO 8601 em UTC, gravado pelo produtor no instante em que o
 * evento nasce — não é o instante da persistência, que fica na coluna do
 * `run_event`. `harness` acompanha cada linha porque um Run pode, no futuro,
 * misturar harnesses em steps diferentes do mesmo workflow.
 */
const executionEventBase = {
  timestamp: z.iso.datetime().describe("Instante em que o evento nasceu, em UTC (ISO 8601)."),
  harness: HarnessKeySchema.describe("Harness que produziu o evento."),
};

/** Nível de severidade de um `Diagnostic`. */
export const DIAGNOSTIC_LEVEL_VALUES = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

export const DiagnosticLevelSchema = z
  .enum(DIAGNOSTIC_LEVEL_VALUES)
  .meta({ id: "DiagnosticLevel", description: "Severidade de um diagnóstico." });

export type DiagnosticLevel = z.infer<typeof DiagnosticLevelSchema>;

/** De onde veio um `Diagnostic`: do processo do harness ou da nossa camada. */
export const DIAGNOSTIC_SOURCE_VALUES = ["HARNESS", "STDERR", "RUNTIME"] as const;

export const DiagnosticSourceSchema = z
  .enum(DIAGNOSTIC_SOURCE_VALUES)
  .meta({ id: "DiagnosticSource", description: "Origem de um diagnóstico." });

export type DiagnosticSource = z.infer<typeof DiagnosticSourceSchema>;

/** Qual dos dois relógios estourou. */
export const TIMEOUT_KIND_VALUES = ["IDLE", "COMPLETION"] as const;

export const TimeoutKindSchema = z.enum(TIMEOUT_KIND_VALUES).meta({
  id: "TimeoutKind",
  description: "Ocioso (sem evento por N ms) ou de conclusão (tempo total).",
});

export type TimeoutKind = z.infer<typeof TimeoutKindSchema>;

/**
 * Contagem de tokens de uma execução.
 *
 * Os quatro campos são os do Claude Code, que é o formato mais granular dos
 * três; Codex e Pi são mapeados para ele pelo adapter, deixando em zero o que
 * não existe. `costUsd` só aparece quando o harness informa: assinatura sem
 * custo por token deixa o campo de fora, e um zero ali mentiria.
 */
export const UsageSummarySchema = z
  .object({
    inputTokens: z.number().int().nonnegative().describe("Tokens de entrada não cacheados."),
    outputTokens: z.number().int().nonnegative().describe("Tokens gerados."),
    cacheReadInputTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("Tokens de entrada servidos do cache."),
    cacheCreationInputTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("Tokens de entrada gravados no cache."),
    costUsd: z
      .number()
      .nonnegative()
      .optional()
      .describe("Custo informado pelo harness, quando existir."),
  })
  .meta({ id: "UsageSummary", description: "Consumo de tokens de uma execução." });

export type UsageSummary = z.infer<typeof UsageSummarySchema>;

/**
 * A execução começou: o processo do harness subiu e o relógio corre.
 *
 * `workspacePath` é o diretório onde o agente roda de fato — o worktree do Run
 * no modo `GIT_WORKTREE`, o próprio repositório no modo `CURRENT`. Registrar
 * aqui é o que torna um Run auditável depois: o caminho fica no evento, não só
 * na linha mutável do Run.
 */
export const RunStartedEventSchema = z
  .object({
    type: z.literal("RunStarted"),
    ...executionEventBase,
    harnessVersion: z.string().min(1).describe("Versão da CLI, vista pelo preflight."),
    model: z.string().min(1).optional().describe("Modelo pedido ao harness, quando houver."),
    workspacePath: z.string().min(1).describe("Diretório de trabalho absoluto do agente."),
    executionMode: z.string().min(1).describe("`HOST` ou `DOCKER`."),
    enforcement: z.string().min(1).describe("Nível de enforcement efetivo da política."),
  })
  .meta({ id: "RunStartedEvent" });

/** Um pedaço de texto do assistente. Sem garantia de ser uma frase completa. */
export const TextDeltaEventSchema = z
  .object({
    type: z.literal("TextDelta"),
    ...executionEventBase,
    text: z.string().describe("Trecho de texto do assistente."),
  })
  .meta({ id: "TextDeltaEvent" });

/**
 * O agente chamou uma ferramenta.
 *
 * `arguments` é texto, não JSON: cada harness descreve os argumentos de um
 * jeito, e o valor aqui existe para ser lido por gente na timeline. Vem
 * truncado pelo adapter para não estourar a linha do evento.
 */
export const ToolCallEventSchema = z
  .object({
    type: z.literal("ToolCall"),
    ...executionEventBase,
    toolCallId: z.string().min(1).optional().describe("Id da chamada, quando o harness dá um."),
    name: z.string().min(1).describe("Nome da ferramenta."),
    arguments: z.string().describe("Argumentos em texto, já truncados para exibição."),
  })
  .meta({ id: "ToolCallEvent" });

/** O resultado de uma chamada de ferramenta. */
export const ToolResultEventSchema = z
  .object({
    type: z.literal("ToolResult"),
    ...executionEventBase,
    toolCallId: z.string().min(1).optional().describe("Id da chamada correspondente."),
    name: z.string().min(1).optional().describe("Nome da ferramenta, quando o harness repete."),
    ok: z.boolean().describe("A ferramenta terminou sem erro?"),
    output: z.string().describe("Saída em texto, já truncada para exibição."),
  })
  .meta({ id: "ToolResultEvent" });

/** Um arquivo produzido pela execução e digno de virar Espólio. */
export const ArtifactEventSchema = z
  .object({
    type: z.literal("Artifact"),
    ...executionEventBase,
    path: z.string().min(1).describe("Caminho relativo ao workspace."),
    kind: z.string().min(1).optional().describe("Classificação livre: `file`, `patch`, `report`."),
    bytes: z.number().int().nonnegative().optional().describe("Tamanho, quando conhecido."),
  })
  .meta({ id: "ArtifactEvent" });

/** Consumo de tokens reportado durante ou ao fim da execução. */
export const UsageEventSchema = z
  .object({
    type: z.literal("Usage"),
    ...executionEventBase,
    usage: UsageSummarySchema,
  })
  .meta({ id: "UsageEvent" });

/**
 * Qualquer coisa que ajude a depurar sem ser conteúdo do agente.
 *
 * `stderr` do processo, aviso de política de permissão, texto bruto que falhou
 * a validação do structured output. Nunca é o resultado do Run.
 */
export const DiagnosticEventSchema = z
  .object({
    type: z.literal("Diagnostic"),
    ...executionEventBase,
    level: DiagnosticLevelSchema,
    source: DiagnosticSourceSchema,
    message: z.string().describe("Texto do diagnóstico."),
    detail: z.string().optional().describe("Corpo longo, quando houver."),
  })
  .meta({ id: "DiagnosticEvent" });

/**
 * O harness pediu aprovação humana.
 *
 * `approvalKey` é a chave estável do gate, e não o id do step: é por ela que a
 * retomada encontra o gate depois de um restart do worker (planejamento, Fase 4).
 */
export const ApprovalRequestedEventSchema = z
  .object({
    type: z.literal("ApprovalRequested"),
    ...executionEventBase,
    approvalKey: z.string().min(1).describe("Chave estável do pedido de aprovação."),
    summary: z.string().describe("O que está sendo pedido, em uma linha."),
    toolName: z.string().min(1).optional().describe("Ferramenta que disparou o pedido."),
  })
  .meta({ id: "ApprovalRequestedEvent" });

/**
 * O id de sessão do harness apareceu no stream.
 *
 * É o que permite retomar (`--resume`, `codex exec resume`, `pi --session`).
 * Persistido no Run **junto com o harness emissor**, porque as semânticas de
 * resume diferem (documento técnico, seção 13).
 */
export const SessionCapturedEventSchema = z
  .object({
    type: z.literal("SessionCaptured"),
    ...executionEventBase,
    harnessSessionId: z.string().min(1).describe("Id de sessão ou conversa do harness."),
  })
  .meta({ id: "SessionCapturedEvent" });

/** A execução terminou bem. Evento terminal. */
export const RunCompletedEventSchema = z
  .object({
    type: z.literal("RunCompleted"),
    ...executionEventBase,
    summary: z.string().describe("Texto final do agente, para leitura humana."),
    output: z.unknown().optional().describe("Resultado estruturado validado, quando pedido."),
    usage: UsageSummarySchema.optional(),
    harnessSessionId: z.string().min(1).optional().describe("Sessão do harness, quando capturada."),
    durationMs: z.number().int().nonnegative().describe("Duração total da execução."),
  })
  .meta({ id: "RunCompletedEvent" });

/**
 * A execução falhou. Evento terminal.
 *
 * `retryable` separa o que uma nova tentativa pode resolver (rede, limite de
 * taxa, processo morto por causa externa) do que não pode (CLI ausente,
 * autenticação faltando, schema que o agente não consegue produzir). O worker
 * usa esse campo para decidir reenfileirar; sem ele, cada chamador
 * reinventaria a heurística.
 */
export const RunFailedEventSchema = z
  .object({
    type: z.literal("RunFailed"),
    ...executionEventBase,
    error: z
      .object({
        message: z.string().describe("Mensagem para leitura humana."),
        code: z.string().min(1).optional().describe("Código estável, quando existir."),
        exitCode: z.number().int().optional().describe("Código de saída do processo."),
      })
      .describe("O que deu errado."),
    retryable: z.boolean().describe("Uma nova tentativa tem chance de dar certo?"),
    harnessSessionId: z.string().min(1).optional().describe("Sessão do harness, quando capturada."),
    durationMs: z.number().int().nonnegative().describe("Duração total até a falha."),
  })
  .meta({ id: "RunFailedEvent" });

/**
 * Um dos dois relógios estourou. Evento terminal.
 *
 * `IDLE` é ausência de evento por `idleMs`; `COMPLETION` é o teto total. Os
 * dois são nossos, nunca do harness (planejamento v0.4, Fase 2B). `elapsedMs`
 * e `limitMs` andam juntos porque é a diferença entre eles que distingue um
 * timeout real de um abort disfarçado de timeout.
 */
export const RunTimedOutEventSchema = z
  .object({
    type: z.literal("RunTimedOut"),
    ...executionEventBase,
    kind: TimeoutKindSchema,
    elapsedMs: z.number().int().nonnegative().describe("Tempo decorrido até o estouro."),
    limitMs: z.number().int().nonnegative().describe("Limite configurado que foi atingido."),
    processTreeTerminated: z
      .boolean()
      .describe("A árvore de processos foi confirmada como encerrada?"),
    harnessSessionId: z.string().min(1).optional().describe("Sessão do harness, quando capturada."),
  })
  .meta({ id: "RunTimedOutEvent" });

/**
 * O Run foi cancelado. Evento terminal.
 *
 * Emitido **depois** da tentativa de matar a árvore de processos.
 * `processTreeTerminated: false` significa que o polling não confirmou o
 * desaparecimento; o Run vira `CANCELLED` mesmo assim, mas a interface precisa
 * dizer que sobrou processo (documento técnico, seção 13).
 */
export const RunCancelledEventSchema = z
  .object({
    type: z.literal("RunCancelled"),
    ...executionEventBase,
    reason: z.string().optional().describe("Motivo do cancelamento, quando informado."),
    processTreeTerminated: z
      .boolean()
      .describe("A árvore de processos foi confirmada como encerrada?"),
    terminationMethod: z
      .string()
      .min(1)
      .optional()
      .describe("Último método usado: `taskkill`, `sigterm` ou `sigkill`."),
    elapsedMs: z.number().int().nonnegative().describe("Tempo decorrido até o cancelamento."),
  })
  .meta({ id: "RunCancelledEvent" });

/** A união discriminada por `type`. */
export const ExecutionEventSchema = z
  .discriminatedUnion("type", [
    RunStartedEventSchema,
    TextDeltaEventSchema,
    ToolCallEventSchema,
    ToolResultEventSchema,
    ArtifactEventSchema,
    UsageEventSchema,
    DiagnosticEventSchema,
    ApprovalRequestedEventSchema,
    SessionCapturedEventSchema,
    RunCompletedEventSchema,
    RunFailedEventSchema,
    RunTimedOutEventSchema,
    RunCancelledEventSchema,
  ])
  .meta({ id: "ExecutionEvent", description: "Evento canônico de execução de agente." });

export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;
export type TextDeltaEvent = z.infer<typeof TextDeltaEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type ArtifactEvent = z.infer<typeof ArtifactEventSchema>;
export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>;
export type ApprovalRequestedEvent = z.infer<typeof ApprovalRequestedEventSchema>;
export type SessionCapturedEvent = z.infer<typeof SessionCapturedEventSchema>;
export type RunCompletedEvent = z.infer<typeof RunCompletedEventSchema>;
export type RunFailedEvent = z.infer<typeof RunFailedEventSchema>;
export type RunTimedOutEvent = z.infer<typeof RunTimedOutEventSchema>;
export type RunCancelledEvent = z.infer<typeof RunCancelledEventSchema>;

/** O evento fecha o fluxo? Estreita o tipo para os quatro terminais. */
export function isTerminalExecutionEvent(
  event: ExecutionEvent,
): event is RunCompletedEvent | RunFailedEvent | RunTimedOutEvent | RunCancelledEvent {
  return isTerminalExecutionEventType(event.type);
}

/** Estreita a união pelo discriminante, para assinaturas que só aceitam alguns tipos. */
export type ExecutionEventOf<K extends ExecutionEventType> = Extract<ExecutionEvent, { type: K }>;
