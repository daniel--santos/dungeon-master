import type { McpTransport, ToolKind } from "@dungeon-master/contracts";

/**
 * As recusas dos cadastros de execução: Harness, Model, Agent,
 * ExecutionProfile, Loadout e, desde a Fase 8A, Skill, Tool, servidor MCP e
 * Provider.
 *
 * Uma união só para todos, e não uma por entidade, porque os motivos se
 * repetem — nome tomado, referência inexistente, registro em uso — e nove
 * uniões quase iguais dariam nove tradutores quase iguais na API. A união
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
    }
  // ------------------------------------------------------------- Fase 8A
  | { readonly code: "SKILL_NOT_FOUND"; readonly skillId: string }
  | {
      /** O pin aponta para uma versão que a Skill não tem. */
      readonly code: "SKILL_VERSION_NOT_FOUND";
      readonly skillId: string;
      readonly version: number;
      readonly latestVersion: number;
    }
  | {
      /** CAS perdido ao publicar: a versão mais recente já não é a esperada. */
      readonly code: "SKILL_VERSION_CONFLICT";
      readonly skillId: string;
      readonly expectedLatestVersion: number;
      readonly latestVersion: number;
    }
  | { readonly code: "TOOL_NOT_FOUND"; readonly toolId: string }
  | {
      /** Um campo da outra espécie num PATCH de Tool. */
      readonly code: "TOOL_SHAPE_INVALID";
      readonly kind: ToolKind;
      readonly field: string;
    }
  | { readonly code: "MCP_SERVER_NOT_FOUND"; readonly mcpServerId: string }
  | {
      /** Um campo do outro transporte num PATCH de servidor MCP. */
      readonly code: "MCP_SERVER_SHAPE_INVALID";
      readonly transport: McpTransport;
      readonly field: string;
    }
  | {
      /** A forma curta trouxe um nome que já existe no registro com outra definição. */
      readonly code: "MCP_SERVER_DEFINITION_MISMATCH";
      readonly name: string;
      readonly mcpServerId: string;
    }
  | {
      /** O servidor nasce com o sistema: não se apaga nem se redefine. */
      readonly code: "BUILT_IN_PROTECTED";
      readonly mcpServerId: string;
      readonly name: string;
    }
  | { readonly code: "PROVIDER_NOT_FOUND"; readonly providerId: string }
  | {
      /** O Provider é referenciado por Models e não pode ser apagado. */
      readonly code: "IN_USE_BY_MODEL";
      readonly modelIds: readonly string[];
    }
  | {
      /** O servidor MCP é referenciado por Tools e não pode ser apagado. */
      readonly code: "IN_USE_BY_TOOL";
      readonly toolIds: readonly string[];
    }
  | {
      /** O corpo trouxe a forma por id e a forma curta da mesma coleção. */
      readonly code: "REFERENCE_FORMS_MIXED";
      readonly collection: "skills" | "tools" | "mcpServers";
    }
  | {
      readonly code: "LOADOUT_VERSION_NOT_FOUND";
      readonly loadoutId: string;
      readonly version: number;
    };

/** Quantos ids a recusa por uso nomeia antes de cortar. */
export const IN_USE_SAMPLE_LIMIT = 5;
