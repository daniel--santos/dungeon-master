import type { ContextItem, ContextSectionKind } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  applyBudget,
  CUT_ORDER,
  entryText,
  MIN_TRUNCATED_TOKENS,
  SECTION_SHARES,
  SKILLS_MIN_TOKENS,
  SUMMARY_MIN_TOKENS,
  truncateEntry,
} from "./budget.js";
import { fastEstimateTokens } from "./token-estimate.js";
import type { EntryDraft, SectionDraft } from "./types.js";

function item(
  id: string,
  tokens: number,
  kind: ContextItem["kind"] = "KNOWLEDGE_ITEM",
): ContextItem {
  return { id, kind, title: id, reason: "FTS_MATCH", score: null, tokens, truncated: false };
}

/** Um trecho cujo custo é declarado, e não medido: o orçamento só lê `item.tokens`. */
function entry(id: string, tokens: number, truncatable = false): EntryDraft {
  return {
    item: item(id, tokens),
    prefix: `<x id="${id}">\n`,
    content: "palavra ".repeat(Math.max(1, tokens)),
    suffix: "\n</x>",
    truncatable,
  };
}

function section(
  kind: ContextSectionKind,
  entries: EntryDraft[],
  tag: string | null = "s",
): SectionDraft {
  return { kind, title: kind, tag, entries };
}

describe("applyBudget — teto por seção", () => {
  it("deriva os tetos das fatias sobre o que sobra da moldura, e o resumo nunca abaixo do piso", () => {
    const { budget } = applyBudget([], { totalTokens: 6000, frameTokens: 200 });
    const disponivel = 5800;
    expect(budget.totalTokens).toBe(6000);
    expect(budget.frameTokens).toBe(200);
    expect(budget.summaryMinTokens).toBe(SUMMARY_MIN_TOKENS);
    for (const kind of Object.keys(SECTION_SHARES) as ContextSectionKind[]) {
      expect(budget.sections[kind]).toBe(Math.floor(disponivel * SECTION_SHARES[kind]));
    }

    const pequeno = applyBudget([], { totalTokens: 500, frameTokens: 100 });
    expect(pequeno.budget.sections.SUMMARY).toBe(SUMMARY_MIN_TOKENS);
    expect(pequeno.budget.sections.SKILLS).toBe(SKILLS_MIN_TOKENS);
    const minusculo = applyBudget([], { totalTokens: 150, frameTokens: 100 });
    expect(minusculo.budget.sections.SUMMARY).toBe(50);
    expect(minusculo.budget.sections.SKILLS).toBe(50);
  });

  it("mantém os trechos na ordem até o primeiro que não cabe, e exclui o resto", () => {
    // Teto de KNOWLEDGE: floor(1000 × 0,30) = 300, menos a tag envolvente.
    const draft = section("KNOWLEDGE", [
      entry("a", 100),
      entry("b", 100),
      entry("c", 200), // não cabe
      entry("d", 10), // caberia, mas vem depois de um que não coube
    ]);
    const { sections, excluded } = applyBudget([draft], { totalTokens: 1000, frameTokens: 0 });
    const [knowledge] = sections;
    expect(knowledge?.entries.map((e) => e.item.id)).toEqual(["a", "b"]);
    expect(knowledge?.truncated).toBe(true);
    expect(excluded.map((e) => [e.item.id, e.reason])).toEqual([
      ["c", "SECTION_BUDGET"],
      ["d", "SECTION_BUDGET"],
    ]);
  });

  it("corta o resumo em vez de excluí-lo, e marca o corte", () => {
    const grande = entry("resumo", 2000, true);
    const { sections, excluded } = applyBudget([section("SUMMARY", [grande], null)], {
      totalTokens: 2000,
      frameTokens: 0,
    });
    const [summary] = sections;
    const [cortado] = summary?.entries ?? [];
    expect(excluded).toEqual([]);
    expect(summary?.truncated).toBe(true);
    expect(cortado?.item.truncated).toBe(true);
    expect(cortado?.item.tokens).toBeLessThanOrEqual(summary?.budgetTokens ?? 0);
    expect(cortado?.content.endsWith("[… cortado para caber no orçamento de contexto]")).toBe(true);
    expect(entryText(cortado ?? grande).startsWith(grande.prefix)).toBe(true);
    expect(entryText(cortado ?? grande).endsWith(grande.suffix)).toBe(true);
  });

  it("exclui em vez de cortar quando a sobra é pequena demais para dizer algo", () => {
    const draft = section("SUMMARY", [entry("resumo", 500, true)], null);
    // Disponível 320: o teto do resumo é o piso, 300, e sobra abaixo do mínimo de corte não existe;
    // aqui o cap é 300 e o trecho custa 500: sobra 299 >= MIN → corta. Para forçar a exclusão,
    // o cap precisa ficar abaixo de MIN_TRUNCATED_TOKENS.
    const { sections, excluded } = applyBudget([draft], {
      totalTokens: MIN_TRUNCATED_TOKENS - 1,
      frameTokens: 0,
    });
    expect(sections[0]?.entries).toEqual([]);
    expect(excluded.map((e) => e.reason)).toEqual(["SECTION_BUDGET"]);
  });
});

