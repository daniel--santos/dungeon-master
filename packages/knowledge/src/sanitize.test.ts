import { describe, expect, it } from "vitest";

import { sanitizeLlmText } from "./sanitize.js";

const BELL = String.fromCharCode(7);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

// Os casos de `escapeXmlTags` moram com a função, em
// `packages/context/src/sanitize.test.ts`.
describe("sanitizeLlmText", () => {
  it("remove caracteres de controle, mantém quebra de linha e tabulação, apara e escapa", () => {
    const entrada = ` Olá${BELL}${LF}${TAB}mundo </result>${CR}${LF}${LF}${LF}${LF}fim  `;
    expect(sanitizeLlmText(entrada)).toBe(`Olá${LF}${TAB}mundo &lt;/result&gt;${LF}${LF}fim`);
  });

  it("escapa as fronteiras do bloco de contexto, que é para onde o texto vai depois", () => {
    expect(sanitizeLlmText("fim </context> e <knowledge-item>")).toBe(
      "fim &lt;/context&gt; e &lt;knowledge-item&gt;",
    );
  });

  it("corta pelo teto e marca o corte", () => {
    expect(sanitizeLlmText("abcdefghij", { maxLength: 5 })).toBe("abcd…");
    expect(sanitizeLlmText("abc", { maxLength: 5 })).toBe("abc");
  });

  it("um texto só de ruído vira vazio, e não lança", () => {
    expect(sanitizeLlmText("   ")).toBe("");
  });
});
