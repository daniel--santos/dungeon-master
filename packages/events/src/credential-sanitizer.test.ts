// Adapted from Archon — packages/core/src/utils/credential-sanitizer.test.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: `bun:test` virou `vitest`; os casos passaram a injetar o ambiente
// pelo parâmetro `env` em vez de mexer em `process.env`, que em execução
// paralela do Vitest é estado compartilhado entre arquivos; entraram os casos
// de `sanitizeJson` e do valor curto demais, que são nossos.

import { describe, expect, it } from "vitest";

import {
  MIN_SECRET_LENGTH,
  SENSITIVE_ENV_VARS,
  sanitizeCredentials,
  sanitizeError,
  sanitizeJson,
} from "./credential-sanitizer.js";

const env = { GH_TOKEN: "ghp_test123456789" };

describe("sanitizeCredentials", () => {
  it("troca o valor de GH_TOKEN no texto", () => {
    const result = sanitizeCredentials("fatal: https://ghp_test123456789@github.com/user/repo", {
      env,
    });

    expect(result).not.toContain("ghp_test123456789");
    expect(result).toContain("[REDACTED]");
  });

  it("deixa intacto um texto sem credencial", () => {
    const input = "Mensagem de erro comum";
    expect(sanitizeCredentials(input, { env })).toBe(input);
  });

  it("apaga o userinfo de uma URL mesmo sem conhecer o token", () => {
    expect(sanitizeCredentials("https://unknown_token@github.com/user/repo", { env: {} })).toBe(
      "https://[REDACTED]@github.com/user/repo",
    );
  });

  it("troca o valor de GITLAB_TOKEN fora de uma URL", () => {
    const result = sanitizeCredentials("fatal: auth failed using token glpat-abc123456", {
      env: { GITLAB_TOKEN: "glpat-abc123456" },
    });

    expect(result).not.toContain("glpat-abc123456");
    expect(result).toContain("[REDACTED]");
  });

  it("apaga credencial no estilo oauth2 em qualquer host", () => {
    const result = sanitizeCredentials(
      "fatal: clone failed for https://oauth2:glpat-secret@gitlab.example.com/owner/repo.git",
      { env: {} },
    );

    expect(result).not.toContain("glpat-secret");
    expect(result).toContain("https://[REDACTED]@gitlab.example.com/owner/repo.git");
  });

  it("não altera URL sem credencial embutida", () => {
    const input =
      "veja https://gitlab.example.com/owner/repo e https://example.com/docs/a@b para detalhes";
    expect(sanitizeCredentials(input, { env: {} })).toBe(input);
  });

  it("apaga a chave de API de um harness", () => {
    const result = sanitizeCredentials("erro 401 com a chave sk-ant-api03-xyz", {
      env: { ANTHROPIC_API_KEY: "sk-ant-api03-xyz" },
    });

    expect(result).toBe("erro 401 com a chave [REDACTED]");
  });

  it("ignora valor curto demais, para não destruir o log inteiro", () => {
    // Uma variável definida como "true" transformaria toda ocorrência da
    // palavra em `[REDACTED]`, o que protege nada e apaga tudo.
    const curto = "1".repeat(MIN_SECRET_LENGTH - 1);
    const input = `o contador chegou a ${curto} tentativas`;

    expect(sanitizeCredentials(input, { env: { GH_TOKEN: curto } })).toBe(input);
  });
});

describe("sanitizeError", () => {
  it("devolve um Error novo com mensagem limpa", () => {
    const sanitized = sanitizeError(new Error("Falhou com ghp_test123456789"), { env });
    expect(sanitized.message).toBe("Falhou com [REDACTED]");
  });

  it("limpa também a stack", () => {
    const original = new Error("boom");
    original.stack = "Error: boom\n    at ghp_test123456789 (file.ts:1:1)";

    expect(sanitizeError(original, { env }).stack).not.toContain("ghp_test123456789");
  });
});

describe("sanitizeJson", () => {
  it("limpa strings aninhadas em objetos e arrays", () => {
    const payload = {
      command: "git push https://ghp_test123456789@github.com/u/r",
      env: ["A=1", "TOKEN=ghp_test123456789"],
      nested: { deep: { value: "ghp_test123456789" } },
    };

    const result = JSON.stringify(sanitizeJson(payload, { env }));

    expect(result).not.toContain("ghp_test123456789");
    expect(result).toContain("[REDACTED]");
  });

  it("limpa também as chaves", () => {
    const result = sanitizeJson({ ghp_test123456789: "ok" }, { env });
    expect(Object.keys(result as object)).toEqual(["[REDACTED]"]);
  });

  it("preserva números, booleanos e nulos", () => {
    expect(sanitizeJson({ n: 1, b: true, z: null }, { env })).toEqual({ n: 1, b: true, z: null });
  });

  it("corta a estrutura em vez de travar em profundidade absurda", () => {
    let deep: unknown = "fim";
    for (let i = 0; i < 100; i += 1) deep = { deep };

    expect(() => JSON.stringify(sanitizeJson(deep, { env }))).not.toThrow();
  });
});

describe("tokens de autenticação de harness", () => {
  // O caso que o spike da Fase 2C reproduziu num container de verdade
  // (`docs/adr/0001-autenticacao-em-docker.md`): a credencial entregue por
  // variável ao agente reaparece no `tool_result`, no texto do assistente e no
  // `result` final do mesmo Run. Se ela não estiver em `SENSITIVE_ENV_VARS`, o
  // log append-only fica com o token para sempre.
  const token = "sk-ant-oat01-EXEMPLO-DE-TOKEN-LONGO-0123456789";
  const harnessEnv = { CLAUDE_CODE_OAUTH_TOKEN: token };

  it("inclui as variáveis de autenticação dos três harnesses", () => {
    expect(SENSITIVE_ENV_VARS).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(SENSITIVE_ENV_VARS).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(SENSITIVE_ENV_VARS).toContain("CODEX_ACCESS_TOKEN");
    expect(SENSITIVE_ENV_VARS).toContain("GEMINI_API_KEY");
  });

  it("redige o token nas três aparições de um stream de Run", () => {
    const stream = [
      { type: "ToolResult", ok: true, output: token },
      { type: "TextDelta", text: `O comando imprimiu:\n\n${token}\n` },
      { type: "RunCompleted", summary: `terminei; o token era ${token}` },
    ];

    const limpo = JSON.stringify(sanitizeJson(stream, { env: harnessEnv }));

    expect(limpo).not.toContain(token);
    expect(limpo.split("[REDACTED]")).toHaveLength(4);
  });
});
