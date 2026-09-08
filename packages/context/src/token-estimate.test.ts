import { describe, expect, it } from "vitest";

import { fastEstimateMessages, fastEstimateTokens } from "./token-estimate.js";

/**
 * O original não tem teste ao lado; estes são nossos. Eles não medem a
 * precisão contra o tiktoken — o que o orçamento precisa é de uma estimativa
 * determinística, monótona no tamanho e na ordem de grandeza certa.
 */
describe("fastEstimateTokens", () => {
  it("devolve zero para vazio e pelo menos um token para qualquer texto", () => {
    expect(fastEstimateTokens("")).toBe(0);
    expect(fastEstimateTokens("a")).toBe(1);
    expect(fastEstimateTokens(" ")).toBe(1);
  });

  it("é determinístico e cresce com o texto", () => {
    const curto = "O Worker reclama o Run e monta o contexto uma vez.";
    const longo = `${curto} ${curto} ${curto}`;
    expect(fastEstimateTokens(curto)).toBe(fastEstimateTokens(curto));
    expect(fastEstimateTokens(longo)).toBeGreaterThan(fastEstimateTokens(curto) * 2);
  });

  it("fica na ordem de grandeza de um token por palavra curta em inglês", () => {
    const texto = "the quick brown fox jumps over the lazy dog";
    const tokens = fastEstimateTokens(texto);
    expect(tokens).toBeGreaterThanOrEqual(8);
    expect(tokens).toBeLessThanOrEqual(12);
  });

  it("cobra mais por palavras acentuadas num texto em português longo", () => {
    const portugues = "configuração ".repeat(120);
    const ingles = "configuration ".repeat(120);
    expect(fastEstimateTokens(portugues)).toBeGreaterThan(fastEstimateTokens(ingles));
  });

  it("conta CJK pelo fallback por caractere, com desconto para segmentos longos", () => {
    expect(fastEstimateTokens("中")).toBe(1);
    expect(fastEstimateTokens("中文测试")).toBe(Math.round(4 * 1.3 * 0.94));
  });

  it("conta números, pontuação e quebras de linha", () => {
    expect(fastEstimateTokens("123")).toBe(1);
    expect(fastEstimateTokens("1,234,567")).toBe(5);
    expect(fastEstimateTokens("a\nb\nc")).toBe(5);
  });
});

describe("fastEstimateMessages", () => {
  it("soma a serialização JSON de cada mensagem mais a sobrecarga do array", () => {
    const mensagem = { role: "user", content: "olá" };
    const uma = fastEstimateMessages([mensagem]);
    const duas = fastEstimateMessages([mensagem, mensagem]);
    expect(uma).toBe(fastEstimateTokens(JSON.stringify(mensagem)) + 1);
    expect(duas).toBe(fastEstimateTokens(JSON.stringify(mensagem)) * 2 + 1);
  });

  it("aceita um replacer de JSON", () => {
    const mensagem = { role: "user", content: "x".repeat(200), secret: "y".repeat(200) };
    const com = fastEstimateMessages([mensagem]);
    const sem = fastEstimateMessages([mensagem], (key, value) =>
      key === "secret" ? undefined : value,
    );
    expect(sem).toBeLessThan(com);
  });
});
