import { z } from "zod";

import { ContextPolicySchema, KnowledgePolicySchema } from "./loadout.js";

/**
 * RunContext: o contexto que o Context Engine montou para um Run
 * (planejamento v0.4, Fase 7; documento técnico, seções 20.1 e 22).
 *
 * Montado **uma vez**, quando o Worker reclama o Run, e gravado antes da
 * primeira chamada ao agente. O Run simples e todos os passos de agente do
 * Workflow recebem o mesmo texto, e uma retomada relê o registro em vez de
 * montar de novo: é o que preserva o cache de prompt do provedor, que o
 * recall por turno do TencentDB destruía. O registro guarda o texto final, as
 * seções, cada item incluído com motivo, score e tokens, os excluídos por
 * orçamento, o orçamento e o uso, e a política aplicada com a origem dela.
 */

export const RUN_CONTEXT_STATUS_VALUES = ["ASSEMBLED", "EMPTY", "DISABLED", "FAILED"] as const;

export const RunContextStatusSchema = z.enum(RUN_CONTEXT_STATUS_VALUES).meta({
  id: "RunContextStatus",
  description:
    "`ASSEMBLED` tem texto; `EMPTY` montou e não achou nada; `DISABLED` a configuração " +
    "`context.enabled` estava desligada e o Loadout não tinha Habilidades (com Habilidades " +
    "elas entram, e o registro é `ASSEMBLED` com `policy.enabled` falso); `FAILED` a montagem " +
    "falhou e o Run seguiu sem contexto do Grimório — só com as Habilidades, quando há.",
});

export type RunContextStatus = z.infer<typeof RunContextStatusSchema>;

/** As seções, na ordem fixa em que aparecem no texto. */
export const CONTEXT_SECTION_KIND_VALUES = [
  "SUMMARY",
  "DECISIONS",
  "KNOWLEDGE",
  "LINEAGE",
  "ARTIFACTS",
  "SKILLS",
] as const;

export const ContextSectionKindSchema = z.enum(CONTEXT_SECTION_KIND_VALUES).meta({
  id: "ContextSectionKind",
  description:
    "Resumo do Project, decisões recentes, páginas relevantes, Task mãe e dependências, " +
    "artefatos de Runs anteriores e habilidades do Loadout.",
});

export type ContextSectionKind = z.infer<typeof ContextSectionKindSchema>;

export const CONTEXT_ITEM_KIND_VALUES = ["KNOWLEDGE_ITEM", "TASK", "ARTIFACT", "SKILL"] as const;

export const ContextItemKindSchema = z
  .enum(CONTEXT_ITEM_KIND_VALUES)
  .meta({ id: "ContextItemKind", description: "O tipo da entidade de origem de um item." });

export type ContextItemKind = z.infer<typeof ContextItemKindSchema>;

/** Por que um item entrou. Determinístico: nenhum motivo vem de um modelo. */
export const CONTEXT_ITEM_REASON_VALUES = [
  "PROJECT_SUMMARY",
  "RECENT_DECISION",
  "FTS_MATCH",
  "PARENT_TASK",
  "DEPENDENCY",
  "PRIOR_RUN_ARTIFACT",
  "PARENT_TASK_ARTIFACT",
  "LOADOUT_SKILL",
] as const;

export const ContextItemReasonSchema = z.enum(CONTEXT_ITEM_REASON_VALUES).meta({
  id: "ContextItemReason",
  description:
    "`FTS_MATCH` é a busca textual do PostgreSQL sobre título e descrição da Task; os " +
    "demais são regras fixas.",
});

export type ContextItemReason = z.infer<typeof ContextItemReasonSchema>;

export const CONTEXT_EXCLUSION_REASON_VALUES = ["SECTION_BUDGET", "TOTAL_BUDGET"] as const;

export const ContextExclusionReasonSchema = z.enum(CONTEXT_EXCLUSION_REASON_VALUES).meta({
  id: "ContextExclusionReason",
  description:
    "`SECTION_BUDGET` estourou o teto da seção; `TOTAL_BUDGET` foi cortado pela ordem de " +
    "prioridade para o total caber.",
});

export type ContextExclusionReason = z.infer<typeof ContextExclusionReasonSchema>;

export const ContextItemSchema = z
  .object({
    id: z
      .string()
      .describe(
        "Id da origem: o KnowledgeItem, a Task, `<runId>:<posição>` do artefato ou a Skill " +
          "(o nome, em Runs anteriores à Fase 8).",
      ),
    kind: ContextItemKindSchema,
    title: z.string().describe("Título, já sanitizado, como aparece no texto."),
    reason: ContextItemReasonSchema,
    score: z
      .number()
      .nullable()
      .describe("`ts_rank` do FTS, nos itens vindos da busca. Nulo nos demais."),
    tokens: z.number().int().nonnegative().describe("Estimativa rápida de tokens do trecho."),
    truncated: z.boolean().describe("O trecho foi cortado para caber no orçamento."),
  })
  .meta({ id: "ContextItem", description: "Um item incluído no contexto, com o motivo." });

export type ContextItem = z.infer<typeof ContextItemSchema>;

