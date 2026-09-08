import { z } from "zod";

import { UsageSummarySchema } from "./execution-event.js";
import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * KnowledgeItem: uma página do Grimório do Project (planejamento v0.4, Fase 6).
 *
 * Nasce da destilação de um ou mais `KnowledgeCandidate`s, feita pelo
 * Distiller sob advisory lock por Project, ou — no caso do `SUMMARY` — da
 * consolidação dos itens ativos. Todo texto aqui foi escrito por um modelo e
 * passou por `escapeXmlTags` antes de persistir; nesta fase ele nunca volta a
 * um prompt (a reinjeção é assunto do Context Engine da Fase 7).
 *
 * Com `knowledge.humanReview` ligado, que é o padrão, todo item promovido
 * nasce em `PENDING_REVIEW` e só o usuário o torna `ACTIVE`. A decisão é um
 * CAS, como a do ApprovalGate e a da ProposedTask: quem perde a corrida recebe
 * `409` com o item como ficou.
 */

/** Os seis tipos fechados da Fase 6. */
export const KNOWLEDGE_ITEM_TYPE_VALUES = [
  "FACT",
  "DECISION",
  "DISCOVERY",
  "CONSTRAINT",
  "PROCEDURE",
  "SUMMARY",
] as const;

export const KnowledgeItemTypeSchema = z.enum(KNOWLEDGE_ITEM_TYPE_VALUES).meta({
  id: "KnowledgeItemType",
  description:
    "Tipo fechado do item: fato, decisão, descoberta, restrição, procedimento ou o " +
    "resumo corrente do Project.",
});

export type KnowledgeItemType = z.infer<typeof KnowledgeItemTypeSchema>;

export const KNOWLEDGE_ITEM_STATUS_VALUES = [
  "PENDING_REVIEW",
  "ACTIVE",
  "REJECTED",
  "ARCHIVED",
] as const;

export const KnowledgeItemStatusSchema = z.enum(KNOWLEDGE_ITEM_STATUS_VALUES).meta({
  id: "KnowledgeItemStatus",
  description:
    "`PENDING_REVIEW` espera o usuário; `ACTIVE` está no Grimório; `REJECTED` foi " +
    "recusado na revisão; `ARCHIVED` saiu do Grimório depois de ativo.",
});

export type KnowledgeItemStatus = z.infer<typeof KnowledgeItemStatusSchema>;

/**
 * De onde o item veio.
 *
 * Guarda o suficiente para responder "quem escreveu isto e com base em quê":
 * o candidato e o Run de origem, o lote do Distiller, a sessão do harness
 * que escreveu o texto e o consumo de tokens. Um `SUMMARY` não tem candidato
 * nem Run; ele guarda os itens que cobriu.
 */
export const KnowledgeItemProvenanceSchema = z
  .object({
    candidateId: z.uuid().nullable().describe("O candidato que virou este item."),
    runId: z.uuid().nullable().describe("O Run cujo resultado trouxe o candidato."),
    taskId: z.uuid().nullable().describe("A Task daquele Run."),
    distillationRunId: z.uuid().nullable().describe("O lote do Distiller que escreveu o item."),
    harnessSessionId: z
      .string()
      .nullable()
      .describe("Sessão do harness que escreveu o texto, quando capturada."),
    usage: UsageSummarySchema.nullable().describe("Tokens gastos pelo lote que escreveu o item."),
    mergedCandidateIds: z
      .array(z.uuid())
      .describe("Candidatos posteriores mesclados neste item, na ordem em que chegaram."),
    coveredItemIds: z
      .array(z.uuid())
      .describe("Só no `SUMMARY`: os itens ativos que a consolidação cobriu."),
  })
  .meta({ id: "KnowledgeItemProvenance", description: "A proveniência de um item do Grimório." });

export type KnowledgeItemProvenance = z.infer<typeof KnowledgeItemProvenanceSchema>;

export const KNOWLEDGE_ITEM_TITLE_MAX_LENGTH = 200;
export const KNOWLEDGE_ITEM_CONTENT_MAX_LENGTH = 20_000;
export const KNOWLEDGE_ITEM_NOTE_MAX_LENGTH = 5_000;

export const KnowledgeItemSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do item."),
    projectId: z.uuid().describe("O Project cujo Grimório contém o item."),
    type: KnowledgeItemTypeSchema,
    status: KnowledgeItemStatusSchema,
    title: z.string().describe("Título, sanitizado."),
    content: z.string().describe("O conteúdo, sanitizado. Nunca volta a um prompt nesta fase."),
    provenance: KnowledgeItemProvenanceSchema,
    version: z
      .number()
      .int()
      .positive()
      .describe("Sobe a cada edição e a cada regeneração do `SUMMARY`."),
    reviewedAt: z.iso
      .datetime()
      .nullable()
      .describe("Quando o usuário aprovou ou recusou, em UTC. Nulo até a revisão."),
    reviewNote: z.string().nullable().describe("Justificativa de quem revisou, sanitizada."),
    archivedAt: z.iso.datetime().nullable().describe("Quando saiu do Grimório, em UTC."),
    createdAt: z.iso.datetime().describe("Gravação, em UTC (ISO 8601)."),
    updatedAt: z.iso.datetime().describe("Última escrita, em UTC (ISO 8601)."),
  })
  .meta({ id: "KnowledgeItem", description: "Uma página do Grimório do Project." });

