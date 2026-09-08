import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * KnowledgeCandidate: o que um agente aprendeu e ainda não foi destilado
 * (documento técnico, seções 21 e 35).
 *
 * Nasce dos `knowledgeCandidates` e das `decisions` do `TaskExecutionResult`
 * e é gravado **na mesma transação** que `run.result` e o status terminal do
 * Run. Assíncrono não significa fire-and-forget: o Distiller da Fase 6
 * consome esta tabela a partir do banco, sob advisory lock por Project, e
 * marca cada candidato como promovido, rejeitado ou mesclado num item que já
 * existia. Uma falha do Distiller nunca perde um candidato; ele apenas fica
 * `PENDING`, e o erro fica registrado no `DistillationRun`.
 */

export const KNOWLEDGE_CANDIDATE_STATUS_VALUES = [
  "PENDING",
  "PROMOTED",
  "REJECTED",
  "MERGED",
] as const;

export const KnowledgeCandidateStatusSchema = z.enum(KNOWLEDGE_CANDIDATE_STATUS_VALUES).meta({
  id: "KnowledgeCandidateStatus",
  description:
    "Estado de um KnowledgeCandidate no pipeline de destilação. `MERGED` é a duplicata " +
    "de um item que o Grimório já tinha.",
});

export type KnowledgeCandidateStatus = z.infer<typeof KnowledgeCandidateStatusSchema>;

/**
 * O veredito do Distiller sobre um candidato.
 *
 * Separado de `status` de propósito: `status` é o ciclo de vida da linha, e a
 * decisão é o que o Distiller concluiu — inclusive quando a regra decidiu sem
 * consultar o modelo (um candidato vazio depois do filtro de ruído é
 * `REJECT` por regra). Nulo enquanto `PENDING`.
 */
export const KNOWLEDGE_CANDIDATE_DECISION_VALUES = ["PROMOTE", "REJECT", "MERGE"] as const;

export const KnowledgeCandidateDecisionSchema = z
  .enum(KNOWLEDGE_CANDIDATE_DECISION_VALUES)
  .meta({ id: "KnowledgeCandidateDecision", description: "O veredito do Distiller." });

export type KnowledgeCandidateDecision = z.infer<typeof KnowledgeCandidateDecisionSchema>;

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
      .describe(
        "Classificação livre dada pelo agente: `convention`, `gotcha`, `howto`. Uma " +
          "`decision` do resultado chega com `kind` = `decision`.",
      ),
    status: KnowledgeCandidateStatusSchema,
    decision: KnowledgeCandidateDecisionSchema.nullable().describe(
      "O veredito do Distiller. Nulo enquanto `PENDING`.",
    ),
    reason: z
      .string()
      .nullable()
      .describe("Por que o Distiller decidiu assim, em uma linha. Nulo enquanto `PENDING`."),
    knowledgeItemId: z
      .uuid()
      .nullable()
      .describe(
        "O item do Grimório que o candidato virou (`PROMOTED`) ou em que foi mesclado " +
          "(`MERGED`). Nulo nos demais casos.",
      ),
    distillationRunId: z
      .uuid()
      .nullable()
      .describe("O lote do Distiller que decidiu. Nulo enquanto `PENDING`."),
    processedAt: z.iso
      .datetime()
      .nullable()
      .describe("Quando a decisão foi gravada, em UTC. Nulo enquanto `PENDING`."),
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

/**
 * O `kind` com que uma `decision` do resultado do Run entra como candidato.
 *
 * O agente escreve `decisions: [{ summary, rationale }]`; o desfecho grava
 * cada uma como candidato com este `kind`, e o Distiller a promove como item
 * `DECISION`. É uma constante de contrato porque os dois lados — quem grava e
 * quem destila — precisam concordar sobre a mesma palavra.
 */
export const DECISION_CANDIDATE_KIND = "decision" as const;
