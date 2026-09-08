import { describe, expect, it } from "vitest";

import { buildFtsQuery, FTS_QUERY_MAX_TERMS } from "./fts-query.js";

describe("buildFtsQuery", () => {
  it("junta as palavras em OR, minúsculas, sem repetição e sem as curtas", () => {
    expect(buildFtsQuery("Porta do Serviço de Widgets e a porta")).toBe(
      "serviço | widgets | porta",
    );
  });

  it("fica com as doze mais longas, em ordem decrescente de tamanho", () => {
    const palavras = Array.from({ length: 20 }, (_, i) => "x".repeat(3 + i));
    const consulta = buildFtsQuery(palavras.join(" "));
    expect(consulta?.split(" | ")).toHaveLength(FTS_QUERY_MAX_TERMS);
    expect(consulta?.startsWith("x".repeat(22))).toBe(true);
  });

  it("devolve nulo quando não sobra termo", () => {
    expect(buildFtsQuery("a b c -- !!")).toBeNull();
    expect(buildFtsQuery("")).toBeNull();
  });

  it("é determinístico para a mesma entrada", () => {
    const texto = "Escreva PORT.txt com a porta do serviço de widgets registrada no projeto";
    expect(buildFtsQuery(texto)).toBe(buildFtsQuery(texto));
  });
});