describe("applyBudget — corte por prioridade", () => {
  it("esvazia artefatos, páginas, linhagem e decisões nesta ordem, e só então encolhe o resumo", () => {
    // Disponível 400: SUMMARY 300 (piso), DECISIONS 60, KNOWLEDGE 120, LINEAGE 48,
    // ARTIFACTS 20, SKILLS 12. Cheio, a soma passa de 400.
    const drafts: SectionDraft[] = [
      section("SUMMARY", [entry("resumo", 280, true)], null),
      section("DECISIONS", [entry("d1", 20), entry("d2", 20)]),
      section("KNOWLEDGE", [entry("k1", 40), entry("k2", 40)]),
      section("LINEAGE", [entry("l1", 30)]),
      section("ARTIFACTS", [entry("a1", 5), entry("a2", 5)]),
      section("SKILLS", [entry("s1", 3)]),
    ];
    const { sections, excluded, budget } = applyBudget(drafts, {
      totalTokens: 400,
      frameTokens: 0,
    });

    const soma = sections.reduce((total, s) => total + s.tokens, 0);
    expect(soma).toBeLessThanOrEqual(400);

    const ordemDeSaida = excluded.map((e) => e.section);
    // A ordem registrada é a ordem do corte: artefatos primeiro, depois páginas...
    const posicoes = ordemDeSaida.map((kind) => CUT_ORDER.indexOf(kind));
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(excluded.every((e) => e.reason === "TOTAL_BUDGET")).toBe(true);

    // Skills nunca saem; o resumo só encolhe depois de tudo o mais.
    expect(sections.find((s) => s.kind === "SKILLS")?.entries).toHaveLength(1);
    const resumo = sections.find((s) => s.kind === "SUMMARY");
    expect(resumo?.entries).toHaveLength(1);
    expect(budget.sections.SUMMARY).toBe(SUMMARY_MIN_TOKENS);
  });

  it("encolhe o resumo até o piso, e para ali mesmo que o total continue acima", () => {
    const drafts: SectionDraft[] = [
      section("SUMMARY", [entry("resumo", 290, true)], null),
      section("SKILLS", [entry("s1", 50)]),
    ];
    // Total 320 com moldura 0: o resumo (290) cabe no teto dele (o piso, 300),
    // as skills cabem no delas, e a soma passa de 320. O corte chegaria ao
    // resumo, mas ele já está abaixo do piso: nada sai, e o piso vence.
    const { sections, excluded } = applyBudget(drafts, { totalTokens: 320, frameTokens: 0 });
    expect(excluded).toEqual([]);
    expect(sections.find((s) => s.kind === "SUMMARY")?.entries[0]?.item.tokens).toBe(290);
    expect(sections.find((s) => s.kind === "SKILLS")?.entries).toHaveLength(1);
  });
});

describe("truncateEntry", () => {
  it("devolve o mesmo trecho quando já cabe", () => {
    const e = entry("x", 10, true);
    expect(truncateEntry(e, fastEstimateTokens(entryText(e)) + 1)).toBe(e);
  });

  it("encolhe o conteúdo até a estimativa caber, preservando prefixo e sufixo", () => {
    const e: EntryDraft = {
      item: item("x", 0),
      prefix: "<p>\n",
      content: "uma palavra qualquer ".repeat(200),
      suffix: "\n</p>",
      truncatable: true,
    };
    const cortado = truncateEntry(e, 80);
    expect(fastEstimateTokens(entryText(cortado))).toBeLessThanOrEqual(80);
    expect(cortado.item.tokens).toBe(fastEstimateTokens(entryText(cortado)));
    expect(cortado.item.truncated).toBe(true);
    expect(entryText(cortado).startsWith("<p>\n")).toBe(true);
    expect(entryText(cortado).endsWith("\n</p>")).toBe(true);
    // Determinístico.
    expect(truncateEntry(e, 80)).toEqual(cortado);
  });
});
