/**
 * As recusas dos cadastros de execução: Harness, Model, Agent,
 * ExecutionProfile e Loadout.
 *
 * Uma união só para os cinco, e não uma por entidade, porque os motivos se
 * repetem — nome tomado, referência inexistente, registro em uso — e cinco
 * uniões quase iguais dariam cinco tradutores quase iguais na API. A união
 * fechada continua garantindo o `switch` exaustivo lá.
 */
export type RegistryWriteFailure =
  | { readonly code: "NAME_TAKEN"; readonly name: string }
  | { readonly code: "MODEL_KEY_TAKEN"; readonly key: string }
  | { readonly code: "HARNESS_NOT_FOUND"; readonly harnessId: string }
  | { readonly code: "HARNESS_DISABLED"; readonly harnessId: string }
  | { readonly code: "MODEL_NOT_FOUND"; readonly modelId: string }
  | {
      readonly code: "MODEL_IN_OTHER_HARNESS";
      readonly modelId: string;
      readonly harnessId: string;
    }
  | { readonly code: "AGENT_NOT_FOUND"; readonly agentId: string }
  | { readonly code: "EXECUTION_PROFILE_NOT_FOUND"; readonly executionProfileId: string }
  | { readonly code: "EXECUTION_PROFILE_DISABLED"; readonly executionProfileId: string }
  | {
      /** O registro é referenciado por Loadouts e não pode ser apagado. */
      readonly code: "IN_USE_BY_LOADOUT";
      readonly loadoutIds: readonly string[];
    }
  | {
      /** O Loadout é referenciado por Runs e não pode ser apagado. */
      readonly code: "IN_USE_BY_RUN";
      readonly runIds: readonly string[];
    };

/** Quantos ids a recusa por uso nomeia antes de cortar. */
export const IN_USE_SAMPLE_LIMIT = 5;
