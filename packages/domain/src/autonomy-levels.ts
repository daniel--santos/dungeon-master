import type { AutomationKind, AutonomyLevel, ProjectAutonomy } from "@dungeon-master/contracts";

/**
 * A escada de autonomia (documento técnico, seção 40; planejamento v0.4,
 * Fase 9A). **Esta tabela é a única fonte** do que cada nível libera; o
 * contrato só tem o vocabulário, e a API só chama `allowsAutomation`.
 *
 * ```text
 * 0  nada: o usuário cria e executa à mão
 * 1  SUGGEST                  o sistema sugere Loadout, Workflow e Model
 * 2  (o padrão) o agente propõe; o humano decide tudo
 * 3  AUTO_APPROVE_PROPOSAL    políticas criam a Task sem passar pela proposta
 *    AUTO_APPROVE_GATE        políticas concedem um ApprovalGate (9B)
 *    AUTO_DISPATCH            o Worker enfileira por conta própria (9B)
 * 4  DELEGATE                 delegação Agent-to-Agente (9B)
 * ```
 *
 * Fail-closed: um nível que não está na tabela não libera nada.
 */
export const AUTONOMY_MINIMUM_LEVEL = {
  SUGGEST: 1,
  AUTO_APPROVE_PROPOSAL: 3,
  AUTO_APPROVE_GATE: 3,
  AUTO_DISPATCH: 3,
  DELEGATE: 4,
} as const satisfies Record<AutomationKind, AutonomyLevel>;

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [0, 1, 2, 3, 4];

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return typeof value === "number" && (AUTONOMY_LEVELS as readonly number[]).includes(value);
}

/** O nível libera a automação? Nível fora da escada não libera nada. */
export function allowsAutomation(level: AutonomyLevel, kind: AutomationKind): boolean {
  if (!isAutonomyLevel(level)) return false;
  const minimo = AUTONOMY_MINIMUM_LEVEL[kind];
  return level >= minimo;
}

/** O mapa completo, para a resposta de `GET /projects/{id}/autonomy`. */
export function describeAutonomy(level: AutonomyLevel): ProjectAutonomy["allows"] {
  return {
    SUGGEST: allowsAutomation(level, "SUGGEST"),
    AUTO_APPROVE_PROPOSAL: allowsAutomation(level, "AUTO_APPROVE_PROPOSAL"),
    AUTO_APPROVE_GATE: allowsAutomation(level, "AUTO_APPROVE_GATE"),
    AUTO_DISPATCH: allowsAutomation(level, "AUTO_DISPATCH"),
    DELEGATE: allowsAutomation(level, "DELEGATE"),
  };
}
