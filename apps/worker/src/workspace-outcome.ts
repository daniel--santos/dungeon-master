import type { ExecutionEvent, HarnessKey } from "@dungeon-master/contracts";
import {
  GitCommandError,
  type CommitRef,
  type WorkspaceChange,
  type WorkspaceManager,
  type WorktreeHandle,
} from "@dungeon-master/runtime";

import type { Logger } from "./logger.js";
import type { RunOutcomeWriter } from "./run-writers.js";

/**
 * O que acontece com o worktree quando o Run termina, igual nos dois caminhos.
 *
 * Os espólios saem **antes** do evento terminal, porque depois dele nada mais
 * é emitido (contrato do `ExecutionEvent`). Só o Codex anuncia artefatos
 * sozinho; sem esta passagem, a mesma tarefa deixaria rastro diferente
 * conforme a Guilda escolhida. O worktree é removido só num sucesso limpo:
 * falha, timeout, cancelamento e mudança não commitada preservam — é onde está
 * a prova do que aconteceu.
 */

export interface WorkspaceOutcome {
  readonly commits: readonly CommitRef[];
  readonly preservedPath: string | undefined;
}

export async function settleWorkspace(input: {
  readonly workspace: WorkspaceManager;
  readonly writer: RunOutcomeWriter;
  readonly logger: Logger | undefined;
  readonly runId: string;
  readonly harness: HarnessKey;
  readonly worktree: WorktreeHandle | undefined;
  readonly success: boolean;
  /** Caminhos que o harness já anunciou como `Artifact`; não viram evento de novo. */
  readonly knownArtifacts: ReadonlySet<string>;
}): Promise<WorkspaceOutcome> {
  const { workspace, writer, logger, runId, harness, worktree, success } = input;

  let commits: readonly CommitRef[] = [];
  let changes: readonly WorkspaceChange[] = [];
  if (worktree !== undefined) {
    // As duas leituras falham em silêncio para não derrubar um Run que já
    // terminou, mas silêncio no log do worker é invisível: no CI o aviso não
    // aparece, e um `result.commits` ausente ficou sem explicação por uma
    // rodada inteira. O `Diagnostic` é persistido, sai antes do evento
    // terminal e leva o stderr do git, que é onde o motivo está escrito.
    try {
      commits = await workspace.collectCommits(worktree.path, worktree.baseCommit);
    } catch (error) {
      logger?.warn({ err: error, runId }, "não consegui coletar os commits do worktree");
      await writer.diagnostic(
        "WARN",
        "Não consegui ler os commits do worktree; o resultado deste Run sai sem eles.",
        descreverFalhaDeGit(error),
      );
    }
    try {
      changes = await workspace.collectChanges(worktree.path, worktree.baseCommit);
    } catch (error) {
      logger?.warn({ err: error, runId }, "não consegui ler o diff do worktree");
      await writer.diagnostic(
        "WARN",
        "Não consegui ler o diff do worktree; este Run não emitiu Artifact algum.",
        descreverFalhaDeGit(error),
      );
    }
  }

  for (const mudanca of changes) {
    if (input.knownArtifacts.has(normalizeArtifactPath(mudanca.path))) continue;
    await writer.append(toArtifactEvent(harness, mudanca));
  }

  let preservedPath: string | undefined = worktree === undefined ? undefined : worktree.path;

  if (worktree !== undefined && success) {
    try {
      const removido = await workspace.remove(worktree.path, { keepIfDirty: true });
      if (removido.removed) preservedPath = undefined;
    } catch (error) {
      logger?.warn({ err: error, runId }, "falha ao remover o worktree do Run");
    }
  }

  if (preservedPath !== undefined && worktree !== undefined) {
    await writer.diagnostic(
      success ? "WARN" : "INFO",
      success
        ? "O worktree foi preservado porque sobrou mudança não commitada."
        : "O worktree foi preservado para você inspecionar o que aconteceu.",
      recoveryMessage({ worktree, commits }),
    );
  }

  return { commits, preservedPath };
}

