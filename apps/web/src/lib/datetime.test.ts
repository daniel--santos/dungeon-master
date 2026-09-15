import { describe, expect, it } from "vitest";

import { formatUtcDate, formatUtcDateTime } from "@/lib/datetime";

/**
 * As datas que o domínio guarda em UTC precisam aparecer em UTC.
 *
 * A vigência de preço e o `day` do rollup são UTC por construção. Formatá-los
 * no fuso do browser fazia uma vigência aberta em 1º de setembro aparecer como
 * 31 de agosto para quem está em São Paulo — a mesma linha com dois dias
 * diferentes conforme quem olha, e a comparação com a janela das métricas
 * deixando de fechar por um dia.
 */

describe("datas em UTC", () => {
  it("meia-noite UTC não recua um dia no fuso do browser", () => {
    expect(formatUtcDate("2026-09-01T00:00:00.000Z")).toBe("01/09/2026");
  });

  it("o fim do dia UTC não avança um dia", () => {
    expect(formatUtcDate("2026-09-01T23:59:00.000Z")).toBe("01/09/2026");
  });

  it("a forma com hora diz que é UTC, em vez de deixar o leitor adivinhar", () => {
    expect(formatUtcDateTime("2026-09-01T00:00:00.000Z")).toContain("UTC");
    expect(formatUtcDateTime("2026-09-01T00:00:00.000Z")).toContain("01/09/2026");
  });

  it("uma data impossível vira travessão, e não `Invalid Date`", () => {
    expect(formatUtcDate("não é data")).toBe("—");
    expect(formatUtcDateTime("não é data")).toBe("—");
  });
});
