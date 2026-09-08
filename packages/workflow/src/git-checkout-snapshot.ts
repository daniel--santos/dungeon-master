import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeAbsolutePath } from "@dungeon-master/platform";
import { buildGitEnv, collectProcess, GitCommandError } from "@dungeon-master/runtime";

import type { CheckoutSnapshotter } from "./ports.js";

/**
 * O snapshot de checkout sobre `git`, guardado como **ref** do repositório.
 *
 * O estado do worktree — arquivos rastreados modificados e arquivos novos,
 * respeitando o `.gitignore` — vira um commit fora de qualquer branch, com o
 * `HEAD` de então como pai, apontado por `refs/dm/snapshots/<runId>/<stepKey>`.
 * Uma ref sobrevive ao restart do Worker, a um `git status` do usuário e a
 * qualquer coisa que o agente faça na branch do Run; é o que torna o snapshot
 * "fora do laço de retry" de verdade, e não só fora do laço de uma execução.
 *
 * O commit é construído com um índice temporário (`GIT_INDEX_FILE`), para não
 * mexer no índice do worktree: tirar o snapshot não deixa nada "staged" para
 * trás. A identidade de autor é fixa e nossa — o snapshot não é um commit do
 * usuário e não deve depender do gitconfig dele.
 *
 * Restaurar devolve o checkout ao estado exato do snapshot: `HEAD` volta ao
 * pai (descartando commits que a tentativa fez na branch do Run), a árvore de
 * trabalho volta a ser a do snapshot, e o que a tentativa criou fora dela é
 * removido (`git clean -fd`, sem `-x`: o que o `.gitignore` cobre fica).
 */

export const SNAPSHOT_REF_PREFIX = "refs/dm/snapshots";

export interface GitCheckoutSnapshotterOptions {
  readonly checkoutPath: string;
  readonly runId: string;
  readonly gitPath?: string | undefined;
  readonly env?: Record<string, string> | undefined;
  /** Teto por comando `git`. Padrão: 120 s. */
  readonly timeoutMs?: number | undefined;
}

const SNAPSHOT_IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: "Dungeon Master",
  GIT_AUTHOR_EMAIL: "snapshot@dungeon-master.local",
  GIT_COMMITTER_NAME: "Dungeon Master",
  GIT_COMMITTER_EMAIL: "snapshot@dungeon-master.local",
};

export function snapshotRefFor(runId: string, stepKey: string): string {
  return `${SNAPSHOT_REF_PREFIX}/${runId}/${stepKey}`;
}

export function createGitCheckoutSnapshotter(
  options: GitCheckoutSnapshotterOptions,
): CheckoutSnapshotter {
  const cwd = normalizeAbsolutePath(options.checkoutPath);
  const gitPath = options.gitPath ?? "git";
  const timeoutMs = options.timeoutMs ?? 120_000;
  const baseEnv = options.env ?? buildGitEnv();

  const git = async (
    args: readonly string[],
    extraEnv: Record<string, string> = {},
  ): Promise<string> => {
    const env = { ...baseEnv, ...extraEnv };
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

  return {
    snapshot: async (stepKey) => {
      const ref = snapshotRefFor(options.runId, stepKey);
      const head = (await git(["rev-parse", "--verify", "HEAD"])).trim();

      const tempDir = await mkdtemp(join(tmpdir(), "dm-snapshot-index-"));
      const indexFile = join(tempDir, "index");
      try {
        const indexEnv = { GIT_INDEX_FILE: indexFile };
        // O índice temporário parte do HEAD e recebe tudo o que a árvore de
        // trabalho tem — modificações, remoções e arquivos novos não ignorados.
        await git(["read-tree", head], indexEnv);
        await git(["add", "-A", "."], indexEnv);
        const tree = (await git(["write-tree"], indexEnv)).trim();
        const commit = (
          await git(
            ["commit-tree", tree, "-p", head, "-m", `dungeon-master snapshot ${stepKey}`],
            SNAPSHOT_IDENTITY,
          )
        ).trim();
        await git(["update-ref", ref, commit]);
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    restore: async (stepKey) => {
      const ref = snapshotRefFor(options.runId, stepKey);
      const commit = (await git(["rev-parse", "--verify", `${ref}^{commit}`])).trim();
      const parent = (await git(["rev-parse", "--verify", `${commit}^`])).trim();

      // 1. HEAD e a árvore rastreada voltam ao pai do snapshot.
      await git(["reset", "--hard", "--quiet", parent]);
      // 2. Índice e árvore de trabalho passam a ser a árvore do snapshot, o
      //    que reescreve o que a tentativa mudou e recria o que ela apagou.
      await git(["read-tree", "--reset", "-u", commit]);
      // 3. O que a tentativa criou e não está no snapshot sai. Sem `-x`: o
      //    que o `.gitignore` cobre não é da tentativa.
      await git(["clean", "-fdq"]);
      // 4. O índice volta ao HEAD sem tocar na árvore: o que era arquivo novo
      //    no snapshot volta a ser arquivo novo, e a modificação volta a ser
      //    modificação não staged, exatamente como antes.
      await git(["reset", "--quiet"]);
    },

    discard: async (stepKey) => {
      const ref = snapshotRefFor(options.runId, stepKey);
      // `-d` numa ref que não existe é erro do git; aqui é o resultado
      // desejado, e nada a fazer.
      await git(["update-ref", "-d", ref]).catch((error: unknown) => {
        if (!(error instanceof GitCommandError)) throw error;
      });
    },
  };
}
