// Adapted from Archon — packages/core/src/utils/path-validation.test.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: `bun:test` virou vitest; os casos deixaram de depender de variáveis
// de ambiente do Archon e passaram a receber a raiz por argumento; os caminhos
// literais POSIX viraram caminhos válidos no SO que está rodando, para o mesmo
// arquivo servir Windows e macOS; acrescentados os casos de
// `normalizeAbsolutePath`, `isInside` e `samePath`.

import { resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isInside,
  isPathWithinRoot,
  normalizeAbsolutePath,
  samePath,
  validateAndResolvePath,
} from "./path-validation.js";

/** Caminho absoluto válido no SO atual, montado a partir de segmentos. */
function abs(...segments: string[]): string {
  return resolve(process.platform === "win32" ? "C:\\" : "/", ...segments);
}

const WORKSPACE = abs("dm-testes", "workspaces");
const OUTSIDE = abs("dm-testes", "outro");

describe("isPathWithinRoot", () => {
  it("aceita caminhos dentro da raiz", () => {
    expect(isPathWithinRoot(WORKSPACE, `${WORKSPACE}${sep}repo`)).toBe(true);
    expect(isPathWithinRoot(WORKSPACE, `${WORKSPACE}${sep}repo${sep}src`)).toBe(true);
    expect(isPathWithinRoot(WORKSPACE, WORKSPACE)).toBe(true);
  });

  it("aceita caminhos relativos que resolvem dentro da raiz", () => {
    expect(isPathWithinRoot(WORKSPACE, "repo")).toBe(true);
    expect(isPathWithinRoot(WORKSPACE, "./repo")).toBe(true);
    expect(isPathWithinRoot(WORKSPACE, "repo/src/file.ts")).toBe(true);
    expect(isPathWithinRoot(WORKSPACE, "repo", WORKSPACE)).toBe(true);
  });

  it("rejeita travessia por '..'", () => {
    expect(isPathWithinRoot(WORKSPACE, `${WORKSPACE}${sep}..${sep}etc${sep}senhas`)).toBe(false);
    expect(isPathWithinRoot(WORKSPACE, "../etc/senhas")).toBe(false);
    expect(isPathWithinRoot(WORKSPACE, `${WORKSPACE}${sep}repo${sep}..${sep}..${sep}etc`)).toBe(
      false,
    );
    expect(isPathWithinRoot(WORKSPACE, "foo/../../../etc/senhas", WORKSPACE)).toBe(false);
  });

  it("rejeita caminhos absolutos fora da raiz", () => {
    expect(isPathWithinRoot(WORKSPACE, OUTSIDE)).toBe(false);
    expect(isPathWithinRoot(WORKSPACE, abs("tmp", "arquivo"))).toBe(false);
  });

  it("rejeita um irmão que só compartilha o prefixo textual", () => {
    expect(isPathWithinRoot(WORKSPACE, `${WORKSPACE}-outro`)).toBe(false);
    expect(isPathWithinRoot(WORKSPACE, `${WORKSPACE}-outro${sep}repo`)).toBe(false);
  });

  it("resolve o caminho relativo contra basePath quando ele é passado", () => {
    const base = `${WORKSPACE}${sep}repo`;
    expect(isPathWithinRoot(WORKSPACE, "src", base)).toBe(true);
    expect(isPathWithinRoot(WORKSPACE, "../..", base)).toBe(false);
  });
});

describe("validateAndResolvePath", () => {
  it("devolve o caminho absoluto resolvido quando ele é válido", () => {
    expect(validateAndResolvePath(WORKSPACE, `${WORKSPACE}${sep}repo`)).toBe(
      resolve(WORKSPACE, "repo"),
    );
    expect(validateAndResolvePath(WORKSPACE, "repo")).toBe(resolve(WORKSPACE, "repo"));
    expect(validateAndResolvePath(WORKSPACE, "./src", `${WORKSPACE}${sep}repo`)).toBe(
      resolve(WORKSPACE, "repo", "src"),
    );
  });

  it("lança em travessia por '..'", () => {
    expect(() => validateAndResolvePath(WORKSPACE, "../etc/senhas")).toThrow(
      /precisa estar dentro de/,
    );
    expect(() => validateAndResolvePath(WORKSPACE, `${WORKSPACE}${sep}..${sep}etc`)).toThrow(
      /precisa estar dentro de/,
    );
  });

  it("lança em caminho absoluto fora da raiz", () => {
    expect(() => validateAndResolvePath(WORKSPACE, OUTSIDE)).toThrow(/precisa estar dentro de/);
  });

  it("cita a raiz normalizada na mensagem", () => {
    expect(() => validateAndResolvePath(WORKSPACE, OUTSIDE)).toThrow(WORKSPACE);
  });
});

