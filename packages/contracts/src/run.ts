import { z } from "zod";

import { ExecutionModeSchema, ExecutionProfileSnapshotSchema } from "./execution-profile.js";
import { HarnessKeySchema } from "./harness.js";
import { LoadoutSnapshotSchema } from "./loadout.js";
import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * Run é uma Expedição: **uma tentativa concreta** de realizar uma Task
 * (documento técnico, seção 5.1).
 *
 * Task e Run serem entidades diferentes é o que torna possível retry, resume,
 * comparação entre modelos e loadouts, histórico e auditoria. Uma Task com três
 * Runs conta a história inteira; uma Task que fosse o próprio Run só saberia
 * contar a última tentativa.
 */

/**
 * Os nove estados de um Run (documento técnico, seção 36).
 *
 * Como em `TASK_STATUS_VALUES`, o array vem antes do schema porque três lugares
 * precisam dele como valor: o `z.enum` aqui, o `pgEnum` do PostgreSQL e a
 * tabela de transições de `@dungeon-master/domain`.
 */
export const RUN_STATUS_VALUES = [
  "CREATED",
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING_APPROVAL",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

export const RunStatusSchema = z
  .enum(RUN_STATUS_VALUES)
  .meta({ id: "RunStatus", description: "Estado de um Run na máquina de estados." });

export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * O status do resultado estruturado que o agente devolve.
 *
 * Minúsculo de propósito: é o vocabulário de `TaskExecutionResult` (documento
 * técnico, seção 39 e planejamento Fase 5), que sai do agente como JSON e não é
 * um enum do nosso domínio. `RunStatus` continua `SCREAMING_SNAKE_CASE`.
 */
export const RUN_RESULT_STATUS_VALUES = ["completed", "blocked", "failed"] as const;

export const RunResultStatusSchema = z.enum(RUN_RESULT_STATUS_VALUES).meta({
  id: "RunResultStatus",
  description: "O veredito do agente sobre a Task. Decide para onde a Task vai.",
});

export type RunResultStatus = z.infer<typeof RunResultStatusSchema>;

/**
 * O resultado de um Run bem-sucedido.
 *
 * Um Run pode terminar em `SUCCEEDED` — a execução correu — e ainda assim o
 * agente reportar que a Task ficou `blocked` ou `failed`. São duas perguntas
 * diferentes: "o processo terminou bem?" e "o trabalho ficou pronto?".
 *
 * O objeto é aberto (`loose`) porque o schema completo de `TaskExecutionResult`
 * — artefatos, tarefas descobertas, candidatos a conhecimento — chega nas Fases
 * 5 e 6. Fechá-lo agora faria a API descartar em silêncio campos que o worker
 * já sabe produzir.
 */
export const RunResultSchema = z
  .looseObject({
    status: RunResultStatusSchema,
    summary: z.string().optional().describe("Resumo do que foi feito, escrito pelo agente."),
    warnings: z.array(z.string()).optional(),
    usage: z
      .looseObject({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
      })
      .optional()
      .describe("Consumo reportado pelo harness, quando houver."),
    output: z.unknown().optional().describe("Structured output validado pelo schema do harness."),
  })
  .meta({ id: "RunResult", description: "O resultado estruturado de um Run." });

export type RunResult = z.infer<typeof RunResultSchema>;

export const RunErrorSchema = z
  .looseObject({
    code: z.string().optional().describe("Código estável do erro, quando houver um."),
    message: z.string().describe("Mensagem já sanitizada de credenciais."),
    details: z.unknown().optional(),
  })
  .meta({ id: "RunError", description: "Por que um Run terminou em FAILED ou TIMED_OUT." });

export type RunError = z.infer<typeof RunErrorSchema>;

export const RUN_PROMPT_MAX_LENGTH = 100_000;

export const RunSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do Run."),
    taskId: z.uuid().describe("A Task que este Run tenta realizar."),
    projectId: z
      .uuid()
      .nullable()
      .describe("Project da Task no momento da leitura. Vem por junção, não é coluna do Run."),
    status: RunStatusSchema,
    harnessKey: HarnessKeySchema.describe("Harness escolhido, copiado do Loadout."),
    harnessVersion: z
      .string()
      .nullable()
      .describe("Versão da CLI descoberta no preflight. Nula até o Run preparar."),
    harnessSessionId: z
      .string()
      .nullable()
      .describe(
        "Id de sessão emitido pelo harness, guardado junto do harness emissor: " +
          "as semânticas de resume diferem entre Claude Code, Codex, Pi e Antigravity.",
      ),
    modelKey: z.string().nullable().describe("Chave do Model usada, copiada do Loadout."),
    executionMode: ExecutionModeSchema,
    workspacePath: z
      .string()
      .nullable()
      .describe("Caminho do checkout usado. É a base da trava por caminho."),
    workflowVersionId: z
      .uuid()
      .nullable()
      .describe("Captura congelada do Workflow. Sempre nulo até a Fase 4."),
    resumedFromRunId: z
      .uuid()
      .nullable()
      .describe("Run de onde a sessão do harness foi retomada. Nulo num Run que começou do zero."),
    loadoutId: z.uuid(),
    loadoutVersion: z
      .number()
      .int()
      .positive()
      .describe("Versão do Loadout no instante da criação."),
    loadoutSnapshot: LoadoutSnapshotSchema,
    executionProfileSnapshot: ExecutionProfileSnapshotSchema,
    prompt: z.string().describe("O prompt enviado ao harness."),
    attempt: z.number().int().positive().describe("N-ésimo Run desta Task, começando em 1."),
    startedAt: z.iso.datetime().nullable().describe("Entrada em `RUNNING`, em UTC (ISO 8601)."),
    finishedAt: z.iso.datetime().nullable().describe("Entrada em estado terminal, em UTC."),
    cancelRequestedAt: z.iso
      .datetime()
      .nullable()
      .describe(
        "Instante do pedido de cancelamento. Marcar aqui não muda o status: " +
          "quem transiciona é quem confirma o término da árvore de processos.",
      ),
    result: RunResultSchema.nullable(),
    error: RunErrorSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Run", description: "Uma tentativa concreta de realizar uma Task." });

export type Run = z.infer<typeof RunSchema>;

export const CreateRunSchema = z
  .object({
    loadoutId: z
      .uuid()
      .optional()
      .describe(
        "Equipamento do Run. Decide Agent, Harness e Model. " +
          "Só pode faltar quando `resumeFromRunId` estiver presente: aí o Loadout é o do Run de origem.",
      ),
    executionProfileId: z
      .uuid()
      .optional()
      .describe("Sobrepõe o ExecutionProfile do Loadout, sem alterar o Loadout."),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(RUN_PROMPT_MAX_LENGTH)
      .optional()
      .describe("Ausente monta o prompt a partir do título e da descrição da Task."),
    resumeFromRunId: z
      .uuid()
      .optional()
      .describe(
        "Retoma a sessão do harness deste Run. Exige que ele tenha `harnessSessionId` " +
          "capturado e que o Harness declare a capability `resume`. Loadout e " +
          "ExecutionProfile são copiados dele quando não vierem no corpo.",
      ),
  })
  // A exigência de "um dos dois" não é um `refine` de propósito: um refinamento
  // vira `ZodCustom` e some da spec OpenAPI, que só sabe descrever a forma. A
  // regra mora no repositório, junto das outras recusas de criação de Run, e
  // sai como `409` com o código explicando qual campo faltou.
  .meta({ id: "CreateRun", description: "Corpo de `POST /api/v1/tasks/{id}/runs`." });

export type CreateRun = z.infer<typeof CreateRunSchema>;

/** `?status=RUNNING&status=QUEUED` chega como array; `?status=RUNNING` como texto. */
export const RunStatusFilterSchema = z
  .union([RunStatusSchema, z.array(RunStatusSchema)])
  .optional()
  .describe("Filtra por um estado ou por vários, repetindo o parâmetro.");

export const RunListQuerySchema = PageQuerySchema.extend({
  taskId: z.uuid().optional().describe("Só os Runs desta Task."),
  projectId: z.uuid().optional().describe("Só os Runs das Tasks deste Project."),
  status: RunStatusFilterSchema,
}).meta({ id: "RunListQuery" });

export type RunListQuery = z.infer<typeof RunListQuerySchema>;

export const RunPageSchema = paginatedSchema(
  RunSchema,
  "RunPage",
  "Uma página de Runs, do mais recente para o mais antigo.",
);

export type RunPage = z.infer<typeof RunPageSchema>;

// --------------------------------------------------------------------------
// RunEvent
// --------------------------------------------------------------------------

/**
 * O log append-only de uma execução (documento técnico, seção 11).
 *
 * Estado de domínio continua mutável; o que é imutável é a história. `sequence`
 * é único por Run e **sem lacunas**: é o cursor que o browser devolve ao
 * reconectar, e uma lacuna deixaria o drain esperando por um evento que nunca
 * existiu.
 *
 * `type` é `string` e `payload` é `unknown` de propósito: quem lê o stream
 * precisa tolerar um tipo de evento que ainda não conhece, do mesmo jeito que
 * no `DashboardEvent`. O vocabulário canônico de eventos de execução é o
 * `ExecutionEvent` do runtime, e é ele quem fecha o conjunto na escrita.
 */
export const RunEventSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da linha."),
    runId: z.uuid(),
    sequence: z
      .number()
      .int()
      .positive()
      .describe("Posição dentro do Run, começando em 1. Estritamente crescente e sem lacunas."),
    type: z.string().describe("Tipo do evento, no vocabulário do `ExecutionEvent`."),
    timestamp: z.iso.datetime().describe("Quando o fato aconteceu, em UTC (ISO 8601)."),
    payload: z.unknown().describe("Dados do evento, já sanitizados de credenciais."),
  })
  .meta({ id: "RunEvent", description: "Uma linha do log append-only de um Run." });

