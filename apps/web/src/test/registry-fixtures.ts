import type {
  CapabilityIssueRecord,
  LoadoutPreflightRecord,
  LoadoutVersionRecord,
  McpServerRegistryRecord,
  ProviderRecord,
  RunCreatedRecord,
  SkillDetailRecord,
  SkillRecord,
  SkillVersionRecord,
  ToolRecord,
} from "@/lib/api-types";
import { HARNESS, HOST_PROFILE, LOADOUT, RUN } from "@/test/execution-fixtures";

/**
 * Registros da Fase 8A para os testes de componente da Fase 8C.
 *
 * Um só lugar, como `execution-fixtures.ts`: o formulário de Equipamento, o
 * painel de compatibilidade, o histórico e o diálogo de partida leem os mesmos
 * ids, e duas cópias divergiriam na primeira Skill que ganhasse uma versão.
 */

const NOW = "2026-09-09T10:00:00.000Z";
const EARLIER = "2026-09-08T10:00:00.000Z";

export const SKILL_ID = LOADOUT.skillRefs[0]!.skillId;

export const SKILL: SkillRecord = {
  id: SKILL_ID,
  name: "Testes de plataforma",
  description: "Como testar no Windows e no macOS.",
  latestVersion: 2,
  createdAt: EARLIER,
  updatedAt: NOW,
};

export const SKILL_V1: SkillVersionRecord = {
  id: "0199aaaa-0000-7000-8000-00000000a001",
  skillId: SKILL_ID,
  version: 1,
  content: "# Testes\n\nRode `pnpm test` antes de commitar.\nConfira o CI nos dois sistemas.",
  changelog: null,
  createdAt: EARLIER,
};

export const SKILL_V2: SkillVersionRecord = {
  id: "0199aaaa-0000-7000-8000-00000000a002",
  skillId: SKILL_ID,
  version: 2,
  content:
    "# Testes\n\nRode `pnpm test` antes de commitar.\nConfira o CI nos dois sistemas.\nProve que o vermelho é vermelho.",
  changelog: "Acrescenta a prova do vermelho.",
  createdAt: NOW,
};

export const SKILL_DETAIL: SkillDetailRecord = { ...SKILL, latest: SKILL_V2 };

export const OTHER_SKILL: SkillRecord = {
  id: "0199aaaa-0000-7000-8000-000000000002",
  name: "Leitura de código",
  description: null,
  latestVersion: 1,
  createdAt: EARLIER,
  updatedAt: EARLIER,
};

export const TOOL: ToolRecord = {
  id: LOADOUT.toolRefs[0]!.toolId,
  name: "Ler",
  kind: "COMMAND",
  command: "git status",
  mcpServerId: null,
  toolName: null,
  description: null,
  createdAt: EARLIER,
  updatedAt: EARLIER,
};

export const OTHER_TOOL: ToolRecord = {
  ...TOOL,
  id: LOADOUT.toolRefs[1]!.toolId,
  name: "Editar",
  command: "git add",
};

export const MCP_SERVER: McpServerRegistryRecord = {
  id: "0199cccc-0000-7000-8000-00000000c001",
  name: "knowledge",
  transport: "STDIO",
  command: "node",
  args: [],
  url: null,
  envKeys: ["DATABASE_URL"],
  readOnly: true,
  builtIn: true,
  description: "O servidor MCP de conhecimento, só leitura.",
  createdAt: EARLIER,
  updatedAt: EARLIER,
};

export const PROVIDER: ProviderRecord = {
  id: "0199dddd-0000-7000-8000-00000000d001",
  name: "Anthropic",
  kind: "SUBSCRIPTION",
  authEnvKeys: ["ANTHROPIC_API_KEY"],
  harnessKeys: ["CLAUDE_CODE", "PI"],
  docsUrl: "https://docs.anthropic.com/",
  createdAt: EARLIER,
  updatedAt: EARLIER,
};

