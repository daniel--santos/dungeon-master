/**
 * Worktree por Run (documento técnico, seção 16).
 *
 * Worktree **não é sandbox**: ele separa mudanças, permite comparar diffs e
 * deixa dois Runs rodarem no mesmo repositório sem se atropelar, mas não limita
 * filesystem nem execução de comando. É isolamento operacional de código.
 *
 * Três decisões nossas, e o porquê de cada uma:
 *
 * **O worktree fica fora do repositório.** Em
 * `<pai do repo>/.dm-worktrees/<nome do repo>/<runId>`, e não em
 * `<repo>/.dm/runs/<runId>`. Um worktree dentro da árvore de trabalho aparece
 * em `git status` do repositório principal, entra em `git clean -xdf`, é
 * varrido por watcher de build e por indexador de editor, e um agente que
 * recebe "o repositório" como contexto acaba lendo os arquivos de outro Run. O
 * preço é que o diretório vizinho precisa ser gravável; quando não for,
 * `worktreesRoot` aponta para o temp.
 *
 * **A branch é `dm/run-<runId>`.** Prefixo próprio para que ninguém confunda
 * com branch de gente, e o id do Run inteiro para que a colisão seja
 * impossível em vez de improvável.
 *
 * **A trava não mora aqui.** Um Run ativo por par (repositório, caminho de
 * checkout) é uma linha de `workspace_lock` no PostgreSQL, adquirida pelo
 * worker antes de qualquer processo subir. Este arquivo não conhece banco;
 * ele recebe o caminho ou cria o dele. Duas travas para a mesma coisa
 * divergiriam.
 */

import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { isInside, normalizeAbsolutePath } from "@dungeon-master/platform";

import { buildGitEnv } from "./env.js";
import { RuntimeRequestError } from "./harness.js";
import { collectProcess } from "./process.js";

/**
 * `git` sem escrita de configuração.
 *
 * Adaptado do `NO_CONFIG_LOCK_FLAGS` do `WorktreeManager` do Sandcastle
 * (src/WorktreeManager.ts@e99f832): `branch.autoSetupMerge` e
 * `push.autoSetupRemote` fazem o `worktree add` escrever em `.git/config`, e
 * duas criações concorrentes disputam o `.git/config.lock`.
 */
const NO_CONFIG_LOCK_FLAGS = [
  "-c",
  "branch.autoSetupMerge=false",
  "-c",
  "push.autoSetupRemote=false",
] as const;

/** Nome da pasta que agrupa os worktrees de todos os repositórios. */
export const WORKTREES_DIR_NAME = ".dm-worktrees";

/** Prefixo das branches criadas pelo runtime. */
export const RUN_BRANCH_PREFIX = "dm/run-";

export interface GitCommandFailure {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly code: number | null;
  readonly stderr: string;
}

/** Falha de um comando `git`. Carrega o comando para o diagnóstico. */
export class GitCommandError extends Error {
  readonly failure: GitCommandFailure;

  constructor(message: string, failure: GitCommandFailure) {
    super(message);
    this.name = "GitCommandError";
    this.failure = failure;
  }
}

export interface WorktreeHandle {
  /** Caminho absoluto do worktree, normalizado para o SO atual. */
  readonly path: string;
  readonly branch: string;
  readonly repoPath: string;
  /** Ref usado como base (`HEAD` por padrão). */
  readonly baseRef: string;
  /** Commit exato de onde o worktree partiu. É a base de `collectCommits`. */
  readonly baseCommit: string;
}

export interface CreateWorktreeOptions {
  readonly repoPath: string;
  readonly runId: string;
  readonly baseRef?: string;
}

export interface RemoveWorktreeOptions {
  /** Preserva o worktree quando há mudança não commitada. Padrão: `true`. */
  readonly keepIfDirty?: boolean;
}

