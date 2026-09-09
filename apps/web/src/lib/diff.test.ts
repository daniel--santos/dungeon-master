import { describe, expect, it } from "vitest";

import { diffLines, splitLines, summarizeDiff } from "@/lib/diff";

describe("diff de linhas", () => {
  it("dois textos iguais são só linhas iguais", () => {
    const lines = diffLines("a\nb\nc", "a\nb\nc");
    expect(lines.map((line) => line.kind)).toEqual(["same", "same", "same"]);
    expect(summarizeDiff(lines)).toEqual({ added: 0, removed: 0 });
  });

  it("marca o que entrou e o que saiu, na ordem, e numera os dois lados", () => {
    const lines = diffLines("um\ndois\ntrês", "um\ndois e meio\ntrês\nquatro");
    expect(lines).toEqual([
      { kind: "same", text: "um", from: 1, to: 1 },
      { kind: "removed", text: "dois", from: 2, to: null },
      { kind: "added", text: "dois e meio", from: null, to: 2 },
      { kind: "same", text: "três", from: 3, to: 3 },
      { kind: "added", text: "quatro", from: null, to: 4 },
    ]);
    expect(summarizeDiff(lines)).toEqual({ added: 2, removed: 1 });
  });

  it("um texto vazio é zero linhas, e a outra ponta sai inteira", () => {
    expect(splitLines("")).toEqual([]);
    expect(diffLines("", "a\nb").map((line) => line.kind)).toEqual(["added", "added"]);
    expect(diffLines("a\nb", "").map((line) => line.kind)).toEqual(["removed", "removed"]);
  });

  it("acha a subsequência comum mais longa em vez de casar linha a linha", () => {
    // Uma linha inserida no começo desloca tudo; um diff ingênuo marcaria
    // todas como trocadas.
    const lines = diffLines("a\nb\nc", "x\na\nb\nc");
    expect(lines.map((line) => line.kind)).toEqual(["added", "same", "same", "same"]);
  });

  it("aceita quebras de linha do Windows", () => {
    expect(diffLines("a\r\nb", "a\nb").every((line) => line.kind === "same")).toBe(true);
  });
});
