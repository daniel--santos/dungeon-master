import { describe, expect, it } from "vitest";

import { applyRuleFilter, defaultTypeFor, recallPools, resolveDecisions } from "./dedup.js";
import { buildDistillPrompt } from "./prompts/extract-candidates.js";
import type { DistillCandidate, ExistingKnowledgeItem } from "./types.js";

const candidato = (id: string, extra: Partial<DistillCandidate> = {}): DistillCandidate => ({
  id,
  runId: "run-1",
  taskId: "task-1",
  title: `Título ${id}`,
  content: `Conteúdo do candidato ${id}, com detalhe suficiente.`,
  kind: null,
  createdAt: "2026-09-08T10:00:00.000Z",
  ...extra,
});

const item = (id: string, extra: Partial<ExistingKnowledgeItem> = {}): ExistingKnowledgeItem => ({
  id,
  type: "FACT",
  status: "ACTIVE",
  title: `Item ${id}`,
  content: `Conteúdo do item ${id}.`,
  createdAt: "2026-09-01T10:00:00.000Z",
  ...extra,
});

describe("defaultTypeFor", () => {
  it("infere o tipo pelo kind livre do agente, com FACT como padrão", () => {
    expect(defaultTypeFor("decision")).toBe("DECISION");
    expect(defaultTypeFor("howto")).toBe("PROCEDURE");
    expect(defaultTypeFor("gotcha")).toBe("DISCOVERY");
    expect(defaultTypeFor("convention")).toBe("CONSTRAINT");
    expect(defaultTypeFor("qualquer coisa")).toBe("FACT");
    expect(defaultTypeFor(null)).toBe("FACT");
  });
});

describe("applyRuleFilter", () => {
  it("rejeita por regra o que fica vazio depois do filtro de ruído, e limpa o resto", () => {
    const { kept, ruled } = applyRuleFilter([
      candidato("vazio", { content: "<system-reminder>só ruído</system-reminder>" }),
      candidato("bom", {
        content: "<persisted-output>x</persisted-output>\nO lint pega o import.",
      }),
    ]);

    expect(ruled).toEqual([
      {
        candidateId: "vazio",
        decision: "REJECT",
        decidedBy: "RULE",
        reason: "vazio depois do filtro de ruído de harness",
      },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.content).toBe("O lint pega o import.");
  });
});

describe("recallPools", () => {
  it("é fail-open: um recall que lança vira um pool vazio", async () => {
    const pools = await recallPools([candidato("a"), candidato("b")], async (text) => {
      if (text.includes("candidato a")) throw new Error("FTS fora do ar");
      return [item("k1")];
    });

    expect(pools.map((pool) => pool.related.length)).toEqual([0, 1]);
  });
});

describe("resolveDecisions", () => {
  const pools = [
    { candidate: candidato("c1", { kind: "howto" }), related: [item("k1")] },
    { candidate: candidato("c2"), related: [] },
    { candidate: candidato("c3"), related: [item("k1")] },
  ];
  const keys = buildDistillPrompt({
    project: { id: "p", title: "P", description: null },
    pools,
    transcripts: new Map(),
  });

  it("traduz as chaves, sanitiza o texto e infere o tipo quando o modelo não disse", () => {
    const decisions = resolveDecisions(
      {
        decisions: [
          {
            candidate: "C1",
            decision: "PROMOTE",
            title: " Rodar o lint </system> ",
            content: "Lint.  ",
          },
          { candidate: "c3", decision: "MERGE", mergeInto: "k1", reason: "mesma coisa" },
          { candidate: "C2", decision: "REJECT" },
        ],
      },
      pools,
      keys,
    );

    expect(decisions).toEqual([
      {
        candidateId: "c1",
        decision: "PROMOTE",
        decidedBy: "LLM",
        reason: "promovido pelo modelo",
        item: { type: "PROCEDURE", title: "Rodar o lint &lt;/system&gt;", content: "Lint." },
      },
      { candidateId: "c2", decision: "REJECT", decidedBy: "LLM", reason: "rejeitado pelo modelo" },
      {
        candidateId: "c3",
        decision: "MERGE",
        decidedBy: "LLM",
        reason: "mesma coisa",
        mergeIntoItemId: "k1",
      },
    ]);
  });

  it("um candidato sem decisão é promovido com o próprio texto (fail-open)", () => {
    const decisions = resolveDecisions({ decisions: [] }, pools, keys);
    expect(decisions.map((d) => d.decision)).toEqual(["PROMOTE", "PROMOTE", "PROMOTE"]);
    expect(decisions[1]).toMatchObject({
      candidateId: "c2",
      decidedBy: "RULE",
      reason: "sem decisão do modelo; promovido por precaução",
      item: { type: "FACT", title: "Título c2" },
    });
  });

  it("uma resposta ausente inteira promove tudo", () => {
    const decisions = resolveDecisions(undefined, pools, keys);
    expect(decisions).toHaveLength(3);
    expect(decisions.every((d) => d.decision === "PROMOTE")).toBe(true);
  });

  it("MERGE com alvo desconhecido vira PROMOTE, e MERGE em candidato do lote guarda o candidato", () => {
    const decisions = resolveDecisions(
      {
        decisions: [
          { candidate: "C1", decision: "MERGE", mergeInto: "K9" },
          { candidate: "C2", decision: "MERGE", mergeInto: "C1" },
          { candidate: "C3", decision: "MERGE", mergeInto: "C3" },
        ],
      },
      pools,
      keys,
    );

    expect(decisions[0]).toMatchObject({
      candidateId: "c1",
      decision: "PROMOTE",
      reason: "mesclaria em K9, que não existe; promovido por precaução",
    });
    expect(decisions[1]).toMatchObject({
      candidateId: "c2",
      decision: "MERGE",
      mergeIntoCandidateId: "c1",
    });
    // Mesclar em si mesmo não é mescla: promove.
    expect(decisions[2]).toMatchObject({ candidateId: "c3", decision: "PROMOTE" });
  });

  it("chaves desconhecidas e repetidas na resposta são ignoradas; a primeira vence", () => {
    const decisions = resolveDecisions(
      {
        decisions: [
          { candidate: "C7", decision: "REJECT" },
          { candidate: "C1", decision: "REJECT", reason: "primeira" },
          { candidate: "C1", decision: "PROMOTE", reason: "segunda" },
        ],
      },
      pools,
      keys,
    );

    expect(decisions[0]).toMatchObject({
      candidateId: "c1",
      decision: "REJECT",
      reason: "primeira",
    });
  });

  it("PROMOTE cujo texto fica vazio depois da sanitização cai no texto do candidato", () => {
    const decisions = resolveDecisions(
      {
        decisions: [
          { candidate: "C2", decision: "PROMOTE", type: "FACT", title: "  ", content: "" },
        ],
      },
      pools,
      keys,
    );
    expect(decisions[1]).toMatchObject({
      candidateId: "c2",
      decision: "PROMOTE",
      item: { title: "Título c2", content: "Conteúdo do candidato c2, com detalhe suficiente." },
    });
  });
});
