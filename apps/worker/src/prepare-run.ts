import type { WorkspaceStrategy } from "@dungeon-master/contracts";
import {
  acquireWorkspaceLock,
  getActiveRunByPath,
  recordDomainEvent,
  updateRunExecutionFields,
  type ClaimedRun,
} from "@dungeon-master/database";
import { normalizeAbsolutePath } from "@dungeon-master/platform";
import type { WorktreeHandle } from "@dungeon-master/runtime";

import type { ExecuteRunDeps } from "./execute-run.js";
import { resolveRunPolicies, type ResolvedRunPolicies } from "./policy.js";
import type { RunOutcomeWriter } from "./run-writers.js";

/**
 * A preparação de um Run, do claim ao instante anterior ao primeiro processo.
 *
 * É a mesma para o Run simples e para o Run com Workflow, e a ordem não é
 * arbitrária — cada passo existe por um acidente conhecido:
 *
 * 1. **Trava de workspace antes de qualquer processo.** Dois `run()` do
 *    Sandcastle com a mesma branch nomeada recebem o mesmo diretório e
 *    corrompem em silêncio (documento técnico, seção 16); a trava é nossa e
 *    mora no PostgreSQL.
 * 2. **Worktree depois da trava.** Criar primeiro deixaria diretório órfão
 *    quando a trava fosse recusada.
 * 3. **Confirmação de posse imediatamente antes de subir o processo.** Entre
 *    dois Runs que ainda não começaram, a trava vai para o de `id` menor; é o
 *    desempate determinístico da 2A, e a única janela em que um Run perde uma
 *    trava que pegou.
 * 4. **Políticas resolvidas uma vez por Run.** A tradução da política
 *    declarativa para o que o runtime consome é regra de domínio (`policy.ts`),
 *    e o diário recebe o que foi concedido antes de o processo subir.
 *
 * Um Run com Workflow que volta de um gate **reabre** o worktree que ficou de
 * pé em vez de criar outro: o trabalho dos passos anteriores está lá dentro.
 */

export interface PreparedRun {
  readonly repoPath: string;
  readonly checkoutPath: string;
  readonly strategy: WorkspaceStrategy;
  readonly worktree: WorktreeHandle | undefined;
  /** `true` quando o worktree já existia e foi reaberto (retomada de Workflow). */
  readonly reopened: boolean;
  readonly policies: ResolvedRunPolicies;
}

export type PreparationOutcome =
  | { readonly ok: true; readonly prepared: PreparedRun; readonly lockAcquired: true }
  | { readonly ok: false; readonly lockAcquired: boolean };

export interface PrepareRunInput {
  readonly deps: ExecuteRunDeps;
  readonly claimed: ClaimedRun;
  readonly writer: RunOutcomeWriter;
  /**
   * Reaproveitar um worktree que já existe no caminho do Run.
   *
   * Só o Run com Workflow pede isso: ele solta o Worker num gate e volta da
   * fila para o mesmo diretório. No Run simples um diretório ocupado é erro.
   */
  readonly reuseExistingWorktree: boolean;
}

