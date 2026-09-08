import type {
  ContextBudget,
  ContextExclusion,
  ContextItem,
  ContextSectionKind,
} from "@dungeon-master/contracts";

import { fastEstimateTokens } from "./token-estimate.js";
import type { EntryDraft, SectionDraft } from "./types.js";

/**
 * O orçamento de tokens (planejamento v0.4, Fase 7: "Context budget").
 *
 * Dois passos, os dois determinísticos:
 *
 * 1. **Teto por seção.** Cada seção recebe uma fatia fixa do que sobra do
 *    total depois da moldura. Dentro da seção os trechos entram na ordem de
 *    prioridade em que a seção os entregou, até o primeiro que não cabe; dali
 *    em diante tudo fica de fora, para a inclusão não depender do tamanho de
 *    cada trecho e sim da posição dele. O resumo, que é um trecho só, é
 *    cortado em vez de excluído, e a fatia dele nunca fica abaixo do piso.
 * 2. **Corte por prioridade.** Se, mesmo assim, o total passa do orçamento,
 *    as seções são esvaziadas nesta ordem: artefatos, páginas, linhagem,
 *    decisões, e só então o resumo, que é encolhido até o piso e nunca
 *    abaixo dele. As skills não são cortadas: são configuração do Loadout,
 *    não texto escrito por modelo, e cabem em poucas linhas.
 *
 * Tudo o que sai fica registrado com o motivo.
 */

/** A fatia de cada seção sobre o que sobra do total depois da moldura. */
export const SECTION_SHARES: Readonly<Record<ContextSectionKind, number>> = {
  SUMMARY: 0.35,
  DECISIONS: 0.15,
  KNOWLEDGE: 0.3,
  LINEAGE: 0.12,
  ARTIFACTS: 0.05,
  SKILLS: 0.03,
};

/** O piso do resumo: o corte por prioridade nunca o leva abaixo disto. */
export const SUMMARY_MIN_TOKENS = 300;

/**
 * O piso das skills: com um orçamento pequeno, a fatia de 3% não pagaria nem
 * a tag envolvente, e as skills são configuração do Loadout, não texto
 * escrito por modelo — elas cabem em poucas linhas e não são cortadas.
 */
export const SKILLS_MIN_TOKENS = 120;

/** A ordem em que o corte por prioridade esvazia as seções. */
export const CUT_ORDER: readonly ContextSectionKind[] = [
  "ARTIFACTS",
  "KNOWLEDGE",
  "LINEAGE",
  "DECISIONS",
  "SUMMARY",
];

/** Abaixo disto, um trecho cortado não diz mais nada; é excluído em vez de cortado. */
export const MIN_TRUNCATED_TOKENS = 40;

const TRUNCATION_MARK = "\n[… cortado para caber no orçamento de contexto]";

export interface BudgetInput {
  readonly totalTokens: number;
  /** Tokens da moldura fixa: preâmbulo e delimitadores do bloco. */
  readonly frameTokens: number;
}

export interface BudgetedSection {
  readonly kind: ContextSectionKind;
  readonly title: string;
  readonly tag: string | null;
  readonly entries: readonly EntryDraft[];
  /** Tokens da seção inteira, com a tag que a envolve. Zero sem trechos. */
  readonly tokens: number;
  readonly budgetTokens: number;
  readonly truncated: boolean;
}

export interface BudgetOutcome {
  readonly sections: readonly BudgetedSection[];
  readonly excluded: readonly ContextExclusion[];
  readonly budget: ContextBudget;
}

/** Um mapa de tetos zerado, para os registros que não chegaram ao orçamento. */
export function emptySectionBudget(): Record<ContextSectionKind, number> {
  return { SUMMARY: 0, DECISIONS: 0, KNOWLEDGE: 0, LINEAGE: 0, ARTIFACTS: 0, SKILLS: 0 };
}

export function entryText(entry: Pick<EntryDraft, "prefix" | "content" | "suffix">): string {
  return `${entry.prefix}${entry.content}${entry.suffix}`;
}

/** Um trecho com o `item.tokens` recalculado do texto. */
export function measureEntry(entry: Omit<EntryDraft, "item"> & { item: ContextItem }): EntryDraft {
  return { ...entry, item: { ...entry.item, tokens: fastEstimateTokens(entryText(entry)) } };
}

function wrapperTokens(tag: string | null): number {
  return tag === null ? 0 : fastEstimateTokens(`<${tag}>\n</${tag}>`);
}

function sectionTokens(tag: string | null, entries: readonly EntryDraft[]): number {
  if (entries.length === 0) return 0;
  // Cada trecho é seguido de uma quebra de linha no texto final.
  return wrapperTokens(tag) + entries.reduce((soma, entry) => soma + entry.item.tokens + 1, 0);
}

/**
 * Encolhe o conteúdo de um trecho até a estimativa caber em `maxTokens`.
 *
 * Proporcional, em poucas iterações: a estimativa é quase linear no tamanho,
 * então cortar pela razão entre o alvo e a medida chega perto de primeira, e
 * o laço corrige o resto. A marca de corte entra na conta.
 */
