import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildGitEnv, collectProcess } from "@dungeon-master/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGitCheckoutSnapshotter, snapshotRefFor } from "./git-checkout-snapshot.js";

/**
 * O snapshot sobre um repositório de verdade.
 *
 * O que se prova: o estado do checkout — modificação, arquivo novo, remoção,
 * commit da tentativa — volta exatamente ao que era; o índice fica limpo; a
 * ref sobrevive a um "restart" (outra instância do snapshotter sobre o mesmo
 * diretório) e some no `discard`.
 */

const RUN_ID = "01990000-0000-7000-8000-0000000000aa";

async function git(args: readonly string[], cwd: string): Promise<string> {
  const result = await collectProcess("git", args, { cwd, env: buildGitEnv(), timeoutMs: 60_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} falhou (${String(result.code)}): ${result.stderr}`);
  }
  return result.stdout;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

let sandbox: string;
let repo: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "dm-snapshot-"));
  repo = join(sandbox, "repo");
  await git(["init", "-q", "-b", "main", repo], sandbox);
  // O teste compara bytes; a conversão de fim de linha do git no Windows
  // (`core.autocrlf` do gitconfig de sistema) faria o mesmo conteúdo voltar
  // com CRLF depois do `read-tree -u`.
  await git(["config", "core.autocrlf", "false"], repo);
  await writeFile(join(repo, "README.md"), "# base\n");
  await writeFile(join(repo, ".gitignore"), "ignored.log\n");
  await git(["add", "."], repo);
  await git(["commit", "-q", "-m", "base"], repo);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
    () => undefined,
  );
});

describe("createGitCheckoutSnapshotter", () => {
  it("restaura modificação, arquivo novo, remoção e desfaz o commit da tentativa", async () => {
    const snapshotter = createGitCheckoutSnapshotter({ checkoutPath: repo, runId: RUN_ID });

    // O estado "antes da primeira tentativa": README mexido, um arquivo novo
    // não rastreado, um ignorado.
    await writeFile(join(repo, "README.md"), "# mexido antes\n");
    await writeFile(join(repo, "novo.txt"), "novo\n");
    await writeFile(join(repo, "ignored.log"), "lixo\n");
    const headAntes = (await git(["rev-parse", "HEAD"], repo)).trim();

    await snapshotter.snapshot("work");

    // Tirar o snapshot não deixa nada staged.
    expect((await git(["diff", "--cached", "--name-only"], repo)).trim()).toBe("");
    const ref = (await git(["rev-parse", "--verify", snapshotRefFor(RUN_ID, "work")], repo)).trim();
    expect(ref).toMatch(/^[0-9a-f]{40}$/);

    // A tentativa: mexe em tudo e ainda commita.
    await writeFile(join(repo, "README.md"), "# estragado\n");
    await writeFile(join(repo, "novo.txt"), "sobrescrito\n");
    await writeFile(join(repo, "criado-na-tentativa.txt"), "x\n");
    await git(["add", "-A"], repo);
    await git(["commit", "-q", "-m", "tentativa"], repo);
    await rm(join(repo, "novo.txt"));
    await writeFile(join(repo, "outro-solto.txt"), "y\n");

    // "Restart": outra instância, mesma ref.
    const outra = createGitCheckoutSnapshotter({ checkoutPath: repo, runId: RUN_ID });
    await outra.restore("work");

    expect((await git(["rev-parse", "HEAD"], repo)).trim()).toBe(headAntes);
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("# mexido antes\n");
    expect(await readFile(join(repo, "novo.txt"), "utf8")).toBe("novo\n");
    expect(await exists(join(repo, "criado-na-tentativa.txt"))).toBe(false);
    expect(await exists(join(repo, "outro-solto.txt"))).toBe(false);
    // O ignorado não é da tentativa: fica.
    expect(await exists(join(repo, "ignored.log"))).toBe(true);

    // O índice volta a ser o HEAD: o arquivo novo é não rastreado de novo, e
    // a modificação é modificação não staged.
    // Sem `trim()` no todo: o espaço inicial de ` M` é parte do formato.
    const status = (await git(["status", "--porcelain"], repo))
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .sort();
    expect(status).toEqual([" M README.md", "?? novo.txt"]);

    await outra.discard("work");
    await expect(
      git(["rev-parse", "--verify", snapshotRefFor(RUN_ID, "work")], repo),
    ).rejects.toThrow();
    // Descartar de novo não é erro.
    await outra.discard("work");
  });

  it("restaurar sem snapshot lança com a ref no erro", async () => {
    const snapshotter = createGitCheckoutSnapshotter({ checkoutPath: repo, runId: RUN_ID });
    await expect(snapshotter.restore("nunca")).rejects.toThrow(/refs\/dm\/snapshots/);
  });

  it("funciona num worktree do Run, com a ref no repositório pai", async () => {
    const worktree = join(sandbox, "wt");
    await git(["worktree", "add", "-q", "-b", "dm/run-x", worktree, "HEAD"], repo);
    const snapshotter = createGitCheckoutSnapshotter({ checkoutPath: worktree, runId: RUN_ID });

    await writeFile(join(worktree, "a.txt"), "a\n");
    await snapshotter.snapshot("s");
    await writeFile(join(worktree, "a.txt"), "b\n");
    await snapshotter.restore("s");

    expect(await readFile(join(worktree, "a.txt"), "utf8")).toBe("a\n");
    // A ref é do repositório, visível do pai também.
    expect(
      (await git(["rev-parse", "--verify", snapshotRefFor(RUN_ID, "s")], repo)).trim(),
    ).toMatch(/^[0-9a-f]{40}$/);
    await snapshotter.discard("s");
  });
});
