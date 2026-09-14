import type {
  AgentRole,
  DelegationTaskStrategy,
  HarnessKey,
  RunResultStatus,
  RunStatus,
  UsageSummary,
} from "@dungeon-master/contracts";

/**
 * A porta das ferramentas de delegação.
 *
 * `userId`, `projectId` e `runId` (o Run mãe) entram uma vez, na construção,
 * e **nenhuma** ferramenta os aceita por chamada: `delegate` abre o filho em
 * nome deste Run mãe e só dele; `getChild` responde "não encontrado" para
 * qualquer Run que não seja filho dele, inclusive um que exista. A
 * implementação em memória faz a mesma promessa para os testes de unidade.
 */

/** Um Loadout como o agente o enxerga: o suficiente para escolher. */
export interface OrchestrationLoadout {
  readonly id: string;
  readonly name: string;
  readonly agentName: string;
  readonly agentRole: AgentRole;
  readonly harnessKey: HarnessKey;
  readonly isDefault: boolean;
}

/** O Run filho como as ferramentas o devolvem. */
export interface OrchestrationChildRun {
  readonly id: string;
  readonly taskId: string;
  readonly status: RunStatus;
  readonly loadoutName: string;
  readonly resultStatus: RunResultStatus | null;
  readonly summary: string | null;
  readonly usage: UsageSummary | null;
  readonly error: { readonly code?: string | undefined; readonly message: string } | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export type DelegateOutcome =
  | { readonly ok: true; readonly child: OrchestrationChildRun }
  | {
      readonly ok: false;
      /** `DELEGATION_NOT_ALLOWED`, `DELEGATION_DEPTH_EXCEEDED`, `BUDGET_EXCEEDED`, `BREAKER_OPEN`, `LOADOUT_REF_NOT_FOUND`, … */
      readonly code: string;
      readonly reason: string;
    };

export interface OrchestrationToolStore {
  /** Os Loadouts do usuário, em ordem alfabética. */
  listLoadouts(): Promise<readonly OrchestrationLoadout[]>;
  /** Abre um Run filho do Run mãe fixado na construção. */
  delegate(input: {
    readonly loadoutRef: string;
    readonly prompt: string;
    readonly taskStrategy: DelegationTaskStrategy;
  }): Promise<DelegateOutcome>;
  /** Um filho do Run mãe, pelo id. Outro Run é `null`. */
  getChild(runId: string): Promise<OrchestrationChildRun | null>;
}