export function truncateEntry(entry: EntryDraft, maxTokens: number): EntryDraft {
  const atual = entryText(entry);
  const medida = fastEstimateTokens(atual);
  if (medida <= maxTokens) return entry;

  const moldura = fastEstimateTokens(`${entry.prefix}${TRUNCATION_MARK}${entry.suffix}`);
  const alvo = Math.max(1, maxTokens - moldura);
  let conteudo = entry.content;

  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const tokens = fastEstimateTokens(conteudo);
    if (tokens <= alvo) break;
    const proporcao = alvo / tokens;
    const tamanho = Math.max(1, Math.floor(conteudo.length * proporcao * 0.95));
    if (tamanho >= conteudo.length) {
      conteudo = conteudo.slice(0, conteudo.length - 1);
    } else {
      conteudo = conteudo.slice(0, tamanho);
    }
  }

  conteudo = `${conteudo.trimEnd()}${TRUNCATION_MARK}`;
  const cortado: EntryDraft = {
    ...entry,
    content: conteudo,
    item: { ...entry.item, truncated: true },
  };
  return measureEntry(cortado);
}

export function applyBudget(drafts: readonly SectionDraft[], input: BudgetInput): BudgetOutcome {
  const total = Math.max(0, Math.trunc(input.totalTokens));
  const frame = Math.max(0, Math.trunc(input.frameTokens));
  const disponivel = Math.max(0, total - frame);

  const caps = {} as Record<ContextSectionKind, number>;
  for (const kind of Object.keys(SECTION_SHARES) as ContextSectionKind[]) {
    const fatia = Math.floor(disponivel * SECTION_SHARES[kind]);
    const piso =
      kind === "SUMMARY" ? SUMMARY_MIN_TOKENS : kind === "SKILLS" ? SKILLS_MIN_TOKENS : 0;
    caps[kind] = Math.max(fatia, Math.min(piso, disponivel));
  }

  const excluded: ContextExclusion[] = [];

  // ---------------------------------------------------- 1. teto por seção
  const secoes = drafts.map((draft): BudgetedSection => {
    const cap = caps[draft.kind];
    const mantidos: EntryDraft[] = [];
    let truncated = false;
    let corrente = wrapperTokens(draft.tag);
    let fechou = false;

    for (const entry of draft.entries) {
      if (fechou) {
        excluded.push({ section: draft.kind, item: entry.item, reason: "SECTION_BUDGET" });
        continue;
      }
      const custo = entry.item.tokens + 1;
      if (corrente + custo <= cap) {
        mantidos.push(entry);
        corrente += custo;
        continue;
      }
      const sobra = cap - corrente - 1;
      if (entry.truncatable && sobra >= MIN_TRUNCATED_TOKENS) {
        const cortado = truncateEntry(entry, sobra);
        mantidos.push(cortado);
        corrente += cortado.item.tokens + 1;
        truncated = true;
      } else {
        excluded.push({ section: draft.kind, item: entry.item, reason: "SECTION_BUDGET" });
        truncated = true;
      }
      fechou = true;
    }

    return {
      kind: draft.kind,
      title: draft.title,
      tag: draft.tag,
      entries: mantidos,
      tokens: sectionTokens(draft.tag, mantidos),
      budgetTokens: cap,
      truncated,
    };
  });

  // ------------------------------------------------ 2. corte por prioridade
  const somaTotal = (): number => frame + secoes.reduce((soma, secao) => soma + secao.tokens, 0);

  let excesso = somaTotal() - total;
  let indice = 0;
  while (excesso > 0 && indice < CUT_ORDER.length) {
    const kind = CUT_ORDER[indice];
    if (kind === undefined) break;
    const posicao = secoes.findIndex((secao) => secao.kind === kind);
    const secao = posicao === -1 ? undefined : secoes[posicao];
    if (secao === undefined || secao.entries.length === 0) {
      indice += 1;
      continue;
    }

    if (kind === "SUMMARY") {
      const [resumo] = secao.entries;
      if (resumo === undefined) {
        indice += 1;
        continue;
      }
      const alvo = Math.max(SUMMARY_MIN_TOKENS, resumo.item.tokens - excesso);
      if (alvo >= resumo.item.tokens) break; // já está no piso: o piso vence o orçamento.
      const cortado = truncateEntry(resumo, alvo);
      secoes[posicao] = {
        ...secao,
        entries: [cortado],
        tokens: sectionTokens(secao.tag, [cortado]),
        truncated: true,
      };
      // O resumo é o último da ordem: depois dele não há mais o que cortar.
      break;
    }

    const restantes = secao.entries.slice(0, -1);
    const removido = secao.entries[secao.entries.length - 1];
    if (removido !== undefined) {
      excluded.push({ section: kind, item: removido.item, reason: "TOTAL_BUDGET" });
    }
    secoes[posicao] = {
      ...secao,
      entries: restantes,
      tokens: sectionTokens(secao.tag, restantes),
      truncated: true,
    };
    excesso = somaTotal() - total;
  }

  return {
    sections: secoes,
    excluded,
    budget: {
      totalTokens: total,
      frameTokens: frame,
      summaryMinTokens: SUMMARY_MIN_TOKENS,
      sections: caps,
    },
  };
}
