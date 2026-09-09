import type {
  CapabilityIssue,
  CapabilityReport,
  ExecutionMode,
  HarnessCapabilities,
  LoadoutSnapshot,
} from "@dungeon-master/contracts";

/**
 * Capability matching (planejamento v0.4, Fase 8A; documento técnico, seção 32).
 *
 * Compara o que o Loadout pede — o modo do perfil, os servidores MCP, as Tools
 * de comando, o Model, a intenção de retomar ou de exigir resultado estruturado
 * — com o que o Harness **declara** na matriz. Nunca olha a `key` do Harness:
 * `if (harness === "antigravity")` é exatamente o que a matriz existe para
 * substituir, e um harness novo entra pelo que declara, não pelo nome.
 *
 * Função pura sobre dados já lidos: a API a chama no preflight e em
 * `POST /runs`; o Worker a chama de novo sobre os dois snapshots congelados do
 * Run e grava os avisos como `Diagnostic`. Mesmos dados, mesmo resultado.
 *
 * As mensagens nascem aqui, e não na API, de propósito: o mesmo texto sai no
 * problem details, no preflight e no diário do Run. Uma frase por código,
 * escrita uma vez.
 */

export interface MatchCapabilitiesInput {
  /** O snapshot já resolvido, ou o suficiente dele. */
  readonly snapshot: Pick<LoadoutSnapshot, "name" | "model" | "mcpServers" | "toolDefinitions">;
  readonly harnessCapabilities: HarnessCapabilities;
  readonly executionProfile: { readonly mode: ExecutionMode };
  readonly intent: {
    /** O Run vai retomar a sessão de outro. */
    readonly resume?: boolean;
    /**
     * O Loadout precisa de resultado estruturado para funcionar: é o caso do
     * Escriba do Grimório, que responde JSON validado e sem ele não há lote.
     */
    readonly requiresStructuredOutput?: boolean;
  };
}

function issue(
  severity: CapabilityIssue["severity"],
  code: CapabilityIssue["code"],
  capability: CapabilityIssue["capability"],
  message: string,
  causedBy: readonly string[],
): CapabilityIssue {
  return { code, severity, capability, message, causedBy: [...causedBy] };
}

function listar(nomes: readonly string[]): string {
  return nomes.join(", ");
}

export function matchCapabilities(input: MatchCapabilitiesInput): CapabilityReport {
  const { snapshot, harnessCapabilities: caps, executionProfile, intent } = input;
  const blockers: CapabilityIssue[] = [];
  const warnings: CapabilityIssue[] = [];

  // ------------------------------------------------------------ blockers

  if (executionProfile.mode === "DOCKER" && !caps.dockerExecution) {
    blockers.push(
      issue(
        "BLOCKER",
        "DOCKER_UNSUPPORTED",
        "dockerExecution",
        "O Harness não roda em container (`dockerExecution`) e o perfil de execução é " +
          "`DOCKER`. Escolha um perfil `HOST` ou outro Harness.",
        ["DOCKER"],
      ),
    );
  }

  if (executionProfile.mode === "HOST" && !caps.hostExecution) {
    blockers.push(
      issue(
        "BLOCKER",
        "HOST_UNSUPPORTED",
        "hostExecution",
        "O Harness não roda no host (`hostExecution`) e o perfil de execução é `HOST`. " +
          "Escolha um perfil `DOCKER` ou outro Harness.",
        ["HOST"],
      ),
    );
  }

  if (intent.requiresStructuredOutput === true && !caps.structuredOutput) {
    blockers.push(
      issue(
        "BLOCKER",
        "STRUCTURED_OUTPUT_REQUIRED",
        "structuredOutput",
        "O Loadout exige resultado estruturado e o Harness não declara `structuredOutput`: " +
          "sem JSON validado na saída não há o que ler. Troque o Harness do Loadout.",
        [snapshot.name],
      ),
    );
  }

  // ------------------------------------------------------------ warnings

  const servidores = snapshot.mcpServers.map((server) => server.name);
  if (servidores.length > 0 && !caps.mcpServers) {
    warnings.push(
      issue(
        "WARNING",
        "MCP_UNSUPPORTED",
        "mcpServers",
        "O Harness não sobe servidores MCP por Run (`mcpServers`); os servidores do Loadout " +
          `não chegarão ao agente: ${listar(servidores)}.`,
        servidores,
      ),
    );
  }

  if (snapshot.model !== null && !caps.modelSelection) {
    warnings.push(
      issue(
        "WARNING",
        "MODEL_SELECTION_UNSUPPORTED",
        "modelSelection",
        "O Harness não aceita escolher o modelo (`modelSelection`); o Model " +
          `${snapshot.model.key} será ignorado e a CLI usará o padrão dela.`,
        [snapshot.model.key],
      ),
    );
  }

  const comandos = (snapshot.toolDefinitions ?? [])
    .filter((tool) => tool.kind === "COMMAND")
    .map((tool) => tool.name);
  if (comandos.length > 0 && !caps.nativePermissions) {
    warnings.push(
      issue(
        "WARNING",
        "COMMAND_TOOLS_ADVISORY",
        "nativePermissions",
        "O Harness não tem permissão nativa por comando (`nativePermissions`); as Tools de " +
          `comando do Loadout são só recomendação ao agente, sem barreira: ${listar(comandos)}.`,
        comandos,
      ),
    );
  }

  if (intent.resume === true && !caps.resume) {
    warnings.push(
      issue(
        "WARNING",
        "RESUME_UNSUPPORTED",
        "resume",
        "O Harness não retoma sessão (`resume`); a retomada abriria uma sessão nova, sem a " +
          "conversa anterior.",
        [],
      ),
    );
  }

  return { blockers, warnings };
}

// --------------------------------------------------------------------------
// A regra do pin
// --------------------------------------------------------------------------

/**
 * A versão efetiva de uma Skill num Loadout: a pinada, ou a mais recente.
 *
 * Nulo é "siga a mais recente na hora de congelar o Run", e não "a mais recente
 * de quando o Loadout foi salvo": um Loadout sem pin acompanha a Skill.
 */
export function effectiveSkillVersion(ref: {
  readonly pinnedVersion: number | null;
  readonly latestVersion: number;
}): number {
  return ref.pinnedVersion ?? ref.latestVersion;
}

/** Um pin só faz sentido para uma versão que existe: entre 1 e a mais recente. */
export function isValidSkillPin(pinnedVersion: number, latestVersion: number): boolean {
  return Number.isInteger(pinnedVersion) && pinnedVersion >= 1 && pinnedVersion <= latestVersion;
}
