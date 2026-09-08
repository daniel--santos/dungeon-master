import { z } from "zod";

import { UsageSummarySchema } from "./execution-event.js";
import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * DistillationRun: um lote do Distiller sobre os candidatos de um Project
 * (planejamento v0.4, Fase 6).
 *
 * Existe para que nenhum candidato seja perdido em silêncio (documento
 * técnico, seção 20.1, o retry morto do TencentDB): uma falha do modelo, do
 * harness ou do banco deixa os candidatos `PENDING` e fica registrada aqui,
 * com o erro, para o usuário ver e para o lote seguinte tentar de novo.
 */

export const DISTILLATION_RUN_STATUS_VALUES = ["RUNNING", "SUCCEEDED", "FAILED"] as const;

export const DistillationRunStatusSchema = z.enum(DISTILLATION_RUN_STATUS_VALUES).meta({
  id: "DistillationRunStatus",
  description: "Estado de um lote do Distiller.",
});

export type DistillationRunStatus = z.infer<typeof DistillationRunStatusSchema>;

/** O que acordou o lote. */
export const DISTILLATION_TRIGGER_VALUES = ["TIMER", "IDLE", "NOTIFY", "MANUAL"] as const;

export const DistillationTriggerSchema = z.enum(DISTILLATION_TRIGGER_VALUES).meta({
  id: "DistillationTrigger",
  description:
    "`TIMER` é o intervalo de `knowledge.distillEveryMinutes`; `IDLE` é a ociosidade " +
    "depois do último candidato; `NOTIFY` é um pedido explícito que chegou pelo canal " +
    "do banco; `MANUAL` é a API ou a linha de comando.",
});

export type DistillationTrigger = z.infer<typeof DistillationTriggerSchema>;

export const DistillationRunSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do lote."),
    projectId: z.uuid(),
    status: DistillationRunStatusSchema,
    trigger: DistillationTriggerSchema,
    loadoutId: z
      .uuid()
      .nullable()
      .describe("O Loadout do Escriba usado. Nulo quando o lote falhou antes de escolher um."),
    harnessSessionId: z
      .string()
      .nullable()
      .describe("Sessão do harness da chamada de destilação, quando capturada."),
    usage: UsageSummarySchema.nullable().describe("Tokens somados das chamadas do lote."),
    candidateCount: z.number().int().nonnegative().describe("Candidatos que o lote pegou."),
    promoted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    merged: z.number().int().nonnegative(),
    summaryRegenerated: z.boolean().describe("O `SUMMARY` do Project foi regenerado neste lote?"),
    forgedAchievementId: z
      .uuid()
      .nullable()
      .describe("A Conquista forjada que o lote propôs, quando houve resultado notável."),
    error: z
      .string()
      .nullable()
      .describe("Por que o lote falhou, sanitizado. Nulo em `RUNNING` e `SUCCEEDED`."),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "DistillationRun", description: "Um lote do Distiller sobre um Project." });

export type DistillationRun = z.infer<typeof DistillationRunSchema>;

export const DistillationRunListQuerySchema = PageQuerySchema.extend({
  projectId: z.uuid().optional().describe("Só os lotes deste Project."),
  status: DistillationRunStatusSchema.optional().describe("Só os lotes neste estado."),
}).meta({ id: "DistillationRunListQuery" });

export type DistillationRunListQuery = z.infer<typeof DistillationRunListQuerySchema>;

export const DistillationRunPageSchema = paginatedSchema(
  DistillationRunSchema,
  "DistillationRunPage",
  "Uma página de lotes, do mais recente para o mais antigo.",
);

export type DistillationRunPage = z.infer<typeof DistillationRunPageSchema>;

/**
 * Resposta de `POST /api/v1/projects/{id}/distill`.
 *
 * `202`: o pedido foi anotado e o Worker é acordado pelo canal do banco; o
 * lote roda lá, sob o advisory lock do Project, nunca dentro da requisição.
 * `pendingCandidates` é o que havia no instante do pedido, para a tela dizer
 * "não há nada a destilar" sem esperar um lote vazio.
 */
export const DistillationRequestedSchema = z
  .object({
    projectId: z.uuid(),
    pendingCandidates: z.number().int().nonnegative(),
    requestedAt: z.iso.datetime(),
  })
  .meta({
    id: "DistillationRequested",
    description: "O pedido de um lote foi aceito; o Worker o executa de forma assíncrona.",
  });

export type DistillationRequested = z.infer<typeof DistillationRequestedSchema>;

/** Canal de `LISTEN`/`NOTIFY` disparado pelo trigger de `knowledge_candidate`. Sem payload. */
export const KNOWLEDGE_CANDIDATE_CHANNEL = "dm_knowledge_candidate" as const;

/** Canal do pedido explícito de um lote (API e CLI). Sem payload. */
export const KNOWLEDGE_DISTILL_CHANNEL = "dm_knowledge_distill" as const;