export const ContextSectionSchema = z
  .object({
    kind: ContextSectionKindSchema,
    title: z.string().describe("O cabeçalho fixo da seção no texto."),
    items: z.array(ContextItemSchema),
    tokens: z.number().int().nonnegative().describe("Tokens estimados da seção inteira."),
    budgetTokens: z.number().int().nonnegative().describe("Teto da seção, derivado do total."),
    truncated: z
      .boolean()
      .describe("Algum item foi cortado ou excluído desta seção por orçamento."),
  })
  .meta({ id: "ContextSection", description: "Uma seção do contexto montado." });

export type ContextSection = z.infer<typeof ContextSectionSchema>;

export const ContextExclusionSchema = z
  .object({
    section: ContextSectionKindSchema,
    item: ContextItemSchema,
    reason: ContextExclusionReasonSchema,
  })
  .meta({ id: "ContextExclusion", description: "Um item que ficou de fora por orçamento." });

export type ContextExclusion = z.infer<typeof ContextExclusionSchema>;

export const ContextBudgetSchema = z
  .object({
    totalTokens: z.number().int().nonnegative().describe("O orçamento total aplicado."),
    frameTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("Tokens reservados para a moldura fixa: preâmbulo e delimitadores."),
    summaryMinTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("Piso do resumo: o corte por prioridade nunca o leva abaixo disto."),
    sections: z
      .record(ContextSectionKindSchema, z.number().int().nonnegative())
      .describe("Teto por seção."),
  })
  .meta({ id: "ContextBudget", description: "O orçamento de tokens aplicado à montagem." });

export type ContextBudget = z.infer<typeof ContextBudgetSchema>;

export const ContextUsageSchema = z
  .object({
    estimatedTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("Tokens estimados do texto final, pelo estimador rápido."),
    itemCount: z.number().int().nonnegative().describe("Itens incluídos, somando as seções."),
    excludedCount: z.number().int().nonnegative().describe("Itens excluídos por orçamento."),
  })
  .meta({ id: "ContextUsage", description: "O que a montagem consumiu do orçamento." });

export type ContextUsage = z.infer<typeof ContextUsageSchema>;

/** As cinco configurações globais do Context Engine, como estavam na montagem. */
export const ContextSettingsSnapshotSchema = z
  .object({
    enabled: z.boolean(),
    budgetTokens: z.number().int().nonnegative(),
    maxKnowledgeItems: z.number().int().nonnegative(),
    maxDecisions: z.number().int().nonnegative(),
    maxArtifacts: z.number().int().nonnegative(),
  })
  .meta({ id: "ContextSettingsSnapshot" });

export type ContextSettingsSnapshot = z.infer<typeof ContextSettingsSnapshotSchema>;

/**
 * A política efetiva, e de onde ela veio.
 *
 * As configurações globais são o teto; o Loadout só aperta. `budgetTokens` é
 * o menor entre `context.budgetTokens` e o `maxTokens` da política de contexto
 * do Loadout (quando declarado); `maxKnowledgeItems` é o menor entre a
 * configuração e o `maxItems` da política de conhecimento, e `0` desliga as
 * páginas.
 */
export const RunContextPolicySchema = z
  .object({
    enabled: z.boolean(),
    budgetTokens: z.number().int().nonnegative(),
    maxKnowledgeItems: z.number().int().nonnegative(),
    maxDecisions: z.number().int().nonnegative(),
    maxArtifacts: z.number().int().nonnegative(),
    includeProjectSummary: z.boolean(),
    includeDecisions: z.boolean(),
    includeParentContext: z.boolean(),
    includeDependencyContext: z.boolean(),
    source: z.object({
      loadout: z.object({
        id: z.uuid(),
        version: z.number().int().positive(),
        knowledgePolicy: KnowledgePolicySchema,
        contextPolicy: ContextPolicySchema,
      }),
      settings: ContextSettingsSnapshotSchema,
    }),
  })
  .meta({ id: "RunContextPolicy", description: "A política aplicada e a origem dela." });

export type RunContextPolicy = z.infer<typeof RunContextPolicySchema>;

export const RunContextSchema = z
  .object({
    runId: z.uuid(),
    taskId: z.uuid(),
    projectId: z.uuid(),
    status: RunContextStatusSchema,
    text: z
      .string()
      .describe("O bloco exato inserido no prompt. Vazio quando o status não é `ASSEMBLED`."),
    query: z
      .string()
      .nullable()
      .describe("A consulta FTS derivada do título e da descrição da Task. Nula sem termos."),
    sections: z.array(ContextSectionSchema),
    excluded: z.array(ContextExclusionSchema),
    budget: ContextBudgetSchema,
    usage: ContextUsageSchema,
    policy: RunContextPolicySchema,
    inheritedFromRunId: z
      .uuid()
      .nullable()
      .describe(
        "Preenchido quando o Run retomou a sessão de outro e copiou o contexto dele, para a " +
          "conversa continuar com o mesmo texto.",
      ),
    error: z.string().nullable().describe("Por que a montagem falhou, em `FAILED`."),
    assembledAt: z.iso.datetime().describe("Instante da montagem, em UTC (ISO 8601)."),
    createdAt: z.iso.datetime().describe("Gravação, em UTC (ISO 8601)."),
  })
  .meta({ id: "RunContext", description: "O contexto montado para um Run, com o registro." });

export type RunContext = z.infer<typeof RunContextSchema>;
