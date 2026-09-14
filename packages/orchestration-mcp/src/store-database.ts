import {
  createDelegatedRun,
  type Database,
  type DelegationFailure,
  findAgentRow,
  findChildRunOf,
  findHarnessRow,
  findRunRow,
  findTaskRow,
  listLoadouts,
  lockRunRow,
} from "@dungeon-master/database";

import type {
  DelegateOutcome,
  OrchestrationChildRun,
  OrchestrationLoadout,
  OrchestrationToolStore,
} from "./store.js";

/**
 * A porta sobre o banco.
 *
 * `userId`, `projectId` e `runId` entram uma vez, na construção, e toda
 * escrita e leitura os carrega: a delegação é feita em nome do Run mãe
 * fixado, que precisa existir, estar em `RUNNING` e pertencer ao Project
 * fixado; `getChild` só enxerga filhos desse Run.
 *
 * A criação do filho é `createDelegatedRun`, o mesmo caminho do step
 * `delegate` do Workflow, com `requireDelegateLevel`: o nível de autonomia
 * do Project é relido **na transação** — o Worker ofereceu a ferramenta
 * quando o Run partiu, mas o nível pode ter baixado desde então.
 */

export interface DatabaseOrchestrationToolStoreOptions {
  readonly userId: string;
  readonly projectId: string;
  /** O Run mãe: o único em nome de quem este processo delega. */
  readonly runId: string;
}

function descreverRecusa(failure: DelegationFailure): string {
  switch (failure.code) {
    case "DELEGATION_NOT_ALLOWED":
      return `O nível de autonomia ${String(failure.autonomyLevel)} do Project não libera DELEGATE.`;
    case "DELEGATION_DEPTH_EXCEEDED":
      return `O Run mãe está na profundidade ${String(failure.parentDepth)} e o teto é ${String(failure.maxDepth)}.`;
    case "LOADOUT_REF_NOT_FOUND":
      return `Não há Loadout com o id ou o nome "${failure.loadoutRef}". Consulte list_loadouts.`;
    case "PARENT_NOT_RUNNING":
      return `O Run mãe está em ${failure.status}; só um Run em RUNNING delega.`;
    case "BUDGET_EXCEEDED":
      return failure.breach.reason;
    case "BREAKER_OPEN":
      return failure.breaker.reason;
    case "POLICY_DENIED":
    case "POLICY_REQUIRES_APPROVAL":
      return failure.decision.reason;
    case "CAPABILITY_BLOCKED":
      return failure.blockers.map((blocker) => blocker.message).join(" ");
    default:
      return `A criação do Run filho foi recusada com ${failure.code}.`;
  }
}

export function createDatabaseOrchestrationToolStore(
  db: Database,
  options: DatabaseOrchestrationToolStoreOptions,
): OrchestrationToolStore {
  const { userId, projectId, runId } = options;

  return {
    async listLoadouts(): Promise<readonly OrchestrationLoadout[]> {
      const rows = await listLoadouts(db, { userId });
      const resultado: OrchestrationLoadout[] = [];
      for (const loadout of rows) {
        // Um Loadout quebrado (Agent ou Harness apagados) não é oferecido:
        // delegar a ele falharia na criação com LOADOUT_BROKEN.
        const agent = await findAgentRow(db, { userId, agentId: loadout.agentId });
        const harness = await findHarnessRow(db, { userId, harnessId: loadout.harnessId });
        if (agent === null || harness === null || !harness.enabled) continue;
        resultado.push({
          id: loadout.id,
          name: loadout.name,
          agentName: agent.name,
          agentRole: agent.role,
          harnessKey: harness.key,
          isDefault: loadout.isDefault,
        });
      }
      return resultado;
    },

    async delegate(input): Promise<DelegateOutcome> {
      return await db.transaction(async (tx) => {
        const parent = await lockRunRow(tx, { userId, runId });
        if (parent === null) {
          return { ok: false, code: "PARENT_RUN_NOT_FOUND", reason: "O Run mãe não existe." };
        }
        // O escopo de Project é conferido aqui, e não confiado ao argv: um
        // processo subido com o Project errado não delega em nome de ninguém.
        const task = await findTaskRow(tx, { userId, taskId: parent.taskId });
        if (task === null || task.projectId !== projectId) {
          return {
            ok: false,
            code: "PROJECT_MISMATCH",
            reason: "O Run mãe não pertence ao Project deste servidor.",
          };
        }
        const criado = await createDelegatedRun(tx, {
          userId,
          parent,
          loadoutRef: input.loadoutRef,
          prompt: input.prompt,
          taskStrategy: input.taskStrategy,
          requireDelegateLevel: true,
        });
        if (!criado.ok) {
          return { ok: false, code: criado.failure.code, reason: descreverRecusa(criado.failure) };
        }
        const filho = await findRunRow(tx, { userId, runId: criado.value.id });
        if (filho === null) throw new Error("O Run filho recém-criado não foi reencontrado.");
        return {
          ok: true,
          child: {
            id: filho.id,
            taskId: filho.taskId,
            status: filho.status,
            loadoutName: filho.loadoutSnapshot.name,
            resultStatus: null,
            summary: null,
            usage: null,
            error: null,
            createdAt: filho.createdAt.toISOString(),
            finishedAt: null,
          },
        };
      });
    },

    async getChild(childRunId): Promise<OrchestrationChildRun | null> {
      const child = await findChildRunOf(db, { userId, parentRunId: runId, childRunId });
      return child;
    },
  };
}
