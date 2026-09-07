// Adapted from Sandcastle — src/boundedTail.test.ts@e99f832
// Copyright (c) 2026 Matt Pocock. Licensed under the MIT License.
// Changes: nomes dos casos traduzidos para o português; asserções idênticas.

import { describe, expect, it } from "vitest";

import { BoundedTail, MAX_TAIL_CHARS } from "./bounded-tail.js";

describe("BoundedTail", () => {
  it("devolve string vazia quando nada foi empurrado", () => {
    const tail = new BoundedTail(100);
    expect(tail.toString()).toBe("");
  });

  it("guarda tudo enquanto cabe no orçamento", () => {
    const tail = new BoundedTail(100, "\n");
    tail.push("alpha");
    tail.push("beta");
    expect(tail.toString()).toBe("alpha\nbeta");
  });

  it("descarta os mais antigos quando o comprimento juntado passa do teto", () => {
    const tail = new BoundedTail(10, "\n");
    tail.push("aaaa"); // 4
    tail.push("bbbb"); // 4 -> "aaaa\nbbbb" = 9
    tail.push("cccc"); // daria 14 -> descarta "aaaa"

    expect(tail.toString()).toBe("bbbb\ncccc");
    expect(tail.toString().length).toBeLessThanOrEqual(10);
  });

  it("nunca passa do teto ao longo de muitos pushes", () => {
    const tail = new BoundedTail(50, "\n");
    for (let i = 0; i < 10_000; i++) {
      tail.push(`line-${String(i)}`);
    }
    expect(tail.toString().length).toBeLessThanOrEqual(50);
    // A linha mais recente precisa continuar presente.
    expect(tail.toString()).toContain("line-9999");
  });

  it("trunca um item grande demais à própria cauda", () => {
    const tail = new BoundedTail(10, "\n");
    tail.push("0123456789ABCDEF"); // 16 caracteres, sem quebra de linha
    expect(tail.toString()).toBe("6789ABCDEF");
    expect(tail.toString().length).toBe(10);
  });

  it("mantém a cauda de um item grande mesmo com itens anteriores", () => {
    const tail = new BoundedTail(10, "\n");
    tail.push("hello");
    tail.push("X".repeat(100));
    expect(tail.toString()).toBe("X".repeat(10));
  });

  it("por padrão concatena sem separador", () => {
    const tail = new BoundedTail(100);
    tail.push("ab");
    tail.push("cd");
    expect(tail.toString()).toBe("abcd");
  });

  it("expõe um orçamento padrão sensato", () => {
    expect(MAX_TAIL_CHARS).toBe(64 * 1024);
  });
});
