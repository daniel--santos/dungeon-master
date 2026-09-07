import { dnd } from "@dungeon-master/glossary";

import type {
  AgentRecord,
  ExecutionProfileRecord,
  HarnessRecord,
  LoadoutRecord,
  RunRecord,
  TaskDetailRecord,
} from "@/lib/api-types";

/**
 * Registros de execução para os testes de componente.
 *
 * Um só lugar, porque o diálogo de partida e o de cancelamento precisam do
 * mesmo Run e do mesmo Equipamento, e duas cópias divergiriam no primeiro campo
 * que o contrato ganhasse.
 */

const NOW = "2026-09-07T14:02:11.000Z";

export const AGENT: AgentRecord = {
  id: "0199aaaa-0000-7000-8000-000000000001",
  name: "Ferreiro de Plataforma",
  role: "ENGINEER",
  instructions: "Implementa e testa no mesmo passo.",
  description: null,
  createdAt: NOW,
  updatedAt: NOW,
};

export const HARNESS: HarnessRecord = {
  id: "0199bbbb-0000-7000-8000-000000000001",
  key: "CLAUDE_CODE",
  name: "Claude Code",
  enabled: true,
  capabilities: {
    streaming: true,
    structuredOutput: true,
    resume: true,
    multiTurnProcess: false,
    toolEvents: true,
    tokenUsage: true,
    modelSelection: true,
    agentSelection: true,
    nativePermissions: true,
    hostExecution: true,
    dockerExecution: true,
  },
  installedVersion: "claude 2.1.263",
  checkedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

export const HOST_PROFILE: ExecutionProfileRecord = {
  id: "0199cccc-0000-7000-8000-000000000001",
  // O `db:seed` batiza os dois perfis com os labels do tema; a fixture lê os
  // mesmos do glossário em vez de repetir o texto, que a varredura de
  // `labels.test.ts` proíbe fora da fronteira.
  name: dnd["env.host"],
  mode: "HOST",
  workspaceStrategy: "GIT_WORKTREE",
  enforcement: "HARNESS_NATIVE",
  permissionPolicy: {
    workspaceWrite: true,
    commandExecution: "ALLOWLIST",
    allowedCommands: [],
    deniedCommands: [],
  },
  environmentPolicy: { allowedVariables: [], inheritPath: true },
  networkPolicy: { access: "ALL", allowedHosts: [] },
  enabled: true,
  isDefault: true,
  createdAt: NOW,
  updatedAt: NOW,
};

/** O perfil Docker nasce desligado: é a Fase 2C que o liga. */
export const DOCKER_PROFILE: ExecutionProfileRecord = {
  ...HOST_PROFILE,
  id: "0199cccc-0000-7000-8000-000000000002",
  name: dnd["env.docker"],
  mode: "DOCKER",
  enforcement: "SANDBOX_ENFORCED",
  enabled: false,
  isDefault: false,
};

export const LOADOUT: LoadoutRecord = {
  id: "0199dddd-0000-7000-8000-000000000001",
  name: "Forja de Plataforma",
  agentId: AGENT.id,
  harnessId: HARNESS.id,
  modelId: null,
  executionProfileId: HOST_PROFILE.id,
  skills: ["Testes de plataforma"],
  tools: ["Ler", "Editar"],
  mcpServers: [],
  knowledgePolicy: { includeProjectSummary: true, includeDecisions: true, maxItems: 10 },
  contextPolicy: { includeParentContext: true, includeDependencyContext: true, maxTokens: 0 },
  version: 4,
  isDefault: true,
  createdAt: NOW,
  updatedAt: NOW,
};

export const TASK: TaskDetailRecord = {
  id: "0199eeee-0000-7000-8000-000000000001",
  projectId: "0199ffff-0000-7000-8000-000000000001",
  parentTaskId: null,
  title: "Worker não encerra a árvore de processos no Windows",
  description: "taskkill devolve 0 mesmo com um filho vivo.",
  kind: "BUG",
  status: "READY",
  priority: "URGENT",
  completedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  children: [],
  dependencies: [],
  dependents: [],
};

export const RUN: RunRecord = {
  id: "01990000-0000-7000-8000-000000000001",
  taskId: TASK.id,
  projectId: TASK.projectId,
  status: "RUNNING",
  harnessKey: "CLAUDE_CODE",
  harnessVersion: "claude 2.1.263",
  harnessSessionId: "sess_01K7QW3M8ZP4RN",
  resumedFromRunId: null,
  modelKey: null,
  executionMode: "HOST",
  workspacePath: "D:\\Dev\\Claude\\Estudo\\dungeon-master\\.runs\\exp-241",
  workflowVersionId: null,
  loadoutId: LOADOUT.id,
  loadoutVersion: LOADOUT.version,
  loadoutSnapshot: {
    loadoutId: LOADOUT.id,
    name: LOADOUT.name,
    version: LOADOUT.version,
    agent: { id: AGENT.id, name: AGENT.name, role: AGENT.role, instructions: AGENT.instructions },
    harness: {
      id: HARNESS.id,
      key: HARNESS.key,
      name: HARNESS.name,
      capabilities: HARNESS.capabilities,
    },
    model: null,
    executionProfileId: HOST_PROFILE.id,
    skills: LOADOUT.skills,
    tools: LOADOUT.tools,
    mcpServers: [],
    knowledgePolicy: LOADOUT.knowledgePolicy,
    contextPolicy: LOADOUT.contextPolicy,
    capturedAt: NOW,
  },
  executionProfileSnapshot: {
    executionProfileId: HOST_PROFILE.id,
    name: HOST_PROFILE.name,
    mode: HOST_PROFILE.mode,
    workspaceStrategy: HOST_PROFILE.workspaceStrategy,
    enforcement: HOST_PROFILE.enforcement,
    permissionPolicy: HOST_PROFILE.permissionPolicy,
    environmentPolicy: HOST_PROFILE.environmentPolicy,
    networkPolicy: HOST_PROFILE.networkPolicy,
    capturedAt: NOW,
  },
  prompt: TASK.title,
  attempt: 1,
  startedAt: NOW,
  finishedAt: null,
  cancelRequestedAt: null,
  result: null,
  error: null,
  createdAt: NOW,
  updatedAt: NOW,
};

/** Uma resposta do cliente gerado, no formato que `openapi-fetch` devolve. */
export function ok<T>(data: T) {
  return { data, error: undefined, response: new Response(null, { status: 200 }) };
}
