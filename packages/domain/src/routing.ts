import type {
  RoutingAttempt,
  RoutingDecision,
  RoutingKind,
  RoutingRule,
  RuleFacts,
} from "@dungeon-master/contracts";

import { selectRule, tieDecider } from "./rule-matching.js";

/**
 * Roteamento por regras (planejamento v0.4, Fase 9A): a escolha de um Model,
 * Loadout ou Workflow a partir das regras ligadas, no escopo, que casam com
 * os fatos.
 *
 * Função pura: os alvos são resolvidos por quem chama (`resolve`), porque só
 * o repositório sabe se um Model pertence ao Harness do Loadout ou se um
 * Workflow ainda existe. A regra escolhida tenta o alvo preferido e os
 * fallbacks em ordem; o primeiro aceito vence. Sem regra, com empate ou sem
 * alvo válido, vale o padrão que quem chama informa, e a decisão diz isso.
 */

export type RoutingRuleLike = Pick<
  RoutingRule,
  "id" | "name" | "kind" | "projectId" | "priority" | "conditions" | "targetId" | "fallbackIds" | "enabled"
>;

export interface RoutingCandidate {
  readonly id: string;
  /** Nome, ou a chave num Model. */
  readonly name: string;
}

export type RoutingResolution =
  | { readonly ok: true; readonly candidate: RoutingCandidate }
  | { readonly ok: false; readonly reason: string };

export interface RouteTargetInput {
  readonly kind: RoutingKind;
  readonly rules: readonly RoutingRuleLike[];
  readonly facts: RuleFacts;
  /** Diz se o alvo serve neste contexto. Chamado uma vez por alvo tentado. */
  readonly resolve: (targetId: string) => RoutingResolution;
  /** O padrão do sistema quando nenhuma regra decide. Nulo é "nenhum". */
  readonly fallback: RoutingCandidate | null;
  /** Por que o padrão é o que é ("o Loadout padrão", "o Model padrão do Harness"). */
  readonly fallbackReason: string;
}

function padrao(
  input: RouteTargetInput,
  decidedBy: string,
  motivo: string,
  attempts: readonly RoutingAttempt[],
): RoutingDecision {
  return {
    kind: input.kind,
    selectedId: input.fallback?.id ?? null,
    selectedName: input.fallback?.name ?? null,
    ruleId: null,
    decidedBy,
    reason: `${motivo} ${input.fallbackReason}`,
    attempts: [...attempts],
  };
}

export function routeTarget(input: RouteTargetInput): RoutingDecision {
  const daEspecie = input.rules.filter((rule) => rule.kind === input.kind);
  const escolha = selectRule(daEspecie, input.facts);

  if (escolha.outcome === "NONE") {
    return padrao(input, "DEFAULT", `Nenhuma regra de roteamento de ${input.kind} casou;`, []);
  }

  if (escolha.outcome === "TIE") {
    const nomes = escolha.rules.map((rule) => `"${rule.name}" (${rule.id})`).join(", ");
    return padrao(
      input,
      tieDecider(escolha.rules),
      `As regras ${nomes} têm a mesma prioridade (${String(escolha.priority)}) e casam ao mesmo tempo;`,
      [],
    );
  }

  const { rule } = escolha;
  const attempts: RoutingAttempt[] = [];
  for (const targetId of [rule.targetId, ...rule.fallbackIds]) {
    const resolved = input.resolve(targetId);
    if (resolved.ok) {
      attempts.push({ targetId, accepted: true, reason: "Alvo válido neste contexto." });
      const posicao = attempts.length === 1 ? "o alvo preferido" : `o fallback ${String(attempts.length - 1)}`;
      return {
        kind: input.kind,
        selectedId: resolved.candidate.id,
        selectedName: resolved.candidate.name,
        ruleId: rule.id,
        decidedBy: `ROUTING:${rule.id}`,
        reason: `A regra "${rule.name}" (${rule.id}) casou e ${posicao} serviu.`,
        attempts,
      };
    }
    attempts.push({ targetId, accepted: false, reason: resolved.reason });
  }

  return padrao(
    input,
    "DEFAULT",
    `A regra "${rule.name}" (${rule.id}) casou, mas nenhum dos ${String(attempts.length)} alvo(s) serviu;`,
    attempts,
  );
}