export type RunEvent = z.infer<typeof RunEventSchema>;

/** Teto de eventos por leitura, igual ao do repositório de eventos de dashboard. */
export const RUN_EVENT_PAGE_LIMIT = 500;

export const RunEventListQuerySchema = z
  .object({
    after: z
      .string()
      .max(19)
      .regex(/^\d+$/, "O cursor é um inteiro não negativo em base decimal.")
      .optional()
      .describe("Devolve apenas eventos com `sequence` maior que este. Padrão: 0."),
    limit: z
      .string()
      .regex(/^[1-9]\d{0,3}$/, "O limite é um inteiro positivo em base decimal.")
      .optional()
      .describe(
        `Quantos eventos trazer. Padrão e teto: ${String(RUN_EVENT_PAGE_LIMIT)}. ` +
          "Valores acima do teto são reduzidos.",
      ),
  })
  .meta({ id: "RunEventListQuery" });

export type RunEventListQuery = z.infer<typeof RunEventListQuerySchema>;

export const RunEventListSchema = z
  .object({
    items: z.array(RunEventSchema).describe("Os eventos, em ordem crescente de `sequence`."),
    /**
     * Não é `total`: contar o log inteiro a cada página custaria uma varredura
     * por leitura em um Run longo, e a tela não usa o total — ela avança pelo
     * cursor até `hasMore` ficar falso e depois abre o stream.
     */
    hasMore: z.boolean().describe("Verdadeiro quando ainda há eventos depois desta página."),
    lastSequence: z
      .number()
      .int()
      .nonnegative()
      .describe("Maior `sequence` desta página, ou o `after` pedido quando ela veio vazia."),
  })
  .meta({ id: "RunEventList", description: "Uma página do log de eventos de um Run." });

export type RunEventList = z.infer<typeof RunEventListSchema>;

/** Canal de `LISTEN`/`NOTIFY` de `run_event`. O `NOTIFY` não carrega payload. */
export const RUN_EVENT_CHANNEL = "dm_run_event" as const;

/**
 * Canal que avisa o Worker de que há Run novo na fila.
 *
 * Sem payload, como todos: ele só acorda o `claimNextQueuedRun` antes do
 * próximo tique. É o que faz um Run criado pela API começar em milissegundos
 * em vez de esperar o intervalo do laço.
 */
export const RUN_QUEUE_CHANNEL = "dm_run_queue" as const;

/**
 * Canal que avisa o Worker de um pedido de cancelamento.
 *
 * Também sem payload: o Worker consulta `cancel_requested_at` dos Runs que ele
 * mesmo tem em voo. Mandar o id no payload obrigaria a tratar notificação
 * perdida ou coalescida como cancelamento perdido, e a consulta por cursor já
 * é a autoridade.
 */
export const RUN_CANCEL_CHANNEL = "dm_run_cancel" as const;
