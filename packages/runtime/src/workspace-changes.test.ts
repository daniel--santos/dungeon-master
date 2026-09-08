import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildGitEnv } from "./env.js";
import { collectProcess } from "./process.js";
import { createWorkspaceManager } from "./workspace.js";

/**
 * A coleta de mudanças do worktree, que é de onde saem os `Artifact` de um
 * harness que não os emite sozinho.
 */

let sandbox: string;
let repo: string;

async function git(args: readonly string[], cwd: string): Promise<string> {
  const result = await collectProcess("git", args, { cwd, env: buildGitEnv(), timeoutMs: 60_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} falhou (${String(result.code)}): ${result.stderr}`);
  }
  return result.stdout;
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "dm-changes-"));
  repo = join(sandbox, "repositorio");
  await git(["init", "-q", "-b", "main", repo], sandbox);
  await writeFile(join(repo, "README.md"), "# base\n");
  await writeFile(join(repo, "apagado.txt"), "some\n");
  await git(["add", "."], repo);
  await git(["commit", "-q", "-m", "base"], repo);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
    () => undefined,
  );
});

describe("collectChanges", () => {
  it("junta o que foi commitado e o que ficou na área de trabalho", async () => {
    const manager = createWorkspaceManager({ worktreesRoot: join(sandbox, "wt") });
    const handle = await manager.create({ repoPath: repo, runId: "run-changes" });

    // Commitado: um arquivo novo e um apagado.
    await writeFile(join(handle.path, "OLA.md"), "Ola do Dungeon Master.\n");
    await unlink(join(handle.path, "apagado.txt"));
    await git(["add", "-A"], handle.path);
    await git(["commit", "-q", "-m", "chore: adiciona OLA.md"], handle.path);

    // Não commitado: um modificado e um não rastreado com espaço no nome.
    await writeFile(join(handle.path, "README.md"), "# base\n\nmexido\n");
    await writeFile(join(handle.path, "com espaço.txt"), "acentuação\n");

    const mudancas = await manager.collectChanges(handle.path, handle.baseCommit);
    const porCaminho = new Map(mudancas.map((mudanca) => [mudanca.path, mudanca]));

    expect([...porCaminho.keys()].sort()).toEqual([
      "OLA.md",
      "README.md",
      "apagado.txt",
      "com espaço.txt",
    ]);

    expect(porCaminho.get("OLA.md")?.change).toBe("ADDED");
    // O hash do blob commitado vem de graça no `git diff --raw`.
    expect(porCaminho.get("OLA.md")?.sha).toHaveLength(40);
    expect(porCaminho.get("OLA.md")?.bytes).toBeGreaterThan(0);

    expect(porCaminho.get("apagado.txt")?.change).toBe("DELETED");
    expect(porCaminho.get("apagado.txt")?.bytes).toBeUndefined();

    expect(porCaminho.get("README.md")?.change).toBe("MODIFIED");
    expect(porCaminho.get("com espaço.txt")?.change).toBe("ADDED");
    // Um caminho com espaço e acento passa intacto por causa do `-z`; com
    // saída por linha ele viria entre aspas e com escapes.
    expect(porCaminho.get("com espaço.txt")?.bytes).toBeGreaterThan(0);

    await manager.remove(handle.path, { keepIfDirty: false });
  });

  it("devolve lista vazia num worktree intocado", async () => {
    const manager = createWorkspaceManager({ worktreesRoot: join(sandbox, "wt") });
    const handle = await manager.create({ repoPath: repo, runId: "run-limpo" });

    expect(await manager.collectChanges(handle.path, handle.baseCommit)).toEqual([]);

    await manager.remove(handle.path, { keepIfDirty: false });
  });
});
