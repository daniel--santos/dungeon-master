import { describe, expect, it } from "vitest";

import { buildStepPrompt, describeStepOutput, OUTPUT_TAIL_IN_PROMPT_CHARS } from "./prompt.js";

describe("buildStepPrompt", () => {
  it("sem Task nem includeOutputsOf devolve o prompt literal", () => {
    expect(buildStepPrompt("Faça.", [])).toBe("Faça.");
  });

  it("a Task do Run vem antes das instruções do passo", () => {
    const prompt = buildStepPrompt("Analise a tarefa.", [], {
      taskPrompt: "Criar CHANGELOG.md\n\nCom uma entrada Unreleased.",
    });
    expect(prompt).toBe(
      [
        "# Tarefa",
        "",
        "Criar CHANGELOG.md",
        "",
        "Com uma entrada Unreleased.",
        "",
        "# Este passo",
        "",
        "Analise a tarefa.",
      ].join("\n"),
    );
  });

  it("anexa uma seção por step referenciado, sem substituir placeholder", () => {
    const prompt = buildStepPrompt("Implemente {{plano}}.", [
      {
        key: "plan",
        name: "Planejar",
        status: "SUCCEEDED",
        result: { kind: "agent", status: "completed", summary: "Três passos." },
        error: null,
      },
      {
        key: "check",
        name: "Conferir",
        status: "SUCCEEDED",
        result: {
          kind: "validation",
          verdict: "failed",
          exitCode: 2,
          durationMs: 5,
          stderrTail: "x",
        },
        error: null,
      },
      { key: "skipped", name: "Pulado", status: "SKIPPED", result: null, error: null },
    ]);

    expect(prompt.startsWith("Implemente {{plano}}.")).toBe(true);
    expect(prompt).toContain("## Passo «Planejar» (plan) — SUCCEEDED");
    expect(prompt).toContain("Três passos.");
    expect(prompt).toContain("Veredito: failed");
    expect(prompt).toContain("Código de saída: 2");
    expect(prompt).toContain("## Passo «Pulado» (skipped) — SKIPPED");
    expect(prompt).toContain("não produziu resultado");
  });

  it("corta a saída longa de um comando pela cauda", () => {
    const longo = "a".repeat(OUTPUT_TAIL_IN_PROMPT_CHARS + 100) + "FIM";
    const secao = describeStepOutput({
      key: "c",
      name: "C",
      status: "SUCCEEDED",
      result: { kind: "command", exitCode: 0, durationMs: 1, stdoutTail: longo },
      error: null,
    });
    expect(secao).toContain("FIM");
    expect(secao).toContain("…");
    expect(secao.length).toBeLessThan(longo.length);
  });
});