export const DOCKER_BLOCKER: CapabilityIssueRecord = {
  code: "DOCKER_UNSUPPORTED",
  severity: "BLOCKER",
  capability: "dockerExecution",
  message:
    "O harness não roda em container (`dockerExecution`) e o perfil de execução é `DOCKER`. Escolha um perfil `HOST` ou outro harness.",
  causedBy: ["DOCKER"],
};

export const MCP_WARNING: CapabilityIssueRecord = {
  code: "MCP_UNSUPPORTED",
  severity: "WARNING",
  capability: "mcpServers",
  message:
    "O harness não sobe servidores MCP por Run (`mcpServers`); os servidores do loadout não chegarão ao agente: knowledge.",
  causedBy: ["knowledge"],
};

export const PREFLIGHT_OK: LoadoutPreflightRecord = {
  loadoutId: LOADOUT.id,
  loadoutVersion: LOADOUT.version,
  checkedAt: NOW,
  durationMs: 420,
  harness: {
    id: HARNESS.id,
    key: HARNESS.key,
    name: HARNESS.name,
    enabled: true,
    capabilities: HARNESS.capabilities,
    installedVersion: HARNESS.installedVersion,
    checkedAt: NOW,
  },
  executionProfile: {
    id: HOST_PROFILE.id,
    name: HOST_PROFILE.name,
    mode: "HOST",
    enforcement: HOST_PROFILE.enforcement,
    enabled: true,
  },
  model: null,
  provider: {
    providerId: PROVIDER.id,
    name: PROVIDER.name,
    kind: PROVIDER.kind,
    authEnvKeys: [...PROVIDER.authEnvKeys],
    presentEnvKeys: [],
    status: "CLI_AUTHENTICATED",
    docsUrl: PROVIDER.docsUrl,
  },
  cli: {
    mode: "HOST",
    adapterId: "claude-code@host",
    installed: true,
    version: "claude 2.1.263",
    authenticated: true,
    timedOut: false,
    problems: [],
  },
  docker: null,
  capabilities: { blockers: [], warnings: [] },
  ready: true,
};

export const PREFLIGHT_WARNINGS: LoadoutPreflightRecord = {
  ...PREFLIGHT_OK,
  capabilities: { blockers: [], warnings: [MCP_WARNING] },
};

export const PREFLIGHT_BLOCKED: LoadoutPreflightRecord = {
  ...PREFLIGHT_OK,
  executionProfile: { ...PREFLIGHT_OK.executionProfile, mode: "DOCKER" },
  cli: null,
  docker: {
    daemonReachable: false,
    serverVersion: null,
    imageName: "dungeon-master-agent:0.2.0",
    imagePresent: false,
    problems: [],
  },
  capabilities: { blockers: [DOCKER_BLOCKER], warnings: [] },
  ready: false,
};

export const RUN_CREATED: RunCreatedRecord = { ...RUN, warnings: [] };

const DEFINITION_V3 = {
  name: LOADOUT.name,
  agentId: LOADOUT.agentId,
  harnessId: LOADOUT.harnessId,
  modelId: null,
  executionProfileId: LOADOUT.executionProfileId,
  skillRefs: [{ skillId: SKILL_ID, pinnedVersion: 1 }],
  toolIds: [TOOL.id],
  mcpServerIds: [],
  knowledgePolicy: LOADOUT.knowledgePolicy,
  contextPolicy: LOADOUT.contextPolicy,
  isDefault: true,
};

/** A v4 é a atual do `LOADOUT`: a Skill sem pin e o segundo Item entrando. */
export const LOADOUT_VERSION_4: LoadoutVersionRecord = {
  id: "0199eeee-0000-7000-8000-00000000e004",
  loadoutId: LOADOUT.id,
  version: 4,
  definition: {
    ...DEFINITION_V3,
    skillRefs: [{ skillId: SKILL_ID, pinnedVersion: null }],
    toolIds: [TOOL.id, OTHER_TOOL.id],
  },
  createdAt: NOW,
};

export const LOADOUT_VERSION_3: LoadoutVersionRecord = {
  id: "0199eeee-0000-7000-8000-00000000e003",
  loadoutId: LOADOUT.id,
  version: 3,
  definition: DEFINITION_V3,
  createdAt: EARLIER,
};
