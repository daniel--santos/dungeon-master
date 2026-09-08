// Adapted from TencentDB Agent Memory — MemoryCore/src/core/prompts/l1-dedup.ts@3efcd31
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: o "pool unificado de candidatos" e o julgamento em lote são do
// original; as quatro ações (`store`/`skip`/`update`/`merge`) viraram três
// (`PROMOTE`/`REJECT`/`MERGE`), porque aqui um item já revisado por um humano
// não é reescrito por um modelo — a mescla só liga o candidato ao item e
// guarda a proveniência. Os tipos `persona`/`episodic`/`instruction` e os de
// trabalho viraram os seis tipos fechados da Fase 6; `record_id` virou chaves
// curtas (`C1`, `K1`) para o modelo não errar UUIDs; `merged_priority` e
// `merged_timestamps` saíram. Prompt reescrito em português.

import { escapeXmlTags } from "@dungeon-master/context";

import type { ExistingKnowledgeItem } from "../types.js";

/** Um candidato e os itens que o recall achou parecidos com ele. */
export interface CandidatePool<C extends { id: string }> {
  readonly candidate: C;
  readonly related: readonly ExistingKnowledgeItem[];
}

/** `C1`, `C2`, ... — a chave curta de um candidato dentro do prompt. */
export function candidateKey(index: number): string {
  return `C${String(index + 1)}`;
}

/** `K1`, `K2`, ... — a chave curta de um item do Grimório dentro do prompt. */
export function itemKey(index: number): string {
  return `K${String(index + 1)}`;
}

/**
 * As regras de julgamento de duplicata, escritas para entrar no prompt de
 * destilação (a chamada é uma só por lote: classificação e julgamento juntos).
 */
export const DEDUP_JUDGE_RULES = `## Duplicatas: como julgar

Para cada candidato você recebe os itens do Grimório que se parecem com ele
("Itens relacionados"). Decida:

- "PROMOTE": o candidato traz algo que o Grimório não tem. Vira um item novo.
- "MERGE": o candidato diz a mesma coisa que um item relacionado — mesmo fato,
  mesma decisão, mesma restrição —, ainda que com outras palavras ou com um
  detalhe a mais. Aponte o item em "mergeInto". O item existente não é
  reescrito; o candidato é ligado a ele como fonte.
- "REJECT": o candidato não vale uma página: é conversa, é passo de uma única
  execução ("nesta rodada", "desta vez"), é o que o agente fez em vez do que
  aprendeu, é opinião sem fato, ou é vazio.

Regras de desempate:

1. Na dúvida entre MERGE e PROMOTE, escolha PROMOTE. Uma duplicata custa uma
   revisão humana; uma página perdida não volta.
2. Na dúvida entre REJECT e PROMOTE, escolha PROMOTE pelo mesmo motivo — mas
   só se o candidato tiver um fato reconhecível fora do Run em que nasceu.
3. MERGE só com item relacionado listado para aquele candidato. Nunca invente
   uma chave.
4. Dois candidatos do mesmo lote que dizem a mesma coisa: PROMOTE o primeiro e
   MERGE o segundo no item que o primeiro vai virar — para isso, use a chave do
   primeiro candidato ("C1") em "mergeInto".`;

/** Um item do Grimório como o prompt o mostra. */
export function formatExistingItem(key: string, item: ExistingKnowledgeItem): string {
  return `[${key}] (${item.type}, ${item.status}) ${escapeXmlTags(item.title)}\n${escapeXmlTags(item.content)}`;
}

export interface FormattedPools {
  /** O texto da seção "Itens que o Grimório já tem". */
  readonly poolSection: string;
  /** Chave curta → id do item, para traduzir a resposta. */
  readonly itemIdByKey: ReadonlyMap<string, string>;
  /** Id do item → chave curta, para escrever "Itens relacionados". */
  readonly keyByItemId: ReadonlyMap<string, string>;
}

/**
 * O pool unificado: cada item aparece uma vez, com uma chave, ainda que seja
 * parecido com vários candidatos. Ver o conjunto inteiro é o que deixa o
 * modelo julgar duplicatas entre candidatos do mesmo lote.
 */
export function formatCandidatePools<C extends { id: string }>(
  pools: readonly CandidatePool<C>[],
): FormattedPools {
  const itemIdByKey = new Map<string, string>();
  const keyByItemId = new Map<string, string>();
  const linhas: string[] = [];

  for (const pool of pools) {
    for (const item of pool.related) {
      if (keyByItemId.has(item.id)) continue;
      const key = itemKey(keyByItemId.size);
      keyByItemId.set(item.id, key);
      itemIdByKey.set(key, item.id);
      linhas.push(formatExistingItem(key, item));
    }
  }

  const poolSection =
    linhas.length === 0
      ? "## Itens que o Grimório já tem\n\n(nenhum item parecido: todo candidato válido é PROMOTE)"
      : `## Itens que o Grimório já tem (${String(linhas.length)})\n\n${linhas.join("\n\n")}`;

  return { poolSection, itemIdByKey, keyByItemId };
}
