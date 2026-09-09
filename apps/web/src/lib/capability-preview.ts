import type {
  CapabilityIssueCode,
  ExecutionMode,
  HarnessCapabilities,
} from "@dungeon-master/contracts";

/**
 * A prévia do capability matching, pela matriz (Fase 8C).
 *
 * O relatório de verdade é o do domínio, que a API devolve no preflight e no
 * `409` de `POST /runs`, com a mensagem canônica. Esta prévia existe para o
 * painel de compatibilidade responder **enquanto o usuário troca a Guilda ou
 * o perfil no formulário**, antes de salvar: a API só sabe verificar o que
 * está gravado. Ela olha só a matriz declarada — as mesmas quatro regras que
 * não precisam de CLI nem de Provider —, e diz de si mesma que é uma prévia.
 * Nada aqui decide se a Expedição parte: quem decide é a API, na partida.
 *
 * Nenhum `if (harness === ...)`: só a matriz, como manda a seção 32 do
 * documento técnico.
 */

export interface PreviewIssue {
  readonly code: CapabilityIssueCode;
  readonly capability: keyof HarnessCapabilities;
  readonly causedBy: readonly string[];
}

export interface PreviewInput {
  readonly capabilities: HarnessCapabilities;
  readonly mode: ExecutionMode;
  /** Os nomes dos servidores MCP escolhidos. */
  readonly mcpServerNames: readonly string[];
  /** A chave do Model escolhido, ou nulo para o padrão da Guilda. */
  readonly modelKey: string | null;
  /** Os nomes das Tools de comando escolhidas. */
  readonly commandToolNames: readonly string[];
}

export interface CapabilityPreview {
  readonly blockers: readonly PreviewIssue[];
  readonly warnings: readonly PreviewIssue[];
}

export function previewCapabilities(input: PreviewInput): CapabilityPreview {
  const { capabilities: caps, mode } = input;
  const blockers: PreviewIssue[] = [];
  const warnings: PreviewIssue[] = [];

  if (mode === "DOCKER" && !caps.dockerExecution) {
    blockers.push({
      code: "DOCKER_UNSUPPORTED",
      capability: "dockerExecution",
      causedBy: ["DOCKER"],
    });
  }
  if (mode === "HOST" && !caps.hostExecution) {
    blockers.push({ code: "HOST_UNSUPPORTED", capability: "hostExecution", causedBy: ["HOST"] });
  }
  if (input.mcpServerNames.length > 0 && !caps.mcpServers) {
    warnings.push({
      code: "MCP_UNSUPPORTED",
      capability: "mcpServers",
      causedBy: [...input.mcpServerNames],
    });
  }
  if (input.modelKey !== null && !caps.modelSelection) {
    warnings.push({
      code: "MODEL_SELECTION_UNSUPPORTED",
      capability: "modelSelection",
      causedBy: [input.modelKey],
    });
  }
  if (input.commandToolNames.length > 0 && !caps.nativePermissions) {
    warnings.push({
      code: "COMMAND_TOOLS_ADVISORY",
      capability: "nativePermissions",
      causedBy: [...input.commandToolNames],
    });
  }

  return { blockers, warnings };
}