export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;

/** Atalho de filtro sobre a revisão humana. */
export const KNOWLEDGE_REVIEW_FILTER_VALUES = ["pending", "reviewed"] as const;

export const KnowledgeReviewFilterSchema = z.enum(KNOWLEDGE_REVIEW_FILTER_VALUES).meta({
  id: "KnowledgeReviewFilter",
  description: "`pending` é o que espera o usuário; `reviewed` é o que já foi decidido.",
});

export type KnowledgeReviewFilter = z.infer<typeof KnowledgeReviewFilterSchema>;

export const KNOWLEDGE_SEARCH_MAX_LENGTH = 200;

export const KnowledgeItemListQuerySchema = PageQuerySchema.extend({
  type: KnowledgeItemTypeSchema.optional().describe("Só os itens deste tipo."),
  status: KnowledgeItemStatusSchema.optional().describe("Só os itens neste estado."),
  review: KnowledgeReviewFilterSchema.optional().describe("Só os pendentes, ou só os decididos."),
  q: z
    .string()
    .trim()
    .min(1)
    .max(KNOWLEDGE_SEARCH_MAX_LENGTH)
    .optional()
    .describe("Busca textual (FTS do PostgreSQL) sobre título e conteúdo."),
}).meta({ id: "KnowledgeItemListQuery" });

export type KnowledgeItemListQuery = z.infer<typeof KnowledgeItemListQuerySchema>;

export const KnowledgeItemPageSchema = paginatedSchema(
  KnowledgeItemSchema,
  "KnowledgeItemPage",
  "Uma página do Grimório, do item mais recente para o mais antigo (ou por relevância, com `q`).",
);

export type KnowledgeItemPage = z.infer<typeof KnowledgeItemPageSchema>;

const TitleSchema = z.string().trim().min(1).max(KNOWLEDGE_ITEM_TITLE_MAX_LENGTH);
const ContentSchema = z.string().trim().min(1).max(KNOWLEDGE_ITEM_CONTENT_MAX_LENGTH);

/**
 * Edição de um item pelo usuário.
 *
 * `type` não aceita `SUMMARY`: o resumo é regenerado pelo Distiller, e um item
 * comum que virasse `SUMMARY` seria um segundo resumo corrente. `archived`
 * verdadeiro leva um item `ACTIVE` a `ARCHIVED`; falso desarquiva.
 */
export const UpdateKnowledgeItemSchema = z
  .object({
    title: TitleSchema.optional(),
    content: ContentSchema.optional(),
    type: z
      .enum(["FACT", "DECISION", "DISCOVERY", "CONSTRAINT", "PROCEDURE"])
      .optional()
      .describe("Novo tipo. `SUMMARY` não é aceito: o resumo é regenerado pelo Distiller."),
    archived: z.boolean().optional().describe("Arquiva (`true`) ou desarquiva (`false`)."),
  })
  .meta({
    id: "UpdateKnowledgeItem",
    description: "Corpo de `PATCH /api/v1/knowledge-items/{id}`.",
  });

export type UpdateKnowledgeItem = z.infer<typeof UpdateKnowledgeItemSchema>;

export const ReviewKnowledgeItemSchema = z
  .object({
    note: z
      .string()
      .trim()
      .max(KNOWLEDGE_ITEM_NOTE_MAX_LENGTH)
      .optional()
      .describe("Justificativa da decisão. Fica no item."),
  })
  .meta({
    id: "ReviewKnowledgeItem",
    description: "Corpo de `POST /api/v1/knowledge-items/{id}/approve` e `/reject`.",
  });

export type ReviewKnowledgeItem = z.infer<typeof ReviewKnowledgeItemSchema>;

/**
 * O resumo corrente do Project, com o quanto ele está desatualizado.
 *
 * `item` é nulo enquanto o Distiller não consolidou nada. `promotedSinceSummary`
 * é o número de itens que ficaram ativos depois da última regeneração: é o
 * mesmo número que o gatilho de regeneração olha, exposto para a tela dizer
 * "o resumo não cobre N páginas novas".
 */
export const ProjectSummarySchema = z
  .object({
    projectId: z.uuid(),
    item: KnowledgeItemSchema.nullable().describe("O item `SUMMARY` corrente, ou nulo."),
    activeItemCount: z
      .number()
      .int()
      .nonnegative()
      .describe("Itens `ACTIVE` do Grimório, sem contar o próprio resumo."),
    promotedSinceSummary: z
      .number()
      .int()
      .nonnegative()
      .describe("Itens que ficaram ativos depois da última regeneração do resumo."),
  })
  .meta({ id: "ProjectSummary", description: "O resumo corrente do Project e o seu atraso." });

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const DecisionListQuerySchema = PageQuerySchema.extend({
  status: KnowledgeItemStatusSchema.optional().describe(
    "Só as decisões neste estado. Ausente lista `ACTIVE` e `PENDING_REVIEW`.",
  ),
}).meta({ id: "DecisionListQuery" });

export type DecisionListQuery = z.infer<typeof DecisionListQuerySchema>;

export const DecisionPageSchema = paginatedSchema(
  KnowledgeItemSchema,
  "DecisionPage",
  "As decisões do Project em ordem cronológica: da mais antiga para a mais recente.",
);

export type DecisionPage = z.infer<typeof DecisionPageSchema>;
