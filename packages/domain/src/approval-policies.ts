import type {
  ApprovalPolicy,
  AutomationKind,
  AutonomyLevel,
  PolicyAction,
  PolicyDecision,
  PolicySubject,
  RuleFacts,
} from "@dungeon-master/contracts";

import { allowsAutomation } from "./autonomy-levels.js";
import { selectRule, tieDecider } from "./rule-matching.js";

/**
 * A decisão de uma política de aprovação (documento técnico, seção 26;
 * planejamento v0.4, Fase 9A).
 *
 * Função pura sobre as políticas já lidas. Quem chama lê as políticas ligadas
 * do assunto — as do Project mais as globais — **na transação** que grava a
 * decisão, e passa os fatos medidos e o nível de autonomia do Project.
 *
 * Fail-closed: sem regra que case, revisão humana; empate, revisão humana; um
 * `AUTO_APPROVE` só vale se o nível do Project liberar a automação do assunto,
 * senão vira revisão humana e a decisão diz que foi a autonomia que rebaixou.
 * `DENY` nunca é rebaixado: recusar é sempre o lado seguro.
 *
 * As frases nascem aqui, e não na API, de propósito: a mesma frase vai ao
 * evento de painel, ao diário do Run e ao problem details.
 */

export type ApprovalPolicyRule = Pick<
  ApprovalPolicy,
  "id" | "name" | "subject" | "projectId" | "priority" | "conditions" | "action" | "enabled"
>;

export interface DecideApprovalInput {
  readonly subject: PolicySubject;
  readonly policies: readonly ApprovalPolicyRule[];
  readonly facts: RuleFacts;
  readonly autonomyLevel: AutonomyLevel;
  readonly now: Date;
}

/** Qual automação da escada cada assunto exige para um `AUTO_APPROVE` valer. */
export const AUTOMATION_FOR_SUBJECT = {
  PROPOSAL: "AUTO_APPROVE_PROPOSAL",
  RUN_START: "AUTO_DISPATCH",
  GATE: "AUTO_APPROVE_GATE",
} as const satisfies Record<PolicySubject, AutomationKind>;

const ASSUNTO = {
  PROPOSAL: "proposta de Task",
  RUN_START: "partida de Run",
  GATE: "gate de Workflow",
} as const satisfies Record<PolicySubject, string>;

function politica(rule: ApprovalPolicyRule): string {
  return `A política "${rule.name}" (${rule.id})`;
}

export function decideApproval(input: DecideApprovalInput): PolicyDecision {
  const { subject, autonomyLevel } = input;
  const decidedAt = input.now.toISOString();
  const doAssunto = input.policies.filter((policy) => policy.subject === subject);
  const escolha = selectRule(doAssunto, input.facts);

  if (escolha.outcome === "NONE") {
    return {
      subject,
      action: "REQUIRE_APPROVAL",
      policyId: null,
      policyAction: null,
      decidedBy: "DEFAULT",
      autonomyLevel,
      reason: `Nenhuma política de ${ASSUNTO[subject]} casou; revisão humana por padrão.`,
      decidedAt,
    };
  }

  if (escolha.outcome === "TIE") {
    const nomes = escolha.rules.map((rule) => `"${rule.name}" (${rule.id})`).join(", ");
    return {
      subject,
      action: "REQUIRE_APPROVAL",
      policyId: null,
      policyAction: null,
      decidedBy: tieDecider(escolha.rules),
      autonomyLevel,
      reason:
        `As políticas ${nomes} têm a mesma prioridade (${String(escolha.priority)}) e casam ` +
        "ao mesmo tempo; revisão humana por empate.",
      decidedAt,
    };
  }

  const { rule } = escolha;
  const base = {
    subject,
    policyId: rule.id,
    policyAction: rule.action satisfies PolicyAction,
    autonomyLevel,
    decidedAt,
  };

  switch (rule.action) {
    case "DENY":
      return {
        ...base,
        action: "DENY",
        decidedBy: `POLICY:${rule.id}`,
        reason: `${politica(rule)} casou e recusa.`,
      };
    case "REQUIRE_APPROVAL":
      return {
        ...base,
        action: "REQUIRE_APPROVAL",
        decidedBy: `POLICY:${rule.id}`,
        reason: `${politica(rule)} casou e exige revisão humana.`,
      };
    case "AUTO_APPROVE": {
      const automation = AUTOMATION_FOR_SUBJECT[subject];
      if (allowsAutomation(autonomyLevel, automation)) {
        return {
          ...base,
          action: "AUTO_APPROVE",
          decidedBy: `POLICY:${rule.id}`,
          reason:
            `${politica(rule)} casou e autoriza; o nível de autonomia ` +
            `${String(autonomyLevel)} libera ${automation}.`,
        };
      }
      return {
        ...base,
        action: "REQUIRE_APPROVAL",
        decidedBy: `AUTONOMY:${String(autonomyLevel)}`,
        reason:
          `${politica(rule)} casou e autoriza, mas o nível de autonomia ` +
          `${String(autonomyLevel)} não libera ${automation}; revisão humana.`,
      };
    }
  }
}
