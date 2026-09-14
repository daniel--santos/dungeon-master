import type { RunStatus } from "@dungeon-master/contracts";
import { MAX_DELEGATION_DEPTH } from "@dungeon-master/domain";

import type {
  DelegateOutcome,
  OrchestrationChildRun,
  OrchestrationLoadout,
  OrchestrationToolStore,
} from "./store.js";

/**
 * O store em memória: a mesma porta, sem banco.
 *
 * Existe para os testes de unidade das ferramentas e do servidor. O que se
 * prova aqui é escopo, nível, profundidade e formato; o caminho de criação
 * de verdade — orçamentos, disjuntores, política — é provado no teste de
 * stdio contra o banco e no Worker.
 */

export interface MemoryOrchestrationStoreOptions {
  readonly runId: string;
  readonly projectId: string;
  readonly loadouts: readonly OrchestrationLoadout[];
  /** O nível do Project: abaixo de 4 nada é delegado. Padrão: 4. */
  readonly autonomyLevel?: number | undefined;
  /** A profundidade do Run mãe. Padrão: 0. */
  readonly depth?: number | undefined;
  /** Uma recusa roteirizada (orçamento, disjuntor). */
  readonly refuse?: { readonly code: string; readonly reason: string } | undefined;
}

export interface MemoryOrchestrationStore extends OrchestrationToolStore {
  /** Os filhos abertos, por id. */
  readonly children: Map<string, OrchestrationChildRun>;
  /** Um Run que existe mas **não** é filho do Run mãe: o que `await_run` nunca vê. */
  addForeignRun(run: OrchestrationChildRun): void;
  /** O desfecho de um filho, como o Worker gravaria. */
  settleChild(runId: string, patch: Partial<OrchestrationChildRun> & { status: RunStatus }): void;
}

let contador = 0;

function fakeUuid(): string {
  contador += 1;
  return `01996d00-0000-7000-8000-${contador.toString(16).padStart(12, "0")}`;
}

export function createInMemoryOrchestrationStore(
  options: MemoryOrchestrationStoreOptions,
): MemoryOrchestrationStore {
  const children = new Map<string, OrchestrationChildRun>();
  const foreign = new Map<string, OrchestrationChildRun>();
  const nivel = options.autonomyLevel ?? 4;
  const depth = options.depth ?? 0;

  return {
    children,

    listLoadouts: () => Promise.resolve([...options.loadouts]),

    delegate: (input): Promise<DelegateOutcome> => {
      if (nivel < 4) {
        return Promise.resolve({
          ok: false,
          code: "DELEGATION_NOT_ALLOWED",
          reason: `O nível de autonomia ${String(nivel)} do Project não libera DELEGATE.`,
        });
      }
      if (depth + 1 > MAX_DELEGATION_DEPTH) {
        return Promise.resolve({
          ok: false,
          code: "DELEGATION_DEPTH_EXCEEDED",
          reason: `O Run mãe está na profundidade ${String(depth)} e o teto é ${String(MAX_DELEGATION_DEPTH)}.`,
        });
      }
      const loadout = options.loadouts.find(
        (item) => item.id === input.loadoutRef || item.name === input.loadoutRef,
      );
      if (loadout === undefined) {
        return Promise.resolve({
          ok: false,
          code: "LOADOUT_REF_NOT_FOUND",
          reason: `Não há Loadout com o id ou o nome "${input.loadoutRef}".`,
        });
      }
      if (options.refuse !== undefined) return Promise.resolve({ ok: false, ...options.refuse });

      const child: OrchestrationChildRun = {
        id: fakeUuid(),
        taskId:
          input.taskStrategy === "CHILD" ? fakeUuid() : "01996d00-0000-7000-8000-00000000aa01",
        status: "QUEUED",
        loadoutName: loadout.name,
        resultStatus: null,
        summary: null,
        usage: null,
        error: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      };
      children.set(child.id, child);
      return Promise.resolve({ ok: true, child: structuredClone(child) });
    },

    getChild: (runId) => {
      const child = children.get(runId);
      return Promise.resolve(child === undefined ? null : structuredClone(child));
    },

    addForeignRun: (run) => {
      foreign.set(run.id, run);
    },

    settleChild: (runId, patch) => {
      const child = children.get(runId);
      if (child === undefined) throw new Error(`Não há filho ${runId}.`);
      children.set(runId, { ...child, ...patch });
    },
  };
}
