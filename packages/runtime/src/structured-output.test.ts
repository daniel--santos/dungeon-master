import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  applyStructuredOutputInstruction,
  buildStructuredOutputInstruction,
  buildStructuredOutputRetryPrompt,
  extractStructuredOutput,
  findLastTagContent,
  unwrapFences,
} from "./structured-output.js";

const schema = z.object({ status: z.string(), files: z.array(z.string()) });

describe("extractStructuredOutput", () => {
  it("extrai e valida um bloco simples", async () => {
    const text = 'blá blá\n<result>{"status":"completed","files":["OLA.md"]}</result>\nfim';
    const result = await extractStructuredOutput(text, { schema });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ status: "completed", files: ["OLA.md"] });
  });

  it("a última ocorrência vence", async () => {
    // O caso comum é o agente errar, perceber e emitir de novo; pegar o
    // primeiro bloco escolheria justamente a versão errada.
    const text =
      '<result>{"status":"a","files":[]}</result> ... <result>{"status":"b","files":[]}</result>';
    const result = await extractStructuredOutput(text, { schema });

    expect(result.ok && result.value.status).toBe("b");
  });

  it("tira a cerca de código", async () => {
    const text = '<result>\n```json\n{"status":"ok","files":[]}\n```\n</result>';
    const result = await extractStructuredOutput(text, { schema });

    expect(result.ok).toBe(true);
  });

  it("tag ausente devolve TAG_NOT_FOUND sem lançar", async () => {
    const result = await extractStructuredOutput("nenhum bloco aqui", { schema });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("TAG_NOT_FOUND");
      expect(result.raw).toBeUndefined();
    }
  });

  it("JSON inválido devolve INVALID_JSON com o texto bruto", async () => {
    const result = await extractStructuredOutput("<result>{isto não é json}</result>", { schema });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("INVALID_JSON");
      expect(result.raw).toContain("isto não é json");
    }
  });

  it("schema reprovado devolve as issues", async () => {
    const result = await extractStructuredOutput('<result>{"status":1,"files":[]}</result>', {
      schema,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("SCHEMA_VALIDATION");
      expect(result.issues?.length).toBeGreaterThan(0);
    }
  });

  it("aceita uma tag diferente da padrão", async () => {
    const result = await extractStructuredOutput('<saida>{"status":"ok","files":[]}</saida>', {
      schema,
      tag: "saida",
    });

    expect(result.ok).toBe(true);
  });

  it("recusa um validador que não é Standard Schema", async () => {
    await expect(
      extractStructuredOutput("<result>{}</result>", {
        schema: { parse: () => ({}) } as never,
      }),
    ).rejects.toThrow(/Standard Schema/);
  });
});

describe("instrução e retentativa", () => {
  it("a instrução nomeia a tag e proíbe cerca", () => {
    const instruction = buildStructuredOutputInstruction("saida");

    expect(instruction).toContain("<saida>");
    expect(instruction).toContain("sem cerca de código");
  });

  it("acrescenta a instrução ao prompt uma vez só", () => {
    const prompt = "Faça o trabalho.";
    const once = applyStructuredOutputInstruction(prompt, { schema });
    const twice = applyStructuredOutputInstruction(once, { schema });

    expect(once).not.toBe(prompt);
    expect(twice).toBe(once);
  });

  it("não mexe no prompt quando não há schema", () => {
    expect(applyStructuredOutputInstruction("oi", undefined)).toBe("oi");
  });

  it("usa a instrução do chamador quando ela vem", () => {
    const result = applyStructuredOutputInstruction("oi", {
      schema,
      instruction: "\nEmita <result> ao final.",
    });

    expect(result).toContain("Emita <result> ao final.");
  });

  it("o prompt de retentativa pede só o bloco corrigido", () => {
    const retry = buildStructuredOutputRetryPrompt(
      {
        ok: false,
        reason: "SCHEMA_VALIDATION",
        message: "não bateu",
        raw: '{"status":1}',
        issues: [{ message: "esperava string", path: ["status"] }],
      },
      "result",
    );

    expect(retry).toContain("não bateu");
    expect(retry).toContain("status: esperava string");
    expect(retry).toContain('{"status":1}');
    expect(retry).toContain("Não altere arquivos nem execute comandos.");
  });
});

describe("auxiliares de extração", () => {
  it("`findLastTagContent` ignora abertura sem fechamento", () => {
    expect(findLastTagContent("<a>1</a><a>quebrado", "a")).toBe("1");
    expect(findLastTagContent("nada", "a")).toBeUndefined();
  });

  it("`unwrapFences` devolve o texto quando não há cerca", () => {
    expect(unwrapFences('{"a":1}')).toBe('{"a":1}');
    expect(unwrapFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unwrapFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
