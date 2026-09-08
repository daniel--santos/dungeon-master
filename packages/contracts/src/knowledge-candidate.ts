import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * KnowledgeCandidate: o que um agente aprendeu e ainda não foi destilado
 * (documento técnico, seções 21 e 35).
 *
 * Nasce dos `knowledgeCandidates` do `TaskExecutionResult` e é gravado **na
 * mesma transação** que `run.result` e o status terminal do Run. Assíncrono
 * não significa fire-and-forget: o Distiller da Fase 6 consome esta tabela a
 * partir do banco, sob advisory lock por Project, e marca cada candidato como
 * promovido ou rejeitado. Uma falha do Distiller nunca perde um candidato; ele
 * apenas fica `PENDING`.
 *
 * Nesta fase o candidato é **só leitura** pela API: a promoção a
 * `KnowledgeItem` é trabalho da Fase 6.
 */

export const KNOWLEDGE_CANDIDATE_STATUS_VALUES = ["PENDING", "PROMOTED", "REJECTED"] as const;

export const KnowledgeCandidateStatusSchema = z.enum(KNOWLEDGE_CANDIDATE_STATUS_VALUES).meta({
  id: "KnowledgeCandidateStatus",
  description: "Estado de um KnowledgeCandidate no pipeline de destilação.",
});

export type KnowledgeCandidateStatus = z.infer<typeof KnowledgeCandidateStatusSchema>;

export const KnowledgeCandidateSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do candidato."),
    projectId: z.uuid().describe("Project em cujo Grimório o candidato pode entrar."),
    taskId: z.uuid().describe("A Task cujo Run aprendeu isto."),
    runId: z.uuid().describe("O Run cujo resultado trouxe o candidato."),
    title: z.string().describe("Título do que foi aprendido."),
    content: z.string().describe("O aprendizado, escrito para ser lido depois."),
    kind: z
      .string()
      .nullable()
      .describe("Classificação livre dada pelo agente: `convention`, `gotcha`, `howto`."),
    status: KnowledgeCandidateStatusSchema,
    createdAt: z.iso
      .datetime()
      .describe("Gravação, em UTC (ISO 8601): o instante do desfecho do Run."),
  })
  .meta({
    id: "KnowledgeCandidate",
    description: "Um candidato a item de conhecimento do Project.",
  });

export type KnowledgeCandidate = z.infer<typeof KnowledgeCandidateSchema>;

export const KnowledgeCandidateListQuerySchema = PageQuerySchema.extend({
  projectId: z.uuid().optional().describe("Só os candidatos deste Project."),
  status: KnowledgeCandidateStatusSchema.optional().describe("Só os candidatos neste estado."),
  taskId: z.uuid().optional().describe("Só os candidatos desta Task."),
  runId: z.uuid().optional().describe("Só os candidatos deste Run."),
}).meta({ id: "KnowledgeCandidateListQuery" });

export type KnowledgeCandidateListQuery = z.infer<typeof KnowledgeCandidateListQuerySchema>;

export const KnowledgeCandidatePageSchema = paginatedSchema(
  KnowledgeCandidateSchema,
  "KnowledgeCandidatePage",
  "Uma página de candidatos, do mais recente para o mais antigo.",
);

export type KnowledgeCandidatePage = z.infer<typeof KnowledgeCandidatePageSchema>;
