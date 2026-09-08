import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeAbsolutePath } from "@dungeon-master/platform";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildGitEnv } from "./env.js";
import { collectProcess } from "./process.js";
import {
  createWorkspaceManager,
  isManagedWorktree,
  RUN_BRANCH_PREFIX,
  WORKTREES_DIR_NAME,
} from "./workspace.js";
import { createWorkspaceResolver } from "./workspace-resolver.js";
import type { ExecutionRequest } from "./execution-request.js";

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
  sandbox = await mkdtemp(join(tmpdir(), "dm-wt-"));
  repo = join(sandbox, "repositorio");
  await git(["init", "-q", "-b", "main", repo], sandbox);
  await writeFile(join(repo, "README.md"), "# base\n");
  await git(["add", "."], repo);
  await git(["commit", "-q", "-m", "base"], repo);
});

afterEach(async () => {
  // `git` deixa handles abertos por um instante no Windows; limpeza é
  // best-effort e nunca reprova um teste que já passou.
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
    () => undefined,
  );
});

describe("createWorkspaceManager", () => {
  it("cria o worktree fora do repositório, em branch própria", async () => {
    const manager = createWorkspaceManager();
    const handle = await manager.create({ repoPath: repo, runId: "run-0001" });

    expect(handle.branch).toBe(`${RUN_BRANCH_PREFIX}run-0001`);
    expect(handle.path).toContain(WORKTREES_DIR_NAME);
    // Fora da árvore de trabalho: nada do Run aparece no `git status` do
    // repositório principal nem é varrido por um `git clean`.
    expect(handle.path.startsWith(normalizeAbsolutePath(repo))).toBe(false);
    expect(await readFile(join(handle.path, "README.md"), "utf8")).toContain("# base");
    expect(handle.baseCommit).toHaveLength(40);

    await manager.remove(handle.path, { keepIfDirty: false });
  });

  it("reabre o worktree mesmo quando o caminho chega por um nome que o git canonicaliza", async () => {
    // No macOS o temporário é `/var/...` e o git responde `/private/var/...`;
    // no runner do Windows o TEMP chega como `RUNNER~1` e o git responde
    // `runneradmin`. Um symlink (junction no Windows) reproduz a diferença sem
    // depender do ambiente.
    const raizReal = join(sandbox, "worktrees");
    const atalho = join(sandbox, "atalho");
    await mkdir(raizReal, { recursive: true });
    await symlink(raizReal, atalho, process.platform === "win32" ? "junction" : "dir");

    const criador = createWorkspaceManager({ worktreesRoot: raizReal });
    const criado = await criador.create({ repoPath: repo, runId: "run-reopen" });

    const reabridor = createWorkspaceManager({ worktreesRoot: atalho });
    const reaberto = await reabridor.reopen({ repoPath: repo, runId: "run-reopen" });

    expect(reaberto?.branch).toBe(criado.branch);
    expect(reaberto?.baseCommit).toBe(criado.baseCommit);

    await criador.remove(criado.path, { keepIfDirty: false });
  });

  it("dois Runs no mesmo repositório não colidem", async () => {
    const manager = createWorkspaceManager();
    const first = await manager.create({ repoPath: repo, runId: "run-a" });
    const second = await manager.create({ repoPath: repo, runId: "run-b" });

    expect(first.path).not.toBe(second.path);
    expect(first.branch).not.toBe(second.branch);

    await writeFile(join(first.path, "a.txt"), "a\n");
    await writeFile(join(second.path, "b.txt"), "b\n");
    expect(await manager.hasUncommittedChanges(first.path)).toBe(true);

    await manager.remove(first.path, { keepIfDirty: false });
    await manager.remove(second.path, { keepIfDirty: false });
  });

  it("recusa um caminho já ocupado em vez de reaproveitar em silêncio", async () => {
    const manager = createWorkspaceManager();
    const handle = await manager.create({ repoPath: repo, runId: "run-dup" });

    await expect(manager.create({ repoPath: repo, runId: "run-dup" })).rejects.toThrow(
      /caminho livre/,
    );

    await manager.remove(handle.path, { keepIfDirty: false });
  });

  it("recusa um runId que viraria caminho ou branch inválidos", async () => {
    const manager = createWorkspaceManager();
    for (const runId of ["../fuga", "com barra/dentro", "", "com espaço"]) {
      await expect(manager.create({ repoPath: repo, runId })).rejects.toThrow(/runId inválido/);
    }
  });

  it("preserva o worktree sujo e remove o limpo", async () => {
    const manager = createWorkspaceManager();
    const dirty = await manager.create({ repoPath: repo, runId: "run-sujo" });
    await writeFile(join(dirty.path, "rascunho.txt"), "trabalho não commitado\n");

    const kept = await manager.remove(dirty.path, { keepIfDirty: true });
    expect(kept).toEqual({ removed: false, keptBecauseDirty: true });

    const forced = await manager.remove(dirty.path, { keepIfDirty: false });
    expect(forced.removed).toBe(true);
  });

  it("coleta os commits feitos no worktree depois da base", async () => {
    const manager = createWorkspaceManager();
    const handle = await manager.create({ repoPath: repo, runId: "run-commits" });

    await writeFile(join(handle.path, "OLA.md"), "ola\n");
    await git(["add", "."], handle.path);
    await git(["commit", "-q", "-m", "criar OLA.md"], handle.path);
    await writeFile(join(handle.path, "OLA.md"), "ola de novo\n");
    await git(["commit", "-q", "-am", "ajustar OLA.md"], handle.path);

    const commits = await manager.collectCommits(handle.path, handle.baseCommit);
    expect(commits.map((commit) => commit.subject)).toEqual(["criar OLA.md", "ajustar OLA.md"]);
    expect(commits[0]?.sha).toHaveLength(40);

    await manager.remove(handle.path, { keepIfDirty: false });
  });

  it("um diretório que não é repositório falha com mensagem de git", async () => {
    const manager = createWorkspaceManager();
    const vazio = join(sandbox, "vazio");
    await mkdtemp(vazio);

    await expect(manager.create({ repoPath: sandbox, runId: "run-x" })).rejects.toThrow();
  });

  it("`isManagedWorktree` distingue o que é nosso do que não é", () => {
    const manager = createWorkspaceManager({ worktreesRoot: join(sandbox, "raiz") });
    const path = manager.worktreePathFor(repo, "run-1");

    expect(isManagedWorktree(join(sandbox, "raiz"), path)).toBe(true);
    expect(isManagedWorktree(join(sandbox, "raiz"), repo)).toBe(false);
  });
});

