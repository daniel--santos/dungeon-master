import { z } from "zod";

import { EnforcementLevelSchema, ExecutionModeSchema } from "./execution-profile.js";
import { HarnessKeySchema } from "./harness.js";
import { TaskKindSchema, TaskPrioritySchema } from "./task.js";
import { WorkflowStepTypeSchema } from "./workflow-step-type.js";

/**
 * O vocabulário **fechado** de condições das regras da Fase 9A (planejamento
 * v0.4, Fase 9; documento técnico, seções 26 e 40).
 *
 * Políticas de aprovação e regras de roteamento são dados, como os Rituais:
 * condições nomeadas, sem expressão livre. Cada chave aqui é um fato que o
 * sistema sabe medir no instante da decisão — o modo de execução do perfil, o
 * Harness do Loadout, o tipo e a prioridade da Task, se o Loadout carrega
 * Tools de comando, o nível de enforcement, o tipo do step de um gate, uma
 * estimativa de tokens, o Loadout e o Project. Uma regra é uma **conjunção**:
 * todas as condições presentes precisam valer.
 *
 * O casamento é fail-closed no domínio: uma condição sobre um fato que o
 * contexto não conhece **não casa**. Uma regra que fale de `stepType` nunca
 * casa num `POST /runs`, onde não há step; uma que fale de `maxEstimatedTokens`
 * não casa quando ninguém estimou.
 *
 * As chaves de lista (`executionMode`, `harnessKey`, …) aceitam um valor ou
 * vários: vários é "qualquer um destes".
 */

function umOuVarios<T extends z.ZodType>(schema: T) {
  return z.union([schema, z.array(schema).min(1)]);
}

export const RULE_CONDITION_KEYS = [
  "executionMode",
  "harnessKey",
  "taskKind",
  "taskPriority",
  "hasCommandTools",
  "enforcement",
  "stepType",
  "maxEstimatedTokens",
  "loadoutId",
  "projectId",
  "minBudgetPressure",
] as const;

export type RuleConditionKey = (typeof RULE_CONDITION_KEYS)[number];

export const RuleConditionsSchema = z
  .strictObject({
    executionMode: umOuVarios(ExecutionModeSchema)
      .optional()
      .describe("O modo do ExecutionProfile do Run."),
    harnessKey: umOuVarios(HarnessKeySchema).optional().describe("O Harness do Loadout."),
    taskKind: umOuVarios(TaskKindSchema).optional().describe("A natureza da Task."),
    taskPriority: umOuVarios(TaskPrioritySchema).optional().describe("A prioridade da Task."),
    hasCommandTools: z
      .boolean()
      .optional()
      .describe("O snapshot do Loadout carrega pelo menos uma Tool `COMMAND`."),
    enforcement: umOuVarios(EnforcementLevelSchema)
      .optional()
      .describe("O nível de enforcement do ExecutionProfile."),
    stepType: umOuVarios(WorkflowStepTypeSchema)
      .optional()
      .describe("O tipo do step de Workflow. Só existe em decisões sobre um gate."),
    maxEstimatedTokens: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Casa quando a estimativa de tokens do pedido é menor ou igual a este teto."),
    loadoutId: umOuVarios(z.uuid()).optional().describe("O Loadout do Run."),
    projectId: umOuVarios(z.uuid()).optional().describe("O Project da Task."),
    minBudgetPressure: z
      .number()
      .min(0)
      .optional()
      .describe(
        "Casa quando a pressão de orçamento (razão consumo/limite mais alta entre os " +
          "orçamentos aplicáveis) é maior ou igual a este valor. `0.8` é 'a 80% de algum teto'.",
      ),
  })
  .meta({
    id: "RuleConditions",
    description:
      "As condições de uma política ou regra de roteamento: vocabulário fechado, conjunção.",
  });

export type RuleConditions = z.infer<typeof RuleConditionsSchema>;

/**
 * Os fatos medidos no instante de uma decisão: o outro lado das condições.
 *
 * Todo campo é opcional porque nem todo contexto conhece todo fato. O domínio
 * trata fato ausente como condição que não casa.
 */
export const RuleFactsSchema = z
  .object({
    executionMode: ExecutionModeSchema.optional(),
    harnessKey: HarnessKeySchema.optional(),
    taskKind: TaskKindSchema.optional(),
    taskPriority: TaskPrioritySchema.optional(),
    hasCommandTools: z.boolean().optional(),
    enforcement: EnforcementLevelSchema.optional(),
    stepType: WorkflowStepTypeSchema.optional(),
    estimatedTokens: z.number().int().nonnegative().optional(),
    loadoutId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    budgetPressure: z.number().min(0).optional(),
  })
  .meta({ id: "RuleFacts", description: "Os fatos contra os quais as condições são avaliadas." });

export type RuleFacts = z.infer<typeof RuleFactsSchema>;

/** Teto de prioridade. Inteiro; **maior vence**. */
export const RULE_PRIORITY_MAX = 1_000_000;

export const RulePrioritySchema = z
  .number()
  .int()
  .min(0)
  .max(RULE_PRIORITY_MAX)
  .describe("Prioridade explícita. A regra de maior prioridade que casa decide; empate é revisão humana.");