export async function prepareRun(input: PrepareRunInput): Promise<PreparationOutcome> {
  const { deps, claimed, writer } = input;
  const { db, userId } = deps;
  const { run, project, task } = claimed;
  const harness = run.harnessKey;

  // ------------------------------------------------------------ workspace
  if (project.workspacePath === null || project.workspacePath.trim() === "") {
    await writer.failPreparation({
      code: "PROJECT_WITHOUT_WORKSPACE",
      message:
        "O Project não tem um caminho de workspace, e um agente sem diretório de trabalho " +
        "não é um Run que roda pior: é um Run que não pode começar.",
      retryable: false,
    });
    return { ok: false, lockAcquired: false };
  }

  const repoPath = normalizeAbsolutePath(project.workspacePath);
  const strategy = run.executionProfileSnapshot.workspaceStrategy;

  if (strategy === "COPY") {
    await writer.failPreparation({
      code: "WORKSPACE_STRATEGY_UNSUPPORTED",
      message:
        "A estratégia de workspace COPY ainda não existe. Use CURRENT ou GIT_WORKTREE no " +
        "ExecutionProfile.",
      retryable: false,
    });
    return { ok: false, lockAcquired: false };
  }

  const checkoutPath =
    strategy === "GIT_WORKTREE" ? deps.workspace.worktreePathFor(repoPath, run.id) : repoPath;

  // (a) A trava vem antes de tudo: ela é o que garante um Run ativo por par
  // (repositório, caminho de checkout), inclusive entre processos diferentes.
  const lock = await acquireWorkspaceLock(db, {
    userId,
    repoPath,
    checkoutPath,
    runId: run.id,
  });

  if (!lock.acquired) {
    await writer.failPreparation({
      code: "WORKSPACE_LOCKED",
      message:
        `O caminho ${checkoutPath} já está reservado pelo Run ${lock.heldBy}. ` +
        "Um Run ativo por caminho de checkout é a regra que impede dois agentes de " +
        "escreverem no mesmo diretório.",
      // Retentável: a trava sai sozinha quando o outro Run terminar.
      retryable: true,
      detail: `Motivo: ${lock.reason}. Reservado desde ${lock.heldSince}.`,
      extra: { heldByRunId: lock.heldBy, checkoutPath },
    });
    return { ok: false, lockAcquired: false };
  }

  if (lock.reclaimed) {
    await writer.diagnostic(
      "WARN",
      "A trava do workspace estava presa por um Run que já não existe e foi recuperada.",
      `Caminho: ${checkoutPath}.`,
    );
  }

  // (b) O worktree. O runtime recebe `checkoutPath` preenchido e, por
  // contrato, não cria nem remove nada — quem preparou desfaz.
  let worktree: WorktreeHandle | undefined;
  let reopened = false;
  if (strategy === "GIT_WORKTREE") {
    try {
      if (input.reuseExistingWorktree) {
        const existente = await deps.workspace.reopen({ repoPath, runId: run.id });
        if (existente !== null) {
          worktree = existente;
          reopened = true;
        }
      }
      worktree ??= await deps.workspace.create({ repoPath, runId: run.id });
    } catch (error) {
      await writer.failPreparation({
        code: "WORKTREE_CREATE_FAILED",
        message: `Não consegui ${reopened ? "reabrir" : "criar"} o worktree do Run em ${checkoutPath}.`,
        retryable: true,
        detail: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, lockAcquired: true };
    }
  }

  await updateRunExecutionFields(db, { userId, runId: run.id, workspacePath: checkoutPath });

  // (c) Confirmação de posse imediatamente antes de subir o processo. É a
  // leitura barata que fecha a janela do desempate por `id` menor.
  const dono = await getActiveRunByPath(db, { userId, repoPath, checkoutPath });
  if (dono === null || dono.id !== run.id) {
    await writer.failPreparation({
      code: "WORKSPACE_LOCK_LOST",
      message:
        `A trava de ${checkoutPath} passou para o Run ${dono?.id ?? "(nenhum)"} entre a ` +
        "aquisição e a subida do processo. Nada foi executado.",
      retryable: true,
      extra: { checkoutPath },
    });
    return { ok: false, lockAcquired: true };
  }

  // (d) Políticas. A tradução é regra de domínio e mora em `policy.ts`.
  const policies = resolveRunPolicies({
    profile: run.executionProfileSnapshot,
    harnessKey: harness,
    capabilities: run.loadoutSnapshot.harness.capabilities,
  });

  for (const nota of policies.notes) {
    await writer.diagnostic(
      nota.level === "DEBUG" ? "INFO" : nota.level,
      nota.message,
      nota.detail,
    );
  }

  if (policies.bypassWithoutSandbox) {
    // O diário do Project sobrevive à tela de histórico do Run, e é onde a
    // pergunta "por que esse agente teve permissão para tudo?" será feita.
    await db.transaction(async (tx) => {
      await recordDomainEvent(tx, {
        userId,
        projectId: project.id,
        taskId: task.id,
        taskTitle: task.title,
        type: "run.permission_bypassed",
        payload: {
          runId: run.id,
          taskId: task.id,
          projectId: project.id,
          executionMode: run.executionMode,
          enforcement: run.executionProfileSnapshot.enforcement,
          executionProfileName: run.executionProfileSnapshot.name,
        },
      });
    });
  }

  return {
    ok: true,
    lockAcquired: true,
    prepared: { repoPath, checkoutPath, strategy, worktree, reopened, policies },
  };
}
