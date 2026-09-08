// Adapted from TencentDB Agent Memory — MemoryCore/src/core/record/l1-dedup.ts@3efcd31
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: o funil em duas fases (recall de candidatos sem LLM, julgamento em
// lote com LLM) e o fail-open ("na dúvida, store") são do original. O recall
// vetorial e o FTS5 do SQLite saíram; o recall é uma porta que o Worker
// implementa com o FTS do PostgreSQL. A chamada ao modelo saiu deste arquivo:
// ela é uma por lote e mora no Distiller, junto da classificação; aqui fica o
// que é puro — a montagem dos pools, o filtro por regra antes do modelo e a
// normalização fail-open da resposta, que agora também traduz chaves curtas
// em ids, sanitiza todo texto e infere o tipo pelo `kind` quando o modelo não
// disse. `update` não existe: um item já revisado não é reescrito por modelo.
// Mensagens em português.

import type { KnowledgeItemType } from "@dungeon-master/contracts";

import { filterHarnessNoise } from "./l0-noise-filter.js";
import type { CandidatePool } from "./prompts/dedup-judge.js";
import {
  DISTILL_CONTENT_MAX_LENGTH,
  DISTILL_REASON_MAX_LENGTH,
  DISTILL_TITLE_MAX_LENGTH,
  type DistillOutput,
} from "./prompts/extract-candidates.js";
import { sanitizeLlmText } from "./sanitize.js";
import type { DistillCandidate, ExistingKnowledgeItem, ResolvedDecision } from "./types.js";

export type PromotableType = Exclude<KnowledgeItemType, "SUMMARY">;

/**
 * O tipo que um `kind` livre do agente sugere, quando o modelo não disse.
 *
 * É rede de segurança do fail-open, não classificador: o modelo decide o tipo
 * na chamada, e isto só entra quando a decisão veio sem ele.
 */
export function defaultTypeFor(kind: string | null): PromotableType {
  const k = (kind ?? "").trim().toLowerCase();
  if (k === "decision" || k === "decisao" || k === "decisão") return "DECISION";
  if (k === "howto" || k === "how-to" || k === "procedure" || k === "procedimento") {
    return "PROCEDURE";
  }
  if (k === "gotcha" || k === "pitfall" || k === "discovery" || k === "descoberta" || k === "bug") {
    return "DISCOVERY";
  }
  if (
    k === "convention" ||
    k === "constraint" ||
    k === "rule" ||
    k === "regra" ||
    k === "restricao"
  ) {
    return "CONSTRAINT";
  }
  return "FACT";
}

export interface RuleFilterResult {
  /** Os candidatos que vão ao modelo, já com o texto limpo do ruído de harness. */
  readonly kept: DistillCandidate[];
  /** Os que a regra decidiu sozinha, sem gastar uma chamada. */
  readonly ruled: ResolvedDecision[];
}

/**
 * A fase zero: o que nem chega ao modelo.
 *
 * Um candidato cujo conteúdo é só ruído de harness, ou que ficou vazio depois
 * do filtro, é rejeitado por regra — com a proveniência dizendo que foi a
 * regra. Não é o fail-open que abre mão de conteúdo: é o filtro L0 do
 * TencentDB aplicado antes da extração, como o manifesto pede.
 */
export function applyRuleFilter(candidates: readonly DistillCandidate[]): RuleFilterResult {
  const kept: DistillCandidate[] = [];
  const ruled: ResolvedDecision[] = [];

  for (const candidate of candidates) {
    const title = sanitizeLlmText(filterHarnessNoise(candidate.title), {
      maxLength: DISTILL_TITLE_MAX_LENGTH,
    });
    const content = sanitizeLlmText(filterHarnessNoise(candidate.content), {
      maxLength: DISTILL_CONTENT_MAX_LENGTH,
    });

    if (content.length === 0 || title.length === 0) {
      ruled.push({
        candidateId: candidate.id,
        decision: "REJECT",
        decidedBy: "RULE",
        reason: "vazio depois do filtro de ruído de harness",
      });
      continue;
    }

    kept.push({ ...candidate, title, content });
  }

  return { kept, ruled };
}

export type RecallFn = (text: string, limit: number) => Promise<ExistingKnowledgeItem[]>;

export interface RecallOptions {
  /** Itens parecidos por candidato. Padrão: 5, como no original. */
  readonly limit?: number;
}

/**
 * A fase um: os pools de candidatos a duplicata, sem modelo.
 *
 * Fail-open por construção: um recall que lança vira um pool vazio, e o
 * candidato segue para o modelo como "sem item parecido" — o que resulta em
 * PROMOTE, nunca em perda.
 */
export async function recallPools(
  candidates: readonly DistillCandidate[],
  recall: RecallFn,
  options: RecallOptions = {},
): Promise<CandidatePool<DistillCandidate>[]> {
  const limit = options.limit ?? 5;
  const pools: CandidatePool<DistillCandidate>[] = [];

  for (const candidate of candidates) {
    let related: ExistingKnowledgeItem[];
    try {
      related = await recall(`${candidate.title}\n${candidate.content}`, limit);
    } catch {
      related = [];
    }
    pools.push({ candidate, related });
  }

  return pools;
}

export interface DecisionKeys {
  readonly itemIdByKey: ReadonlyMap<string, string>;
  readonly candidateIdByKey: ReadonlyMap<string, string>;
}

const MISSING_REASON = "sem decisão do modelo; promovido por precaução";

/**
 * A fase dois, do lado de quem lê: a resposta do modelo vira decisões
 * finais, **sem perder candidato nenhum**.
 *
 * - Candidato sem decisão → PROMOTE com o próprio texto.
 * - PROMOTE sem tipo → tipo inferido do `kind`; sem título ou conteúdo → os
 *   do candidato; conteúdo vazio mesmo assim → REJECT por regra.
 * - MERGE com alvo desconhecido → PROMOTE, com o motivo dizendo por quê.
 * - MERGE apontando para outro candidato do lote (`C1`) → guarda o id do
 *   candidato; quem grava resolve para o item que ele virou.
 * - Chaves que não existem na resposta são ignoradas.
 *
 * Todo texto passa por `sanitizeLlmText` aqui, uma vez, antes de qualquer
 * gravação.
 */
export function resolveDecisions(
  output: DistillOutput | undefined,
  pools: readonly CandidatePool<DistillCandidate>[],
  keys: DecisionKeys,
): ResolvedDecision[] {
  const porCandidato = new Map<string, DistillOutput["decisions"][number]>();
  for (const decision of output?.decisions ?? []) {
    const candidateId = keys.candidateIdByKey.get(decision.candidate.trim().toUpperCase());
    if (candidateId === undefined || porCandidato.has(candidateId)) continue;
    porCandidato.set(candidateId, decision);
  }

  const idsDoLote = new Set(pools.map((pool) => pool.candidate.id));
  const resolved: ResolvedDecision[] = [];

  for (const pool of pools) {
    const { candidate } = pool;
    const decision = porCandidato.get(candidate.id);

    if (decision === undefined) {
      resolved.push(promover(candidate, undefined, MISSING_REASON));
      continue;
    }

    const reason = sanitizeLlmText(decision.reason ?? "", { maxLength: DISTILL_REASON_MAX_LENGTH });

    if (decision.decision === "REJECT") {
      resolved.push({
        candidateId: candidate.id,
        decision: "REJECT",
        decidedBy: "LLM",
        reason: reason.length === 0 ? "rejeitado pelo modelo" : reason,
      });
      continue;
    }

    if (decision.decision === "MERGE") {
      const alvo = (decision.mergeInto ?? "").trim().toUpperCase();
      const itemId = keys.itemIdByKey.get(alvo);
      const candidateAlvo = keys.candidateIdByKey.get(alvo);

      if (itemId !== undefined) {
        resolved.push({
          candidateId: candidate.id,
          decision: "MERGE",
          decidedBy: "LLM",
          reason: reason.length === 0 ? `duplicata de ${alvo}` : reason,
          mergeIntoItemId: itemId,
        });
        continue;
      }

      if (
        candidateAlvo !== undefined &&
        candidateAlvo !== candidate.id &&
        idsDoLote.has(candidateAlvo)
      ) {
        resolved.push({
          candidateId: candidate.id,
          decision: "MERGE",
          decidedBy: "LLM",
          reason: reason.length === 0 ? `duplicata do candidato ${alvo}` : reason,
          mergeIntoCandidateId: candidateAlvo,
        });
        continue;
      }

      // Alvo desconhecido: preferir duplicar a perder.
      resolved.push(
        promover(
          candidate,
          decision,
          `mesclaria em ${alvo.length === 0 ? "(sem alvo)" : alvo}, que não existe; promovido por precaução`,
        ),
      );
      continue;
    }

    resolved.push(promover(candidate, decision, reason));
  }

  return resolved;
}

function promover(
  candidate: DistillCandidate,
  decision: DistillOutput["decisions"][number] | undefined,
  reason: string,
): ResolvedDecision {
  const title = escolher(decision?.title, candidate.title, DISTILL_TITLE_MAX_LENGTH);
  const content = escolher(decision?.content, candidate.content, DISTILL_CONTENT_MAX_LENGTH);

  if (content.length === 0 || title.length === 0) {
    return {
      candidateId: candidate.id,
      decision: "REJECT",
      decidedBy: "RULE",
      reason: "sem conteúdo depois da sanitização",
    };
  }

  return {
    candidateId: candidate.id,
    decision: "PROMOTE",
    decidedBy: decision === undefined ? "RULE" : "LLM",
    reason: reason.length === 0 ? "promovido pelo modelo" : reason,
    item: { type: decision?.type ?? defaultTypeFor(candidate.kind), title, content },
  };
}

/** O texto do modelo, ou o do candidato quando o modelo não deu um utilizável. */
function escolher(fromModel: string | undefined, fallback: string, max: number): string {
  const doModelo = fromModel === undefined ? "" : sanitizeLlmText(fromModel, { maxLength: max });
  if (doModelo.length > 0) return doModelo;
  return sanitizeLlmText(fallback, { maxLength: max });
}