export interface RemoveWorktreeResult {
  readonly removed: boolean;
  /** `true` quando havia mudança não commitada e `keepIfDirty` estava ligado. */
  readonly keptBecauseDirty: boolean;
}

export interface CommitRef {
  readonly sha: string;
  readonly subject: string;
}

export interface WorkspaceManagerOptions {
  /**
   * Onde os worktrees ficam. Padrão:
   * `<pai do repositório>/.dm-worktrees/<nome do repositório>`.
   */
  readonly worktreesRoot?: string;
  /** Executável do git. Padrão: `git`. */
  readonly gitPath?: string;
  /** Teto de tempo por comando `git`. Padrão: 120 s. */
  readonly timeoutMs?: number;
  readonly env?: Record<string, string>;
}

export interface WorkspaceManager {
  create(options: CreateWorktreeOptions): Promise<WorktreeHandle>;
  remove(path: string, options?: RemoveWorktreeOptions): Promise<RemoveWorktreeResult>;
  hasUncommittedChanges(path: string): Promise<boolean>;
  /** Commits feitos no worktree depois de `baseCommit`, do mais antigo ao mais novo. */
  collectCommits(path: string, baseCommit: string): Promise<readonly CommitRef[]>;
  /** O caminho onde o worktree de um Run ficaria. Não toca no disco. */
  worktreePathFor(repoPath: string, runId: string): string;
  /** O nome da branch de um Run. */
  branchFor(runId: string): string;
}