describe("normalizeAbsolutePath", () => {
  it("colapsa '.' e '..' e remove o separador final", () => {
    expect(normalizeAbsolutePath(`${WORKSPACE}${sep}repo${sep}..${sep}repo${sep}`)).toBe(
      resolve(WORKSPACE, "repo"),
    );
    expect(normalizeAbsolutePath(`${WORKSPACE}${sep}.${sep}repo`)).toBe(resolve(WORKSPACE, "repo"));
  });

  it("normaliza os separadores para os do sistema atual", () => {
    const misto =
      process.platform === "win32" ? "C:/dm-testes/workspaces" : "/dm-testes/workspaces";
    expect(normalizeAbsolutePath(misto)).toBe(WORKSPACE);
    expect(normalizeAbsolutePath(misto)).not.toContain(process.platform === "win32" ? "/" : "\\");
  });

  it("é idempotente", () => {
    const uma = normalizeAbsolutePath(`${WORKSPACE}${sep}repo${sep}`);
    expect(normalizeAbsolutePath(uma)).toBe(uma);
  });

  it("preserva a raiz do sistema de arquivos", () => {
    const raiz = process.platform === "win32" ? "C:\\" : "/";
    expect(normalizeAbsolutePath(raiz)).toBe(resolve(raiz));
  });

  it("rejeita caminho relativo", () => {
    expect(() => normalizeAbsolutePath("repo")).toThrow(/precisa ser absoluto/);
    expect(() => normalizeAbsolutePath("./repo")).toThrow(/precisa ser absoluto/);
    expect(() => normalizeAbsolutePath("../repo")).toThrow(/precisa ser absoluto/);
  });

  it("rejeita string vazia e byte nulo", () => {
    expect(() => normalizeAbsolutePath("")).toThrow(/string não vazia/);
    expect(() => normalizeAbsolutePath(`${WORKSPACE}\0${sep}repo`)).toThrow(/byte nulo/);
  });
});

describe("isInside", () => {
  it("conta o próprio diretório como dentro", () => {
    expect(isInside(WORKSPACE, WORKSPACE)).toBe(true);
    expect(isInside(WORKSPACE, `${WORKSPACE}${sep}`)).toBe(true);
  });

  it("aceita descendente em qualquer profundidade", () => {
    expect(isInside(WORKSPACE, `${WORKSPACE}${sep}a`)).toBe(true);
    expect(isInside(WORKSPACE, `${WORKSPACE}${sep}a${sep}b${sep}c.txt`)).toBe(true);
  });

  it("exige que a fronteira caia em um separador", () => {
    expect(isInside(WORKSPACE, `${WORKSPACE}-outro`)).toBe(false);
    expect(isInside(WORKSPACE, `${WORKSPACE}x`)).toBe(false);
  });

  it("rejeita o pai e um irmão", () => {
    expect(isInside(`${WORKSPACE}${sep}a`, WORKSPACE)).toBe(false);
    expect(isInside(`${WORKSPACE}${sep}a`, `${WORKSPACE}${sep}b`)).toBe(false);
  });

  it("rejeita caminho relativo dos dois lados", () => {
    expect(() => isInside("repo", WORKSPACE)).toThrow(/precisa ser absoluto/);
    expect(() => isInside(WORKSPACE, "repo")).toThrow(/precisa ser absoluto/);
  });
});

// O sistema de arquivos é case-insensitive por padrão nos dois sistemas de
// primeira classe do projeto (documento técnico, 14.1). `C:\Runs` e `c:\runs`
// são o mesmo diretório, então a restrição de working directory não pode
// separá-los.
describe.runIf(process.platform === "win32" || process.platform === "darwin")(
  "isInside em sistema de arquivos case-insensitive",
  () => {
    it("ignora a caixa das letras", () => {
      expect(isInside(WORKSPACE, `${WORKSPACE.toUpperCase()}${sep}repo`)).toBe(true);
      expect(isInside(WORKSPACE.toUpperCase(), `${WORKSPACE.toLowerCase()}${sep}repo`)).toBe(true);
      expect(samePath(WORKSPACE.toUpperCase(), WORKSPACE.toLowerCase())).toBe(true);
    });

    it("continua exigindo que a fronteira caia em um separador", () => {
      expect(isInside(WORKSPACE, `${WORKSPACE.toUpperCase()}-OUTRO`)).toBe(false);
    });

    it("aceita a raiz com a caixa trocada", () => {
      expect(isPathWithinRoot(WORKSPACE.toUpperCase(), `${WORKSPACE}${sep}repo`)).toBe(true);
    });
  },
);

describe.runIf(process.platform === "linux")(
  "isInside em sistema de arquivos case-sensitive",
  () => {
    it("diferencia a caixa das letras", () => {
      expect(isInside(WORKSPACE, `${WORKSPACE.toUpperCase()}${sep}repo`)).toBe(false);
      expect(samePath(WORKSPACE.toUpperCase(), WORKSPACE.toLowerCase())).toBe(false);
    });
  },
);
