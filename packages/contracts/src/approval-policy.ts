import { z } from "zod";

import { AutonomyLevelSchema } from "./autonomy.js";
import { PageQuerySchema, paginatedSchema } from "./pagination.js";
import { RuleConditionsSchema, RulePrioritySchema } from "./rule-condition.js";

/**
 * ApprovalPolicy: uma regra que decide, sem humano, o que fazer com um pedido
 * de aprovação (documento técnico, seção 26; planejamento v0.4, Fase 9).
 *
 * Três assuntos, um por `subject`: uma **proposta** de Task vinda do resultado
 * de um Run, a **partida** de um Run, e um **gate** de Workflow. As condições
 * são o vocabulário fechado de `RuleConditions`; a ação é uma de três. A regra
 * de maior prioridade que casa decide; sem regra que case, ou com empate, a
 * decisão é revisão humana. Uma política `AUTO_APPROVE` só produz efeito se o
 * nível de autonomia do Project permitir: o domínio é a única fonte dessa
 * verdade, e a decisão devolvida diz o que a política queria e o que valeu.
 *
 * `projectId` nulo é uma política global, avaliada em todo Project junto das
 * políticas dele.
 */

export const POLICY_SUBJECT_VALUES = ["PROPOSAL", "RUN_START", "GATE"] as const;

export const PolicySubjectSchema = z.enum(POLICY_SUBJECT_VALUES).meta({
  id: "PolicySubject",
  description:
    "`PROPOSAL` decide uma proposta de Task; `RUN_START` a partida de um Run; `GATE` um ApprovalGate.",
});

export type PolicySubject = z.infer<typeof PolicySubjectSchema>;

export const POLICY_ACTION_VALUES = ["REQUIRE_APPROVAL", "AUTO_APPROVE", "DENY"] as const;

export const PolicyActionSchema = z.enum(POLICY_ACTION_VALUES).meta({
  id: "PolicyAction",
  description: "`REQUIRE_APPROVAL` é revisão humana; `AUTO_APPROVE` decide sim; `DENY` decide não.",
});

export type PolicyAction = z.infer<typeof PolicyActionSchema>;

export const POLICY_NAME_MAX_LENGTH = 200;

const NameSchema = z.string().trim().min(1).max(POLICY_NAME_MAX_LENGTH);

export const ApprovalPolicySchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da política."),
    name: z.string(),
    subject: PolicySubjectSchema,
    projectId: z.uuid().nullable().describe("Nulo é uma política global."),
    priority: RulePrioritySchema,
    conditions: RuleConditionsSchema,
    action: PolicyActionSchema,
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "ApprovalPolicy", description: "Uma regra de aprovação automática." });

export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

export const CreateApprovalPolicySchema = z
  .object({
    name: NameSchema,
    subject: PolicySubjectSchema,
    projectId: z.uuid().nullish().describe("Ausente ou nulo cria uma política global."),
    priority: RulePrioritySchema.optional().describe("Padrão: `100`."),
    conditions: RuleConditionsSchema.optional().describe("Ausente é `{}`: casa com tudo."),
    action: PolicyActionSchema,
    enabled: z.boolean().optional().describe("Padrão: ligada."),
  })
  .meta({ id: "CreateApprovalPolicy", description: "Corpo de `POST /api/v1/approval-policies`." });

export type CreateApprovalPolicy = z.infer<typeof CreateApprovalPolicySchema>;

export const UpdateApprovalPolicySchema = z
  .object({
    name: NameSchema.optional(),
    subject: PolicySubjectSchema.optional(),
    projectId: z.uuid().nullish(),
    priority: RulePrioritySchema.optional(),
    conditions: RuleConditionsSchema.optional(),
    action: PolicyActionSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .meta({
    id: "UpdateApprovalPolicy",
    description: "Corpo de `PATCH /api/v1/approval-policies/{id}`.",
  });

export type UpdateApprovalPolicy = z.infer<typeof UpdateApprovalPolicySchema>;

export const ApprovalPolicyListQuerySchema = PageQuerySchema.extend({
  projectId: z
    .uuid()
    .optional()
    .describe("Só as políticas deste Project, mais as globais."),
  subject: PolicySubjectSchema.optional(),
}).meta({ id: "ApprovalPolicyListQuery" });

export type ApprovalPolicyListQuery = z.infer<typeof ApprovalPolicyListQuerySchema>;

export const ApprovalPolicyPageSchema = paginatedSchema(
  ApprovalPolicySchema,
  "ApprovalPolicyPage",
  "Uma página de políticas, da maior prioridade para a menor.",
);

export type ApprovalPolicyPage = z.infer<typeof ApprovalPolicyPageSchema>;

// --------------------------------------------------------------------------
// A decisão
// --------------------------------------------------------------------------

/**
 * Quem decidiu, num prefixo estável: `POLICY:<id>` quando uma regra casou,
 * `DEFAULT` quando nenhuma casou, `TIE` quando duas de mesma prioridade
 * discordaram, `AUTONOMY` quando o nível do Project rebaixou um
 * `AUTO_APPROVE` para revisão humana.
 */
export const POLICY_DECIDER_VALUES = ["POLICY", "DEFAULT", "TIE", "AUTONOMY"] as const;

export const PolicyDecisionSchema = z
  .object({
    subject: PolicySubjectSchema,
    action: PolicyActionSchema.describe("A ação **efetiva**, depois do nível de autonomia."),
    policyId: z.uuid().nullable().describe("A política que casou, quando alguma casou."),
    policyAction: PolicyActionSchema.nullable().describe(
      "O que a política que casou pedia. Difere de `action` quando a autonomia rebaixou.",
    ),
    decidedBy: z
      .string()
      .describe("`POLICY:<id>`, `DEFAULT`, `TIE:<id>,<id>` ou `AUTONOMY:<nível>`."),
    autonomyLevel: AutonomyLevelSchema,
    reason: z.string().describe("A frase canônica do domínio, em português."),
    decidedAt: z.iso.datetime(),
  })
  .meta({ id: "PolicyDecision", description: "Uma decisão automática de aprovação, auditável." });

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