export function createWorkspaceManager(options: WorkspaceManagerOptions = {}): WorkspaceManager {
  const gitPath = options.gitPath ?? "git";
  const timeoutMs = options.timeoutMs ?? 120_000;
  const env = options.env ?? buildGitEnv();

  const git = async (args: readonly string[], cwd: string): Promise<string> => {
    const result = await collectProcess(gitPath, args, { cwd, env, timeoutMs });
    if (result.error !== undefined) {
      throw new GitCommandError(
        `Não consegui executar ${gitPath}: ${result.error.message}. Git está instalado e no PATH?`,
        { args, cwd, code: null, stderr: result.stderr },
      );
    }
    if (result.timedOut) {
      throw new GitCommandError(
        `git ${args.join(" ")} passou de ${String(timeoutMs)} ms em ${cwd} e foi encerrado.`,
        { args, cwd, code: result.code, stderr: result.stderr },
      );
    }
    if (result.code !== 0) {
      throw new GitCommandError(
        `git ${args.join(" ")} falhou com código ${String(result.code)} em ${cwd}: ${result.stderr.trim()}`,
        { args, cwd, code: result.code, stderr: result.stderr },
      );
    }
    return result.stdout;
  };

  const rootFor = (repoPath: string): string => {
    const repo = normalizeAbsolutePath(repoPath);
    if (options.worktreesRoot !== undefined) {
      return normalizeAbsolutePath(options.worktreesRoot);
    }
    const parent = dirname(repo);
    const name = basename(repo);
    // `dirname` de uma raiz (`C:\`, `/`) devolve ela mesma. Criar
    // `C:\.dm-worktrees` seria feio e, num runner, provavelmente sem
    // permissão; o temp resolve os dois casos.
    const base =
      parent === repo ? join(tmpdir(), WORKTREES_DIR_NAME) : join(parent, WORKTREES_DIR_NAME);
    return normalizeAbsolutePath(join(base, name));
  };

  const worktreePathFor = (repoPath: string, runId: string): string => {
    assertRunId(runId);
    return normalizeAbsolutePath(join(rootFor(repoPath), runId));
  };

  const branchFor = (runId: string): string => {
    assertRunId(runId);
    return `${RUN_BRANCH_PREFIX}${runId}`;
  };

  const hasUncommittedChanges = async (path: string): Promise<boolean> => {
    const status = await git(["status", "--porcelain"], normalizeAbsolutePath(path));
    return status.trim().length > 0;
  };

  return {
    worktreePathFor,
    branchFor,
    hasUncommittedChanges,

    create: async ({ repoPath, runId, baseRef }) => {
      const repo = normalizeAbsolutePath(repoPath);
      const target = worktreePathFor(repo, runId);
      const branch = branchFor(runId);
      const ref = baseRef ?? "HEAD";

      // Recusar antes de mexer no disco: um `repoPath` que não é repositório
      // produz um erro do git difícil de ler três camadas acima.
      const toplevel = (await git(["rev-parse", "--show-toplevel"], repo)).trim();
      if (toplevel.length === 0) {
        throw new RuntimeRequestError(`${repo} não é a raiz de um repositório git.`, {
          code: "NOT_A_GIT_REPOSITORY",
        });
      }

      if (await pathExists(target)) {
        throw new RuntimeRequestError(
          `Já existe algo em ${target}. Um worktree por Run exige um caminho livre; remova-o ou use outro runId.`,
          { code: "WORKTREE_PATH_TAKEN" },
        );
      }

      const baseCommit = (await git(["rev-parse", ref], repo)).trim();

      await mkdir(dirname(target), { recursive: true });
      await git([...NO_CONFIG_LOCK_FLAGS, "worktree", "add", "-b", branch, target, ref], repo);

      return { path: target, branch, repoPath: repo, baseRef: ref, baseCommit };
    },

    remove: async (path, removeOptions) => {
      const target = normalizeAbsolutePath(path);
      const keepIfDirty = removeOptions?.keepIfDirty ?? true;

      if (!(await pathExists(target))) {
        return { removed: false, keptBecauseDirty: false };
      }

      if (keepIfDirty && (await hasUncommittedChanges(target))) {
        return { removed: false, keptBecauseDirty: true };
      }

      // `worktree remove` roda de dentro do próprio worktree: o repositório
      // principal pode ter sido movido, e o worktree sabe achar o `.git` dele.
      // `--force` porque o agente pode ter deixado arquivo não rastreado, e
      // aqui a decisão de descartar já foi tomada acima.
      await git(["worktree", "remove", "--force", target], target).catch(async (error: unknown) => {
        // Um worktree cujo registro o git perdeu (repositório re-clonado, por
        // exemplo) não sai por `worktree remove`. Apagar o diretório é o
        // fallback honesto, e o `prune` limpa o registro depois.
        await rm(target, { recursive: true, force: true });
        if (!(error instanceof GitCommandError)) throw error;
      });

      return { removed: true, keptBecauseDirty: false };
    },

    collectCommits: async (path, baseCommit) => {
      const target = normalizeAbsolutePath(path);
      // `%x00` como separador: assunto de commit pode conter qualquer coisa
      // menos byte nulo, então o parser não precisa escapar nada.
      const out = await git(
        ["log", "--reverse", "--format=%H%x00%s", `${baseCommit}..HEAD`],
        target,
      );
      return out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [sha = "", subject = ""] = line.split("\0");
          return { sha, subject };
        })
        .filter((commit) => commit.sha.length > 0);
    },
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * O `runId` vira nome de diretório e de branch.
 *
 * A restrição é dura de propósito: um id com `/`, `..` ou espaço viraria um
 * caminho fora da raiz de worktrees ou uma branch com nome inválido. UUIDv7,
 * que é o que o sistema gera, passa.
 */
function assertRunId(runId: string): void {
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) {
    throw new RuntimeRequestError(
      `runId inválido para nome de worktree e de branch: ${JSON.stringify(runId)}. Use letras, dígitos, '-' e '_'.`,
      { code: "INVALID_RUN_ID" },
    );
  }
}

/**
 * O caminho está dentro da raiz de worktrees deste manager?
 *
 * Serve para o worker decidir se pode remover um checkout: remover um caminho
 * que não é nosso apagaria trabalho de gente.
 */
export function isManagedWorktree(worktreesRoot: string, path: string): boolean {
  return isInside(worktreesRoot, path);
}
