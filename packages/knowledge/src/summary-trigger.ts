// Adapted from TencentDB Agent Memory — MemoryCore/src/core/persona/persona-trigger.ts@3efcd31
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: a classe que lia o checkpoint do disco virou uma função pura sobre
// fatos que a porta entrega; as cinco condições da persona viraram as cinco
// condições de regeneração do Project Summary — pedido explícito, partida a
// frio, recuperação de um resumo sem corpo, itens cobertos que mudaram, e o
// limiar de itens novos —, e a de "primeiro scene block" virou a de itens
// cobertos que foram arquivados, recusados ou editados depois do resumo,
// porque aqui o que muda o resumo não é um arquivo novo e sim a revisão
// humana. Sem `CheckpointManager`, sem `StorageAdapter`, sem leitura de
// `persona.md`. Mensagens em português.

/**
 * O que o gatilho olha. Tudo vem da porta, lido dentro do lock do Project.
 */
export interface SummaryTriggerFacts {
  /** O lote foi pedido com regeneração explícita (API ou CLI). */
  readonly requested: boolean;
  /** Existe um `SUMMARY` corrente? */
  readonly hasSummary: boolean;
  /** O `SUMMARY` corrente tem conteúdo? `false` também quando não existe. */
  readonly summaryHasContent: boolean;
  /** Itens `ACTIVE` do Grimório, sem contar o resumo. */
  readonly activeItemCount: number;
  /** Itens que ficaram `ACTIVE` depois da última regeneração. */
  readonly promotedSinceSummary: number;
  /** Itens que o resumo cobriu e que foram arquivados, recusados ou editados depois. */
  readonly coveredItemsChanged: number;
}

export interface SummaryTriggerOptions {
  /** Quantos itens ativos novos disparam a regeneração. Padrão: 5. */
  readonly everyNItems?: number;
}

export interface SummaryTriggerResult {
  readonly should: boolean;
  /** Vazio quando nenhuma condição disparou. */
  readonly reason: string;
}

export const DEFAULT_SUMMARY_EVERY_N_ITEMS = 5;

/**
 * Decide se o Project Summary é regenerado neste lote.
 *
 * As cinco condições, em ordem de prioridade — a primeira que casa vence:
 *
 * 1. **Pedido explícito.** O usuário pediu pela API ou pela CLI.
 * 2. **Partida a frio.** Há itens ativos e nenhum resumo.
 * 3. **Recuperação.** Existe um resumo, mas sem corpo.
 * 4. **Cobertura desatualizada.** Itens que o resumo cita foram arquivados,
 *    recusados ou editados na revisão: o resumo fala de páginas que já não
 *    existem como ele as descreveu.
 * 5. **Limiar.** Itens ativos novos desde o resumo chegaram a `everyNItems`.
 *
 * Sem item ativo nenhum, nada dispara: não há o que consolidar, e um resumo
 * de um Grimório vazio seria o modelo inventando.
 */
export function shouldRegenerateSummary(
  facts: SummaryTriggerFacts,
  options: SummaryTriggerOptions = {},
): SummaryTriggerResult {
  const everyN = options.everyNItems ?? DEFAULT_SUMMARY_EVERY_N_ITEMS;

  if (facts.activeItemCount <= 0) return { should: false, reason: "" };

  if (facts.requested) {
    return { should: true, reason: "pedido explícito" };
  }

  if (!facts.hasSummary) {
    return { should: true, reason: "partida a frio: há itens ativos e nenhum resumo" };
  }

  if (!facts.summaryHasContent) {
    return { should: true, reason: "recuperação: o resumo corrente está sem corpo" };
  }

  if (facts.coveredItemsChanged > 0) {
    return {
      should: true,
      reason: `cobertura desatualizada: ${String(facts.coveredItemsChanged)} item(ns) cobertos mudaram na revisão`,
    };
  }

  if (facts.promotedSinceSummary >= everyN) {
    return {
      should: true,
      reason: `limiar: ${String(facts.promotedSinceSummary)} >= ${String(everyN)} itens ativos novos`,
    };
  }

  return { should: false, reason: "" };
}