/** Os campos que todo desfecho carrega, tenha ele resultado ou erro. */
export function comumDoDesfecho(
  preservedWorktreePath: string | undefined,
  commits: readonly CommitRef[],
): Record<string, unknown> {
  return {
    ...(preservedWorktreePath === undefined ? {} : { preservedWorktreePath }),
    ...(commits.length === 0 ? {} : { commits }),
  };
}

/**
 * O que dizer sobre um comando `git` que falhou na coleta.
 *
 * O `stderr` do git é a única linha que diz o motivo de verdade — "Author
 * identity unknown", "dubious ownership", "not a git repository" —, e ele só
 * existe dentro de `GitCommandError`. Sem ele o diagnóstico repetiria a
 * mensagem genérica e mandaria o leitor adivinhar.
 */
export function descreverFalhaDeGit(error: unknown): string {
  if (error instanceof GitCommandError) {
    const stderr = error.failure.stderr.trim();
    return (
      `git ${error.failure.args.join(" ")} em ${error.failure.cwd} ` +
      `terminou com código ${String(error.failure.code)}.` +
      (stderr.length === 0 ? "" : ` ${stderr}`)
    );
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Um caminho comparável entre o que o harness anunciou e o que o diff achou.
 *
 * O git fala em `/` e caminho relativo; um harness pode mandar `.\OLA.md` ou o
 * caminho absoluto do worktree. Sem normalizar, o mesmo arquivo entraria duas
 * vezes na timeline.
 */
export function normalizeArtifactPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
}

/**
 * Uma mudança do worktree virando espólio.
 *
 * `kind` carrega **o que aconteceu com o arquivo**, e não a palavra "file": o
 * campo é classificação livre no contrato, e "criado" ou "apagado" é o que quem
 * lê a timeline precisa saber. O tamanho vai junto quando o arquivo ainda
 * existe, porque um caminho sem tamanho não parece um arquivo.
 */
export function toArtifactEvent(harness: HarnessKey, change: WorkspaceChange): ExecutionEvent {
  const kind = {
    ADDED: "created",
    MODIFIED: "modified",
    DELETED: "deleted",
    RENAMED: "renamed",
  }[change.change];

  return {
    type: "Artifact",
    timestamp: new Date().toISOString(),
    harness,
    path: change.path,
    kind,
    ...(change.bytes === undefined ? {} : { bytes: change.bytes }),
  };
}

/**
 * A mensagem de recuperação, com comandos copiáveis.
 *
 * No espírito do `RecoveryMessage` do Sandcastle: quando algo é preservado, o
 * diagnóstico precisa dizer onde está e o que fazer com aquilo. Um caminho sem
 * comando obriga quem lê a lembrar a sintaxe de `git worktree remove`, e é
 * nessa hora que alguém apaga o diretório errado.
 */
export function recoveryMessage(input: {
  worktree: WorktreeHandle;
  commits: readonly CommitRef[];
}): string {
  const { worktree, commits } = input;
  const linhas = [
    `Worktree preservado em: ${worktree.path}`,
    `Branch: ${worktree.branch} (a partir de ${worktree.baseCommit.slice(0, 12)})`,
    "",
    "Para inspecionar:",
    `  cd "${worktree.path}"`,
    "  git status",
    `  git log --oneline ${worktree.baseCommit.slice(0, 12)}..HEAD`,
    "",
    "Para trazer o trabalho para o repositório principal:",
    `  git -C "${worktree.repoPath}" merge ${worktree.branch}`,
    "",
    "Para descartar:",
    `  git -C "${worktree.repoPath}" worktree remove --force "${worktree.path}"`,
    `  git -C "${worktree.repoPath}" branch -D ${worktree.branch}`,
  ];

  if (commits.length > 0) {
    linhas.push("", `Commits neste worktree (${String(commits.length)}):`);
    for (const commit of commits) {
      linhas.push(`  ${commit.sha.slice(0, 12)} ${commit.subject}`);
    }
  }

  return linhas.join("\n");
}
