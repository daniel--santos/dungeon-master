import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";
import { RuleConditionsSchema, RulePrioritySchema } from "./rule-condition.js";

/**
 * RoutingRule: uma regra que escolhe Model, Loadout ou Workflow por condições
 * (planejamento v0.4, Fase 9: "dynamic workflow e loadout selection", "model
 * routing").
 *
 * O alvo é um id do registro correspondente, com fallbacks ordenados: o
 * primeiro alvo válido no contexto vence (um Model precisa pertencer ao
 * Harness do Loadout; um Loadout ou Workflow precisa existir). Sem regra que
 * case, ou sem alvo válido, vale o padrão do sistema, e a decisão diz isso.
 *
 * `POST /tasks/{id}/suggestions` avalia as três espécies; `POST /runs` avalia
 * só `MODEL`, e só quando o Loadout deixa o Model nulo — um Model escolhido
 * no Loadout é uma decisão humana que o roteamento não sobrescreve. A pressão
 * de orçamento é uma condição disponível, para preferir um Model mais barato
 * quando a janela está a 80% do teto.
 */

export const ROUTING_KIND_VALUES = ["MODEL", "LOADOUT", "WORKFLOW"] as const;

export const RoutingKindSchema = z.enum(ROUTING_KIND_VALUES).meta({
  id: "RoutingKind",
  description: "O que a regra escolhe: um Model, um Loadout ou um Workflow.",
});

export type RoutingKind = z.infer<typeof RoutingKindSchema>;

export const ROUTING_RULE_NAME_MAX_LENGTH = 200;
export const ROUTING_FALLBACKS_MAX = 10;

const NameSchema = z.string().trim().min(1).max(ROUTING_RULE_NAME_MAX_LENGTH);

export const RoutingRuleSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da regra."),
    name: z.string(),
    kind: RoutingKindSchema,
    projectId: z.uuid().nullable().describe("Nulo é uma regra global."),
    priority: RulePrioritySchema,
    conditions: RuleConditionsSchema,
    targetId: z.uuid().describe("O alvo preferido: id de Model, Loadout ou Workflow."),
    fallbackIds: z.array(z.uuid()).describe("Alvos tentados em ordem quando o preferido não serve."),
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "RoutingRule", description: "Uma regra de roteamento por condições." });

export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

export const CreateRoutingRuleSchema = z
  .object({
    name: NameSchema,
    kind: RoutingKindSchema,
    projectId: z.uuid().nullish().describe("Ausente ou nulo cria uma regra global."),
    priority: RulePrioritySchema.optional().describe("Padrão: `100`."),
    conditions: RuleConditionsSchema.optional().describe("Ausente é `{}`: casa com tudo."),
    targetId: z.uuid(),
    fallbackIds: z.array(z.uuid()).max(ROUTING_FALLBACKS_MAX).optional(),
    enabled: z.boolean().optional().describe("Padrão: ligada."),
  })
  .meta({ id: "CreateRoutingRule", description: "Corpo de `POST /api/v1/routing-rules`." });

export type CreateRoutingRule = z.infer<typeof CreateRoutingRuleSchema>;

export const UpdateRoutingRuleSchema = z
  .object({
    name: NameSchema.optional(),
    projectId: z.uuid().nullish(),
    priority: RulePrioritySchema.optional(),
    conditions: RuleConditionsSchema.optional(),
    targetId: z.uuid().optional(),
    fallbackIds: z.array(z.uuid()).max(ROUTING_FALLBACKS_MAX).optional(),
    enabled: z.boolean().optional(),
  })
  .meta({
    id: "UpdateRoutingRule",
    description: "Corpo de `PATCH /api/v1/routing-rules/{id}`. `kind` não muda.",
  });

export type UpdateRoutingRule = z.infer<typeof UpdateRoutingRuleSchema>;

export const RoutingRuleListQuerySchema = PageQuerySchema.extend({
  kind: RoutingKindSchema.optional(),
  projectId: z.uuid().optional().describe("Só as regras deste Project, mais as globais."),
}).meta({ id: "RoutingRuleListQuery" });

export type RoutingRuleListQuery = z.infer<typeof RoutingRuleListQuerySchema>;

export const RoutingRulePageSchema = paginatedSchema(
  RoutingRuleSchema,
  "RoutingRulePage",
  "Uma página de regras de roteamento, da maior prioridade para a menor.",
);

export type RoutingRulePage = z.infer<typeof RoutingRulePageSchema>;

// --------------------------------------------------------------------------
// A decisão
// --------------------------------------------------------------------------

export const RoutingAttemptSchema = z
  .object({
    targetId: z.uuid(),
    accepted: z.boolean(),
    reason: z.string().describe("Por que o alvo serviu ou não."),
  })
  .meta({ id: "RoutingAttempt", description: "Um alvo tentado pelo roteamento." });

export type RoutingAttempt = z.infer<typeof RoutingAttemptSchema>;

export const RoutingDecisionSchema = z
  .object({
    kind: RoutingKindSchema,
    selectedId: z.uuid().nullable().describe("O alvo escolhido. Nulo quando não há padrão."),
    selectedName: z.string().nullable().describe("Nome (ou chave, num Model) do escolhido."),
    ruleId: z.uuid().nullable(),
    decidedBy: z.string().describe("`ROUTING:<id>`, `DEFAULT` ou `TIE:<id>,<id>`."),
    reason: z.string(),
    attempts: z.array(RoutingAttemptSchema).describe("Alvo preferido e fallbacks, na ordem."),
  })
  .meta({ id: "RoutingDecision", description: "Uma escolha do roteamento, auditável." });

export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
