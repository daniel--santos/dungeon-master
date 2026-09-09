import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { describe, expect, it } from "vitest";

import {
  findWorkspaceRoot,
  loadWorkspaceEnv,
  resolveEnvFilePaths,
  WORKSPACE_ROOT_MARKER,
} from "./workspace-env.js";

/** Monta uma raiz de mentira com o marcador e devolve raiz e pacote. */
function makeWorkspace(): { root: string; packageDir: string } {
  const root = mkdtempSync(join(tmpdir(), "dm-workspace-"));
  const packageDir = join(root, "packages", "alvo");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(root, WORKSPACE_ROOT_MARKER), 'packages:\n  - "packages/*"\n');
  return { root, packageDir };
}

describe("findWorkspaceRoot", () => {
  it("sobe do pacote até o diretório com o marcador", () => {
    const { root, packageDir } = makeWorkspace();

    try {
      expect(findWorkspaceRoot(packageDir)).toBe(root);
      expect(findWorkspaceRoot(root)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("para na raiz do sistema de arquivos em vez de subir para sempre", () => {
    // Não existe `pnpm-workspace.yaml` na raiz de um volume. O que o teste
    // garante é a parada: sem ela, `dirname` devolveria o mesmo caminho para
    // sempre e a busca giraria em falso no boot de todo processo.
    expect(findWorkspaceRoot(parse(tmpdir()).root)).toBeUndefined();
  });
});

describe("resolveEnvFilePaths", () => {
  it("põe o .env do pacote antes do .env da raiz", () => {
    const { root, packageDir } = makeWorkspace();

    try {
      expect(resolveEnvFilePaths(packageDir)).toEqual([
        join(packageDir, ".env"),
        join(root, ".env"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("não repete o caminho quando o cwd já é a raiz", () => {
    const { root } = makeWorkspace();

    try {
      expect(resolveEnvFilePaths(root)).toEqual([join(root, ".env")]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("loadWorkspaceEnv", () => {
  it("entrega ao dotenv a lista de caminhos e o destino recebido", () => {
    const { root, packageDir } = makeWorkspace();
    const destino: NodeJS.ProcessEnv = {};
    const chamadas: { path: string[]; processEnv?: NodeJS.ProcessEnv }[] = [];

    try {
      const caminhos = loadWorkspaceEnv(
        (options) => {
          chamadas.push(options);
          return {};
        },
        { cwd: packageDir, processEnv: destino },
      );

      expect(caminhos).toEqual([join(packageDir, ".env"), join(root, ".env")]);
      expect(chamadas).toEqual([{ path: caminhos, processEnv: destino }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("omite processEnv quando ninguém pediu um destino, para o dotenv usar process.env", () => {
    const { root, packageDir } = makeWorkspace();
    const chamadas: { path: string[]; processEnv?: NodeJS.ProcessEnv }[] = [];

    try {
      loadWorkspaceEnv(
        (options) => {
          chamadas.push(options);
          return {};
        },
        { cwd: packageDir },
      );

      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]).not.toHaveProperty("processEnv");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
