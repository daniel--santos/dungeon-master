/**
 * Da estratégia de workspace ao diretório onde o agente roda.
 *
 * `mode` e `workspaceStrategy` são eixos ortogonais (planejamento v0.4, Fase
 * 2C): worktree não é backend de execução. Este arquivo trata só do segundo
 * eixo, e é a única coisa entre `ExecutionRequest.workspace` e o `cwd` do
 * processo.
 *
 * A divisão de responsabilidade com o worker é explícita: quando
 * `workspace.checkoutPath` vem preenchido, o worker já pegou a trava no
 * PostgreSQL e criou o worktree, e o runtime **não** cria nem remove nada.
 * Quando falta, o runtime cria o dele e desfaz no fim. Sem essa regra, os dois
 * criariam o mesmo worktree e um removeria o do outro.
 */

import { normalizeAbsolutePath } from "@dungeon-master/platform";

import type { ExecutionRequest } from "./execution-request.js";
import { RuntimeRequestError } from "./harness.js";
import type { ExecutionStatus } from "./types.js";
import type { WorkspaceManager, WorktreeHandle } from "./workspace.js";

export interface ResolvedWorkspace {
  /** Diretório de trabalho do agente, absoluto e normalizado. */
  readonly cwd: string;
  /** O runtime criou este checkout e é ele quem desfaz. */
  readonly createdByRuntime: boolean;
  /** Presente quando a estratégia é `GIT_WORKTREE`. */
  readonly worktree?: WorktreeHandle;
  /** Chamado sempre no fim, mesmo em falha. Nunca lança. */
  release(status: ExecutionStatus): Promise<ReleaseOutcome>;
}

export interface ReleaseOutcome {
  readonly removed: boolean;
  readonly keptBecauseDirty: boolean;
  /** Preenchido quando a limpeza falhou; vira `Diagnostic`, nunca falha o Run. */
  readonly error?: string;
}

const NO_OP_RELEASE: ReleaseOutcome = { removed: false, keptBecauseDirty: false };

export interface WorkspaceResolver {
  resolve(request: ExecutionRequest): Promise<ResolvedWorkspace>;
}

export interface WorkspaceResolverOptions {
  readonly manager: WorkspaceManager;
  /**
   * Manter o worktree criado pelo runtime depois de um Run bem-sucedido.
   * Padrão: `false` — o sucesso já produziu commits, e o diretório só ocupa
   * espaço. Uma falha, um timeout e um cancelamento **sempre** preservam: é
   * onde está a prova do que aconteceu.
   */
  readonly keepOnSuccess?: boolean;
}

export function createWorkspaceResolver(options: WorkspaceResolverOptions): WorkspaceResolver {
  const { manager } = options;
  const keepOnSuccess = options.keepOnSuccess ?? false;

  return {
    resolve: async (request) => {
      const strategy = request.executionProfile.workspaceStrategy;
      const repoPath = normalizeAbsolutePath(request.workspace.repoPath);

      if (strategy === "COPY") {
        throw new RuntimeRequestError(
          "A estratégia de workspace COPY ainda não existe. Use CURRENT ou GIT_WORKTREE.",
          { code: "WORKSPACE_STRATEGY_UNSUPPORTED" },
        );
      }

      if (strategy === "CURRENT") {
        const cwd =
          request.workspace.checkoutPath === undefined
            ? repoPath
            : normalizeAbsolutePath(request.workspace.checkoutPath);
        return {
          cwd,
          createdByRuntime: false,
          release: () => Promise.resolve(NO_OP_RELEASE),
        };
      }

      if (request.workspace.checkoutPath !== undefined) {
        // O worker preparou e travou. Só usamos.
        return {
          cwd: normalizeAbsolutePath(request.workspace.checkoutPath),
          createdByRuntime: false,
          release: () => Promise.resolve(NO_OP_RELEASE),
        };
      }

      const worktree = await manager.create({
        repoPath,
        runId: request.runId,
        ...(request.workspace.baseRef === undefined ? {} : { baseRef: request.workspace.baseRef }),
      });

      return {
        cwd: worktree.path,
        createdByRuntime: true,
        worktree,
        release: async (status) => {
          if (status !== "SUCCEEDED" || keepOnSuccess) return NO_OP_RELEASE;
          try {
            return await manager.remove(worktree.path, {
              keepIfDirty: true,
              // O repositório pai já está em mãos: é para lá que vai o
              // `worktree prune` se a remoção cair no fallback.
              repoPath: worktree.repoPath,
            });
          } catch (error) {
            return {
              removed: false,
              keptBecauseDirty: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      };
    },
  };
}
