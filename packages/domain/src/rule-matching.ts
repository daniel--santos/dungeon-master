import type { RuleConditions, RuleFacts } from "@dungeon-master/contracts";

/**
 * O casamento de regras por condições nomeadas (planejamento v0.4, Fase 9A).
 *
 * Políticas de aprovação e regras de roteamento compartilham o vocabulário
 * fechado de `RuleConditions` e a mesma disciplina de escolha: a regra ligada
 * de **maior prioridade** que casa decide; nenhuma casando é `NONE`; duas ou
 * mais na mesma prioridade máxima é `TIE`, e quem chama trata empate como
 * "ninguém decidiu" — revisão humana numa política, padrão do sistema num
 * roteamento. Empate não é resolvido por ordem de criação nem por ação, de
 * propósito: prioridades iguais são um engano de configuração, e a resposta
 * diz quais regras empataram.
 *
 * **Fail-closed nos fatos.** Uma condição sobre um fato que o contexto não
 * mediu não casa. Uma regra que fale de `stepType` nunca casa numa partida de
 * Run; uma que fale de `maxEstimatedTokens` não casa quando ninguém estimou.
 */

export interface ConditionedRule {
  readonly id: string;
  readonly priority: number;
  readonly conditions: RuleConditions;
  readonly enabled: boolean;
  /** Nulo é global; preenchido só vale para o Project dos fatos. */
  readonly projectId: string | null;
}

function casaComLista<T>(condition: T | readonly T[] | undefined, fact: T | undefined): boolean {
  if (condition === undefined) return true;
  if (fact === undefined) return false;
  return Array.isArray(condition) ? condition.includes(fact) : condition === fact;
}

/** Todas as condições presentes valem sobre os fatos? Fato ausente é `false`. */
export function matchesConditions(conditions: RuleConditions, facts: RuleFacts): boolean {
  if (!casaComLista(conditions.executionMode, facts.executionMode)) return false;
  if (!casaComLista(conditions.harnessKey, facts.harnessKey)) return false;
  if (!casaComLista(conditions.taskKind, facts.taskKind)) return false;
  if (!casaComLista(conditions.taskPriority, facts.taskPriority)) return false;
  if (!casaComLista(conditions.enforcement, facts.enforcement)) return false;
  if (!casaComLista(conditions.stepType, facts.stepType)) return false;
  if (!casaComLista(conditions.loadoutId, facts.loadoutId)) return false;
  if (!casaComLista(conditions.projectId, facts.projectId)) return false;

  if (conditions.hasCommandTools !== undefined) {
    if (facts.hasCommandTools === undefined) return false;
    if (conditions.hasCommandTools !== facts.hasCommandTools) return false;
  }

  if (conditions.maxEstimatedTokens !== undefined) {
    if (facts.estimatedTokens === undefined) return false;
    if (facts.estimatedTokens > conditions.maxEstimatedTokens) return false;
  }

  if (conditions.minBudgetPressure !== undefined) {
    if (facts.budgetPressure === undefined) return false;
    if (facts.budgetPressure < conditions.minBudgetPressure) return false;
  }

  return true;
}

/** A regra vale para o Project dos fatos? Global vale sempre; sem Project, só as globais. */
export function inRuleScope(rule: Pick<ConditionedRule, "projectId">, facts: RuleFacts): boolean {
  if (rule.projectId === null) return true;
  return facts.projectId !== undefined && rule.projectId === facts.projectId;
}

export type RuleSelection<Rule> =
  | { readonly outcome: "MATCHED"; readonly rule: Rule }
  | { readonly outcome: "NONE" }
  | { readonly outcome: "TIE"; readonly rules: readonly Rule[]; readonly priority: number };

/**
 * A regra que decide, entre as ligadas, no escopo e que casam.
 *
 * Determinística: a ordem de entrada não influencia o resultado, e num
 * empate as regras voltam em ordem de id para a mensagem ser estável.
 */
export function selectRule<Rule extends ConditionedRule>(
  rules: readonly Rule[],
  facts: RuleFacts,
): RuleSelection<Rule> {
  const candidatas = rules.filter(
    (rule) => rule.enabled && inRuleScope(rule, facts) && matchesConditions(rule.conditions, facts),
  );
  if (candidatas.length === 0) return { outcome: "NONE" };

  const maior = Math.max(...candidatas.map((rule) => rule.priority));
  const noTopo = candidatas
    .filter((rule) => rule.priority === maior)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const [primeira] = noTopo;
  if (primeira === undefined) return { outcome: "NONE" };
  if (noTopo.length > 1) return { outcome: "TIE", rules: noTopo, priority: maior };
  return { outcome: "MATCHED", rule: primeira };
}

/** `TIE:<id>,<id>`: o prefixo estável de um empate, para `decidedBy`. */
export function tieDecider(rules: readonly { readonly id: string }[]): string {
  return `TIE:${rules.map((rule) => rule.id).join(",")}`;
}
