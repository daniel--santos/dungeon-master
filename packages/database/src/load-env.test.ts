import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadWorkspaceEnv, resolveEnvFilePaths } from "@dungeon-master/platform";
import { config as dotenvConfig } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * O `.env` da raiz do monorepo precisa valer para quem roda de dentro de um
 * pacote — que é como todo comando documentado roda (`pnpm --filter` põe o
 * `cwd` no diretório do pacote).
 *
 * O teste monta uma raiz de mentira num diretório temporário: um
 * `pnpm-workspace.yaml` marcando a raiz, um `.env` ao lado dele e um
 * subdiretório fazendo o papel do pacote.
 */
describe("carga do .env a partir de um pacote", () => {
  let root: string;
  let packageDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "dm-env-root-"));
    packageDir = join(root, "packages", "database");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    writeFileSync(join(root, ".env"), "DATABASE_URL=postgresql://raiz\nAPI_PORT=4000\n");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lê o .env da raiz do monorepo com o cwd num subdiretório", () => {
    const injected: NodeJS.ProcessEnv = {};

    loadWorkspaceEnv(dotenvConfig, { cwd: packageDir, processEnv: injected });

    expect(injected["DATABASE_URL"]).toBe("postgresql://raiz");
    expect(injected["API_PORT"]).toBe("4000");
  });

  it("dá precedência ao .env do próprio pacote sobre o da raiz", () => {
    writeFileSync(join(packageDir, ".env"), "DATABASE_URL=postgresql://pacote\n");

    const injected: NodeJS.ProcessEnv = {};

    loadWorkspaceEnv(dotenvConfig, { cwd: packageDir, processEnv: injected });

    expect(injected["DATABASE_URL"]).toBe("postgresql://pacote");
    // O da raiz continua valendo para o que o pacote não define.
    expect(injected["API_PORT"]).toBe("4000");

    rmSync(join(packageDir, ".env"));
  });

  it("procura o .env do pacote antes do da raiz", () => {
    expect(resolveEnvFilePaths(packageDir)).toEqual([join(packageDir, ".env"), join(root, ".env")]);
  });

  /**
   * Caracterização do que quebrava: `import "dotenv/config"` resolve apenas
   * `path.resolve(process.cwd(), ".env")` e nunca sobe diretório. Com o `cwd`
   * no pacote, o `.env` da raiz não é lido — em silêncio. É por isso que os
   * pontos de entrada não podem voltar a usar o import de conveniência.
   */
  it("dotenv sozinho, olhando só para o cwd, não acha o .env da raiz", () => {
    const injected: NodeJS.ProcessEnv = {};
    const semEnv = join(root, "packages", "sem-env");
    mkdirSync(semEnv, { recursive: true });

    dotenvConfig({ path: [join(semEnv, ".env")], processEnv: injected, quiet: true });

    expect(injected["DATABASE_URL"]).toBeUndefined();
  });
});
