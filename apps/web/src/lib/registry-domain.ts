import type {
  CapabilityIssueCode,
  CapabilityIssueSeverity,
  McpTransport,
  ProviderAuthStatus,
  ProviderKind,
  ToolKind,
} from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";

import type { McpServerRegistryRecord } from "@/lib/api-types";

/**
 * A ponte entre os enums dos registros da Fase 8A e o que a tela mostra.
 *
 * Mesma disciplina de `lib/execution-domain.ts`: nenhum label escrito, só
 * **chaves** de glossário resolvidas no ponto de render, e todo mapa é um
 * `Record<Enum, …>` para que um valor novo no contrato vire erro de
 * compilação em vez de uma linha sem nome.
 */

/** A cor dos registros: o mesmo eixo dos acentos do canvas, no matiz do violeta. */
export const REGISTRY_COLOR = "var(--accent-violet)";
export const ACCENT_GREEN = "var(--accent-green)";
export const ACCENT_AMBER = "var(--accent-amber)";

/* -------------------------------------------------------------- tool.kind */

export const TOOL_KIND: Record<ToolKind, GlossaryKey> = {
  COMMAND: "tool.kind.command",
  MCP_TOOL: "tool.kind.mcpTool",
};

export const TOOL_KINDS = Object.keys(TOOL_KIND) as readonly ToolKind[];

/* ------------------------------------------------------- mcpServer.transport */

/** Os dois transportes. O nome é canônico e não é tematizado: é protocolo. */
export const MCP_TRANSPORTS: readonly McpTransport[] = ["STDIO", "HTTP"];

/* ---------------------------------------------------------- provider.kind */

export const PROVIDER_KIND: Record<ProviderKind, GlossaryKey> = {
  SUBSCRIPTION: "provider.kind.subscription",
  API_KEY: "provider.kind.apiKey",
  LOCAL: "provider.kind.local",
};

export const PROVIDER_KINDS = Object.keys(PROVIDER_KIND) as readonly ProviderKind[];

/* ---------------------------------------------------- provider.authStatus */

interface ProviderAuthPresentation {
  readonly label: GlossaryKey;
  /** Verde para credencial presente, âmbar para ausente, cinza para o resto. */
  readonly tone: "ok" | "bad" | "neutral";
}

export const PROVIDER_AUTH_STATUS: Record<ProviderAuthStatus, ProviderAuthPresentation> = {
  ENV_KEY_PRESENT: { label: "provider.auth.envKeyPresent", tone: "ok" },
  CLI_AUTHENTICATED: { label: "provider.auth.cliAuthenticated", tone: "ok" },
  CLI_NOT_AUTHENTICATED: { label: "provider.auth.cliNotAuthenticated", tone: "bad" },
  NOT_REQUIRED: { label: "provider.auth.notRequired", tone: "ok" },
  UNKNOWN: { label: "provider.auth.unknown", tone: "neutral" },
};

/* ------------------------------------------------------------- capability */

export const CAPABILITY_SEVERITY: Record<CapabilityIssueSeverity, GlossaryKey> = {
  BLOCKER: "capability.severity.blocker",
  WARNING: "capability.severity.warning",
};

/** O título curto de cada código, na ordem do contrato. */
export const CAPABILITY_CODE: Record<CapabilityIssueCode, GlossaryKey> = {
  DOCKER_UNSUPPORTED: "capability.code.dockerUnsupported",
  HOST_UNSUPPORTED: "capability.code.hostUnsupported",
  STRUCTURED_OUTPUT_REQUIRED: "capability.code.structuredOutputRequired",
  MCP_UNSUPPORTED: "capability.code.mcpUnsupported",
  MODEL_SELECTION_UNSUPPORTED: "capability.code.modelSelectionUnsupported",
  COMMAND_TOOLS_ADVISORY: "capability.code.commandToolsAdvisory",
  RESUME_UNSUPPORTED: "capability.code.resumeUnsupported",
};

/**
 * `true` quando o texto é um nome de variável de ambiente: maiúsculas,
 * dígitos e sublinhado, sem `=`. É a mesma regra de `ENV_KEY_PATTERN` do
 * contrato, repetida aqui porque a web só importa tipos de lá.
 */
export function isEnvKey(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]{0,127}$/.test(value);
}

/** A regra de nome de servidor MCP, a mesma de `MCP_SERVER_NAME_PATTERN`. */
export function isMcpServerName(value: string): boolean {
  return /^[a-z][a-z0-9_-]{0,62}$/.test(value);
}

/** Uma URL `http(s)://` sem `usuário:senha@`, como `McpServerUrlSchema` exige. */
export function isMcpServerUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && !/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(value);
}

/** O comando com os argumentos, ou a URL: a linha que o Worker vai executar. */
export function mcpServerTarget(
  server: Pick<McpServerRegistryRecord, "transport" | "command" | "args" | "url">,
): string {
  if (server.transport === "HTTP") return server.url ?? "";
  return [server.command ?? "", ...server.args].join(" ");
}
