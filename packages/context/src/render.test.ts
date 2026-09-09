import { describe, expect, it } from "vitest";

import type { BudgetedSection } from "./budget.js";
import {
  CONTEXT_PREAMBLE,
  frameTokens,
  renderContext,
  renderFrame,
  toContextSection,
} from "./render.js";
import { CONTEXT_BLOCK_HEADER } from "./sanitize.js";
import { SKILLS_HEADING, SKILLS_PREAMBLE } from "./sections/skills.js";
import { fastEstimateTokens } from "./token-estimate.js";
import type { EntryDraft } from "./types.js";

function entry(id: string, text: string): EntryDraft {
  return {
    item: {
      id,
      kind: "SKILL",
      title: id,
      reason: "LOADOUT_SKILL",
      score: null,
      tokens: 1,
      truncated: false,
    },
    prefix: text,
    content: "",
    suffix: "",
    truncatable: false,
  };
}

function section(input: Partial<BudgetedSection> & Pick<BudgetedSection, "kind">): BudgetedSection {
  return {
    title: input.kind,
    tag: "s",
    entries: [],
    tokens: 0,
    budgetTokens: 0,
    truncated: false,
    ...input,
  };
}

describe("render", () => {
  it("a moldura começa pelo cabeçalho fixo e fecha o bloco; a estimativa é a dela", () => {
    const frame = renderFrame();
    expect(frame.startsWith(CONTEXT_BLOCK_HEADER)).toBe(true);
    expect(frame.startsWith(CONTEXT_PREAMBLE)).toBe(true);
    expect(frame.endsWith("<context>\n</context>")).toBe(true);
    expect(frameTokens()).toBe(fastEstimateTokens(frame));
  });

  it("sem trecho nenhum o bloco é vazio, e não uma moldura oca", () => {
    expect(renderContext([])).toBe("");
    expect(renderContext([section({ kind: "KNOWLEDGE" })])).toBe("");
  });

  it("renderiza só as seções com trecho, na ordem recebida, com a tag envolvente quando há", () => {
    const texto = renderContext([
      section({
        kind: "SUMMARY",
        tag: null,
        entries: [entry("r", "<project-summary>\nR\n</project-summary>")],
      }),
      section({ kind: "DECISIONS", tag: "decisions", entries: [] }),
      section({ kind: "LINEAGE", tag: "related-tasks", entries: [entry("t", "<task/>")] }),
    ]);
    expect(texto).toBe(
      `${CONTEXT_PREAMBLE}<context>\n` +
        "<project-summary>\nR\n</project-summary>\n" +
        "<related-tasks>\n<task/>\n</related-tasks>\n" +
        "</context>",
    );
  });

  it("as Habilidades saem depois do bloco, com cabeçalho e preâmbulo; sozinhas, sem bloco", () => {
    const habilidades = section({
      kind: "SKILLS",
      tag: null,
      entries: [entry("a", "- a"), entry("b", '<skill name="b">\nB\n</skill>')],
    });
    const comBloco = renderContext([
      section({ kind: "SUMMARY", tag: null, entries: [entry("r", "<project-summary/>")] }),
      habilidades,
    ]);
    expect(comBloco).toBe(
      `${CONTEXT_PREAMBLE}<context>\n<project-summary/>\n</context>\n\n` +
        `${SKILLS_HEADING}\n\n${SKILLS_PREAMBLE}\n\n- a\n<skill name="b">\nB\n</skill>`,
    );

    const sozinhas = renderContext([section({ kind: "KNOWLEDGE", tag: "knowledge" }), habilidades]);
    expect(sozinhas.startsWith(SKILLS_HEADING)).toBe(true);
    expect(sozinhas).not.toContain("<context>");
  });

  it("toContextSection leva os itens e as contas, sem o texto", () => {
    const secao = section({
      kind: "SKILLS",
      entries: [entry("a", "- a")],
      tokens: 7,
      budgetTokens: 12,
      truncated: true,
    });
    expect(toContextSection(secao)).toEqual({
      kind: "SKILLS",
      title: "SKILLS",
      items: [
        {
          id: "a",
          kind: "SKILL",
          title: "a",
          reason: "LOADOUT_SKILL",
          score: null,
          tokens: 1,
          truncated: false,
        },
      ],
      tokens: 7,
      budgetTokens: 12,
      truncated: true,
    });
  });
});
