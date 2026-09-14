import type {
  AutonomyLevel,
  BreakerScope,
  BudgetLimitKey,
  BudgetScope,
  BudgetWindow,
  RoutingKind,
} from "@dungeon-master/contracts";

/**
 * Por que uma escrita das regras da Fase 9A foi recusada.
 *
 * Uma união só para as quatro tabelas, como `RegistryWriteFailure`: os
 * motivos se repetem (id de escopo que não existe, alvo que não existe) e
 * quatro uniões quase iguais divergiriam na primeira adição. Os "não
 * encontrado" existem porque o id recusado veio no corpo, não no caminho.
 */
export type AutonomyWriteFailure =
  | { readonly code: "PROJECT_NOT_FOUND"; readonly projectId: string }
  | { readonly code: "LOADOUT_NOT_FOUND"; readonly loadoutId: string }
  | {
      /** O alvo de uma regra de roteamento não existe na tabela da espécie. */
      readonly code: "ROUTING_TARGET_NOT_FOUND";
      readonly kind: RoutingKind;
      readonly targetId: string;
    }
  | {
      /** O id de escopo não bate com o escopo: falta, ou sobra. */
      readonly code: "SCOPE_MISMATCH";
      readonly scope: BudgetScope | BreakerScope;
      readonly field: "projectId" | "loadoutId" | "harnessKey";
      readonly expected: "required" | "forbidden";
    }
  | { readonly code: "BUDGET_WITHOUT_LIMIT" }
  | {
      readonly code: "BUDGET_LIMIT_NOT_ALLOWED";
      readonly window: BudgetWindow;
      readonly limit: BudgetLimitKey;
    }
  | { readonly code: "BREAKER_WITHOUT_TRIGGER" }
  | { readonly code: "TASK_WITHOUT_PROJECT"; readonly taskId: string }
  | {
      /** O nível de autonomia do Project não libera a automação pedida. */
      readonly code: "AUTOMATION_NOT_ALLOWED";
      readonly automation: string;
      readonly autonomyLevel: AutonomyLevel;
    };
