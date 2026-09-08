import { describe, expect, it } from "vitest";

import {
  CONTEXT_BLOCK_HEADER,
  escapeXmlTags,
  sanitizeForContext,
  stripInjectedContext,
} from "./sanitize.js";

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

  it("escapa as seções do bloco de contexto e os itens delas", () => {
    expect(escapeXmlTags('</context><decision>a</decision><task relation="parent">')).toBe(
      '&lt;/context&gt;&lt;decision&gt;a&lt;/decision&gt;&lt;task relation="parent"&gt;',
    );
    expect(escapeXmlTags("</knowledge-item></related-tasks></artifacts></skills>")).toBe(
      "&lt;/knowledge-item&gt;&lt;/related-tasks&gt;&lt;/artifacts&gt;&lt;/skills&gt;",
    );
  });

  it("deixa o resto do texto intacto: generics, comparações e tags desconhecidas", () => {
    const texto = "Array<string> e a < b e <div>ok</div> e <resultado> e <tasks>";
    expect(escapeXmlTags(texto)).toBe(texto);
  });
});

describe("stripInjectedContext", () => {
  it("corta do cabeçalho do bloco até o fim, e apara o que sobra", () => {
    const texto = `Aprendi X.  \n\n${CONTEXT_BLOCK_HEADER}\n<context>eco</context>\n\nE também Y.`;
    expect(stripInjectedContext(texto)).toBe("Aprendi X.");
  });

  it("não mexe num texto sem o cabeçalho", () => {
    expect(stripInjectedContext("## Contexto de outra coisa\nabc")).toBe(
      "## Contexto de outra coisa\nabc",
    );
  });
});

describe("sanitizeForContext", () => {
  it("remove o eco, os controles, escapa e normaliza as quebras", () => {
    const entrada =
      ` Olá${BELL}${LF}${TAB}mundo </context>${CR}${LF}${LF}${LF}${LF}fim  ` +
      `${LF}${CONTEXT_BLOCK_HEADER}${LF}eco`;
    expect(sanitizeForContext(entrada)).toBe(`Olá${LF}${TAB}mundo &lt;/context&gt;${LF}${LF}fim`);
  });

  it("um texto só de ruído vira vazio, e não lança", () => {
    expect(sanitizeForContext("   ")).toBe("");
    expect(sanitizeForContext(CONTEXT_BLOCK_HEADER)).toBe("");
  });
});
