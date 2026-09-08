import { describe, expect, it } from "vitest";

import { escapeXmlTags, sanitizeLlmText } from "./sanitize.js";

const BELL = String.fromCharCode(7);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

describe("escapeXmlTags", () => {
  it("escapa as tags de fronteira, abrindo e fechando, em qualquer caixa", () => {
    expect(escapeXmlTags("fim </knowledge> e <SYSTEM> de novo")).toBe(
      "fim &lt;/knowledge&gt; e &lt;SYSTEM&gt; de novo",
    );
    expect(escapeXmlTags('<candidate id="1">x</candidate>')).toBe(
      '&lt;candidate id="1"&gt;x&lt;/candidate&gt;',
    );
  });

  it("deixa o resto do texto intacto: generics, comparações e tags desconhecidas", () => {
    const texto = "Array<string> e a < b e <div>ok</div> e <resultado>";
    expect(escapeXmlTags(texto)).toBe(texto);
  });
});

describe("sanitizeLlmText", () => {
  it("remove caracteres de controle, mantém quebra de linha e tabulação, apara e escapa", () => {
    const entrada = ` Olá${BELL}${LF}${TAB}mundo </result>${CR}${LF}${LF}${LF}${LF}fim  `;
    expect(sanitizeLlmText(entrada)).toBe(`Olá${LF}${TAB}mundo &lt;/result&gt;${LF}${LF}fim`);
  });

  it("corta pelo teto e marca o corte", () => {
    expect(sanitizeLlmText("abcdefghij", { maxLength: 5 })).toBe("abcd…");
    expect(sanitizeLlmText("abc", { maxLength: 5 })).toBe("abc");
  });

  it("um texto só de ruído vira vazio, e não lança", () => {
    expect(sanitizeLlmText("   ")).toBe("");
  });
});