describe("createWorkspaceResolver", () => {
  const baseRequest = (
    strategy: "CURRENT" | "GIT_WORKTREE" | "COPY",
    overrides: Partial<ExecutionRequest> = {},
  ): ExecutionRequest => ({
    runId: "run-resolver",
    taskId: "t",
    workspace: { repoPath: repo },
    harness: { key: "CLAUDE_CODE" },
    loadout: { harness: { key: "CLAUDE_CODE" } },
    executionProfile: { mode: "HOST", workspaceStrategy: strategy },
    prompt: "oi",
    ...overrides,
  });

  it("CURRENT roda no próprio repositório e não cria nada", async () => {
    const resolver = createWorkspaceResolver({ manager: createWorkspaceManager() });
    const resolved = await resolver.resolve(baseRequest("CURRENT"));

    expect(resolved.cwd).toBe(normalizeAbsolutePath(repo));
    expect(resolved.createdByRuntime).toBe(false);
    expect(await resolved.release("SUCCEEDED")).toEqual({
      removed: false,
      keptBecauseDirty: false,
    });
  });

  it("GIT_WORKTREE com checkout pronto não cria nem remove", async () => {
    const manager = createWorkspaceManager();
    const handle = await manager.create({ repoPath: repo, runId: "pronto" });
    const resolver = createWorkspaceResolver({ manager });

    const resolved = await resolver.resolve(
      baseRequest("GIT_WORKTREE", { workspace: { repoPath: repo, checkoutPath: handle.path } }),
    );

    expect(resolved.cwd).toBe(handle.path);
    expect(resolved.createdByRuntime).toBe(false);
    await resolved.release("SUCCEEDED");
    // O worktree do worker continua de pé: quem criou é quem remove.
    expect(await manager.hasUncommittedChanges(handle.path)).toBe(false);

    await manager.remove(handle.path, { keepIfDirty: false });
  });

  it("GIT_WORKTREE sem checkout cria e limpa no sucesso", async () => {
    const manager = createWorkspaceManager();
    const resolver = createWorkspaceResolver({ manager });

    const resolved = await resolver.resolve(baseRequest("GIT_WORKTREE"));
    expect(resolved.createdByRuntime).toBe(true);

    const outcome = await resolved.release("SUCCEEDED");
    expect(outcome.removed).toBe(true);
  });

  it("GIT_WORKTREE preserva o checkout quando o Run falha", async () => {
    const manager = createWorkspaceManager();
    const resolver = createWorkspaceResolver({ manager });

    const resolved = await resolver.resolve(baseRequest("GIT_WORKTREE"));
    const outcome = await resolved.release("FAILED");

    // A prova do que aconteceu está no diretório; apagá-la seria apagar a
    // única evidência de uma falha.
    expect(outcome.removed).toBe(false);
    await manager.remove(resolved.cwd, { keepIfDirty: false });
  });

  it("COPY ainda não existe e falha com mensagem clara", async () => {
    const resolver = createWorkspaceResolver({ manager: createWorkspaceManager() });
    await expect(resolver.resolve(baseRequest("COPY"))).rejects.toThrow(/COPY ainda não existe/);
  });
});
