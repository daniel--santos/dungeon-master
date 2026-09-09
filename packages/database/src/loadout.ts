import type {
  ContextPolicy,
  KnowledgePolicy,
  Loadout,
  LoadoutDefinition,
  LoadoutMcpServerRef,
  LoadoutSkillRef,
  LoadoutSnapshot,
  LoadoutToolRef,
  LoadoutVersion,
  McpServerRef,
  McpServerSnapshot,
  SkillVersionSnapshot,
  ToolSnapshot,
} from "@dungeon-master/contracts";
import { effectiveSkillVersion, isValidSkillPin } from "@dungeon-master/domain";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { findAgentRow } from "./agent.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { findExecutionProfileRow } from "./execution-profile.js";
import { findHarnessRow, findModelRow } from "./harness.js";
import { newId } from "./ids.js";
import {
  findMcpServerRow,
  findMcpServerRowByName,
  insertMcpServerRow,
  mcpServerTarget,
  splitStdioTarget,
  toMcpServerRef,
} from "./mcp-server.js";
import { IN_USE_SAMPLE_LIMIT, type RegistryWriteFailure } from "./registry.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import {
  type AgentRow,
  type HarnessRow,
  loadoutMcpServers,
  loadouts,
  loadoutSkills,
  loadoutTools,
  type LoadoutRow,
  type LoadoutVersionRow,
  loadoutVersions,
  models,
} from "./schema/execution.js";
import {
  type McpServerRow,
  mcpServers,
  type SkillRow,
  skills,
  skillVersions,
  type ToolRow,
  tools,
} from "./schema/registry.js";
import { runs } from "./schema/run.js";
import { findSkillRow, insertSkillWithFirstVersion } from "./skill.js";
import { findToolRow, findToolRowByName, insertToolRow } from "./tool.js";

/**
 * Loadout: o Equipamento, agora **por referência** (Fase 8A).
 *
 * As Skills, Tools e servidores MCP moram em junções apontando para registros
 * versionados; o Loadout carrega os pins e a ordem. Cada `version` tem uma
 * linha em `loadout_version` com a definição por referências daquele número,
 * e o snapshot que o Run congela resolve tudo: o conteúdo da versão efetiva de
 * cada Skill, a definição de cada Tool e a forma de subir cada servidor.
 */

// --------------------------------------------------------------------------
// Referências lidas
// --------------------------------------------------------------------------

export interface LoadoutRefs {
  readonly skillRefs: LoadoutSkillRef[];
  readonly toolRefs: LoadoutToolRef[];
  readonly mcpServerRefs: LoadoutMcpServerRef[];
  /** Forma curta: os nomes, na ordem. */
  readonly skills: string[];
  readonly tools: string[];
  readonly mcpServers: McpServerRef[];
}

/** As referências como a escrita as recebe, já validadas contra o registro. */
export interface ResolvedReferences {
  readonly skillRefs: { readonly skillId: string; readonly pinnedVersion: number | null }[];
  readonly toolIds: string[];
  readonly mcpServerIds: string[];
}

const EMPTY_REFS: ResolvedReferences = { skillRefs: [], toolIds: [], mcpServerIds: [] };

export function toLoadout(row: LoadoutRow, refs: LoadoutRefs): Loadout {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agentId,
    harnessId: row.harnessId,
    modelId: row.modelId,
    executionProfileId: row.executionProfileId,
    skillRefs: refs.skillRefs,
    toolRefs: refs.toolRefs,
    mcpServerRefs: refs.mcpServerRefs,
    skills: refs.skills,
    tools: refs.tools,
    mcpServers: refs.mcpServers,
    knowledgePolicy: row.knowledgePolicy,
    contextPolicy: row.contextPolicy,
    version: row.version,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toLoadoutVersion(row: LoadoutVersionRow): LoadoutVersion {
  return {
    id: row.id,
    loadoutId: row.loadoutId,
    version: row.version,
    definition: row.definition,
    createdAt: row.createdAt.toISOString(),
  };
}

export const DEFAULT_KNOWLEDGE_POLICY: KnowledgePolicy = {
  includeProjectSummary: true,
  includeDecisions: true,
  maxItems: 20,
};

export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  includeParentContext: true,
  includeDependencyContext: true,
  maxTokens: 0,
};

interface JoinedSkill {
  readonly loadoutId: string;
  readonly position: number;
  readonly pinnedVersion: number | null;
  readonly skill: SkillRow;
}

interface JoinedTool {
  readonly loadoutId: string;
  readonly position: number;
  readonly tool: ToolRow;
}

interface JoinedMcpServer {
  readonly loadoutId: string;
  readonly position: number;
  readonly server: McpServerRow;
}

/**
 * As referências de vários Loadouts em três consultas, e não em três por
 * Loadout: a listagem da tela de Equipamentos lê todos de uma vez.
 */
export async function loadLoadoutRefsMany(
  db: DatabaseExecutor,
  input: { userId: string; loadoutIds: readonly string[] },
): Promise<Map<string, LoadoutRefs>> {
  const result = new Map<string, LoadoutRefs>();
  for (const id of input.loadoutIds) {
    result.set(id, {
      skillRefs: [],
      toolRefs: [],
      mcpServerRefs: [],
      skills: [],
      tools: [],
      mcpServers: [],
    });
  }
  if (input.loadoutIds.length === 0) return result;

  const ids = [...input.loadoutIds];

  const skillRows: JoinedSkill[] = await db
    .select({
      loadoutId: loadoutSkills.loadoutId,
      position: loadoutSkills.position,
      pinnedVersion: loadoutSkills.pinnedVersion,
      skill: skills,
    })
    .from(loadoutSkills)
    .innerJoin(skills, eq(skills.id, loadoutSkills.skillId))
    .where(and(eq(loadoutSkills.userId, input.userId), inArray(loadoutSkills.loadoutId, ids)))
    .orderBy(asc(loadoutSkills.loadoutId), asc(loadoutSkills.position));

  for (const row of skillRows) {
    const refs = result.get(row.loadoutId);
    if (refs === undefined) continue;
    refs.skillRefs.push({
      skillId: row.skill.id,
      name: row.skill.name,
      pinnedVersion: row.pinnedVersion,
      latestVersion: row.skill.latestVersion,
    });
    refs.skills.push(row.skill.name);
  }

  const toolRows: JoinedTool[] = await db
    .select({ loadoutId: loadoutTools.loadoutId, position: loadoutTools.position, tool: tools })
    .from(loadoutTools)
    .innerJoin(tools, eq(tools.id, loadoutTools.toolId))
    .where(and(eq(loadoutTools.userId, input.userId), inArray(loadoutTools.loadoutId, ids)))
    .orderBy(asc(loadoutTools.loadoutId), asc(loadoutTools.position));

  for (const row of toolRows) {
    const refs = result.get(row.loadoutId);
    if (refs === undefined) continue;
    refs.toolRefs.push({ toolId: row.tool.id, name: row.tool.name, kind: row.tool.kind });
    refs.tools.push(row.tool.name);
  }

  const serverRows: JoinedMcpServer[] = await db
    .select({
      loadoutId: loadoutMcpServers.loadoutId,
      position: loadoutMcpServers.position,
      server: mcpServers,
    })
    .from(loadoutMcpServers)
    .innerJoin(mcpServers, eq(mcpServers.id, loadoutMcpServers.mcpServerId))
    .where(
      and(eq(loadoutMcpServers.userId, input.userId), inArray(loadoutMcpServers.loadoutId, ids)),
    )
    .orderBy(asc(loadoutMcpServers.loadoutId), asc(loadoutMcpServers.position));

  for (const row of serverRows) {
    const refs = result.get(row.loadoutId);
    if (refs === undefined) continue;
    refs.mcpServerRefs.push({
      mcpServerId: row.server.id,
      name: row.server.name,
      transport: row.server.transport,
      builtIn: row.server.builtIn,
    });
    refs.mcpServers.push(toMcpServerRef(row.server));
  }

  return result;
}

export async function loadLoadoutRefs(
  db: DatabaseExecutor,
  input: { userId: string; loadoutId: string },
): Promise<LoadoutRefs> {
  const many = await loadLoadoutRefsMany(db, {
    userId: input.userId,
    loadoutIds: [input.loadoutId],
  });
  const refs = many.get(input.loadoutId);
  if (refs === undefined) throw new Error("loadLoadoutRefsMany não devolveu o Loadout pedido.");
  return refs;
}

/** As referências lidas, na forma que a escrita e a versão usam. */
export function resolvedReferencesOf(refs: LoadoutRefs): ResolvedReferences {
  return {
    skillRefs: refs.skillRefs.map((ref) => ({
      skillId: ref.skillId,
      pinnedVersion: ref.pinnedVersion,
    })),
    toolIds: refs.toolRefs.map((ref) => ref.toolId),
    mcpServerIds: refs.mcpServerRefs.map((ref) => ref.mcpServerId),
  };
}

export function toLoadoutDefinition(row: LoadoutRow, refs: ResolvedReferences): LoadoutDefinition {
  return {
    name: row.name,
    agentId: row.agentId,
    harnessId: row.harnessId,
    modelId: row.modelId,
    executionProfileId: row.executionProfileId,
    skillRefs: refs.skillRefs.map((ref) => ({
      skillId: ref.skillId,
      pinnedVersion: ref.pinnedVersion,
    })),
    toolIds: [...refs.toolIds],
    mcpServerIds: [...refs.mcpServerIds],
    knowledgePolicy: row.knowledgePolicy,
    contextPolicy: row.contextPolicy,
    isDefault: row.isDefault,
  };
}

export async function findLoadoutRow(
  db: DatabaseExecutor,
  input: { userId: string; loadoutId: string },
): Promise<LoadoutRow | null> {
  const [row] = await db
    .select()
    .from(loadouts)
    .where(and(eq(loadouts.id, input.loadoutId), eq(loadouts.userId, input.userId)));

  return row ?? null;
}

export async function getLoadout(
  db: DatabaseExecutor,
  input: { userId: string; loadoutId: string },
): Promise<Loadout | null> {
  const row = await findLoadoutRow(db, input);
  if (row === null) return null;
  return toLoadout(row, await loadLoadoutRefs(db, input));
}

export async function listLoadouts(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<Loadout[]> {
  const rows = await db
    .select()
    .from(loadouts)
    .where(eq(loadouts.userId, input.userId))
    .orderBy(asc(loadouts.name), asc(loadouts.id));

  const refs = await loadLoadoutRefsMany(db, {
    userId: input.userId,
    loadoutIds: rows.map((row) => row.id),
  });

  return rows.map((row) => {
    const own = refs.get(row.id);
    if (own === undefined) throw new Error("loadLoadoutRefsMany não devolveu um Loadout listado.");
    return toLoadout(row, own);
  });
}

// --------------------------------------------------------------------------
// Snapshot
// --------------------------------------------------------------------------

/**
 * Monta o snapshot congelado, com tudo resolvido.
 *
 * Agent, Harness e Model já vinham resolvidos desde a Fase 2; desde a Fase 8A
 * as Skills vêm com o conteúdo da **versão efetiva** (a pinada, ou a mais
 * recente neste instante), as Tools com a definição e os servidores MCP com a
 * forma de subi-los. Um Run precisa continuar legível — e reproduzível —
 * depois de alguém publicar uma versão nova da Skill ou apagar o Loadout
 * (documento técnico, seção 13).
 */
export async function buildLoadoutSnapshot(
  db: DatabaseExecutor,
  input: {
    loadout: LoadoutRow;
    agent: AgentRow;
    harness: HarnessRow;
    capturedAt?: Date;
  },
): Promise<LoadoutSnapshot> {
  const { loadout, agent, harness } = input;
  const capturedAt = input.capturedAt ?? new Date();

  // O Model do Loadout, ou o padrão do Harness quando o Loadout não indica um.
  const [model] =
    loadout.modelId === null
      ? await db
          .select()
          .from(models)
          .where(and(eq(models.harnessId, harness.id), eq(models.isDefault, true)))
          .limit(1)
      : await db.select().from(models).where(eq(models.id, loadout.modelId)).limit(1);

  const refs = await loadLoadoutRefs(db, { userId: loadout.userId, loadoutId: loadout.id });

  const skillVersionsSnapshot: SkillVersionSnapshot[] = [];
  for (const ref of refs.skillRefs) {
    const version = effectiveSkillVersion(ref);
    const [row] = await db
      .select({ content: skillVersions.content })
      .from(skillVersions)
      .where(and(eq(skillVersions.skillId, ref.skillId), eq(skillVersions.version, version)));
    if (row === undefined) {
      // O pin é validado na escrita e a junção é `restrict`: chegar aqui é defeito.
      throw new Error(
        `A Skill ${ref.skillId} do Loadout ${loadout.id} não tem a versão ${String(version)}.`,
      );
    }
    skillVersionsSnapshot.push({
      skillId: ref.skillId,
      name: ref.name,
      version,
      pinned: ref.pinnedVersion !== null,
      content: row.content,
    });
  }

  const toolRows =
    refs.toolRefs.length === 0
      ? []
      : await db
          .select({ tool: tools, serverName: mcpServers.name })
          .from(tools)
          .leftJoin(mcpServers, eq(mcpServers.id, tools.mcpServerId))
          .where(
            inArray(
              tools.id,
              refs.toolRefs.map((ref) => ref.toolId),
            ),
          );
  const toolById = new Map(toolRows.map((row) => [row.tool.id, row]));
  const toolDefinitions: ToolSnapshot[] = refs.toolRefs.map((ref) => {
    const row = toolById.get(ref.toolId);
    if (row === undefined) {
      throw new Error(`A Tool ${ref.toolId} do Loadout ${loadout.id} sumiu.`);
    }
    return {
      toolId: row.tool.id,
      name: row.tool.name,
      kind: row.tool.kind,
      command: row.tool.command,
      mcpServerName: row.serverName,
      toolName: row.tool.toolName,
    };
  });

  const serverRows =
    refs.mcpServerRefs.length === 0
      ? []
      : await db
          .select()
          .from(mcpServers)
          .where(
            inArray(
              mcpServers.id,
              refs.mcpServerRefs.map((ref) => ref.mcpServerId),
            ),
          );
  const serverById = new Map(serverRows.map((row) => [row.id, row]));
  const mcpServersSnapshot: McpServerSnapshot[] = refs.mcpServerRefs.map((ref) => {
    const row = serverById.get(ref.mcpServerId);
    if (row === undefined) {
      throw new Error(`O servidor MCP ${ref.mcpServerId} do Loadout ${loadout.id} sumiu.`);
    }
    return {
      name: row.name,
      transport: row.transport,
      target: mcpServerTarget(row),
      mcpServerId: row.id,
      command: row.command,
      args: [...row.args],
      url: row.url,
      envKeys: [...row.envKeys],
      readOnly: row.readOnly,
      builtIn: row.builtIn,
    };
  });

  return {
    loadoutId: loadout.id,
    name: loadout.name,
    version: loadout.version,
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      instructions: agent.instructions,
    },
    harness: {
      id: harness.id,
      key: harness.key,
      name: harness.name,
      capabilities: harness.capabilities,
    },
    model: model === undefined ? null : { id: model.id, key: model.key, name: model.name },
    executionProfileId: loadout.executionProfileId,
    skills: refs.skills,
    tools: refs.tools,
    mcpServers: mcpServersSnapshot,
    skillVersions: skillVersionsSnapshot,
    toolDefinitions,
    knowledgePolicy: loadout.knowledgePolicy,
    contextPolicy: loadout.contextPolicy,
    capturedAt: capturedAt.toISOString(),
  };
}

// --------------------------------------------------------------------------
// Escrita
// --------------------------------------------------------------------------

async function nameTaken(
  db: DatabaseExecutor,
  input: { userId: string; name: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: loadouts.id })
    .from(loadouts)
    .where(and(eq(loadouts.userId, input.userId), eq(loadouts.name, input.name)));

  return row !== undefined;
}

async function clearOtherDefaults(
  db: DatabaseExecutor,
  input: { userId: string; keepId: string },
): Promise<void> {
  await db
    .update(loadouts)
    .set({ isDefault: false })
    .where(and(eq(loadouts.userId, input.userId), ne(loadouts.id, input.keepId)));
}

/**
 * Confere as quatro referências de um Loadout.
 *
 * Feita aqui, e não deixada para a chave estrangeira, porque um erro de
 * constraint vira `500` e não diz **qual** das quatro referências faltou.
 */
async function checkReferences(
  db: DatabaseExecutor,
  input: {
    userId: string;
    agentId: string;
    harnessId: string;
    modelId: string | null;
    executionProfileId: string;
  },
): Promise<RegistryWriteFailure | null> {
  const agent = await findAgentRow(db, { userId: input.userId, agentId: input.agentId });
  if (agent === null) return { code: "AGENT_NOT_FOUND", agentId: input.agentId };

  const harness = await findHarnessRow(db, { userId: input.userId, harnessId: input.harnessId });
  if (harness === null) return { code: "HARNESS_NOT_FOUND", harnessId: input.harnessId };
  if (!harness.enabled) return { code: "HARNESS_DISABLED", harnessId: input.harnessId };

  if (input.modelId !== null) {
    const model = await findModelRow(db, { userId: input.userId, modelId: input.modelId });
    if (model === null) return { code: "MODEL_NOT_FOUND", modelId: input.modelId };
    if (model.harnessId !== input.harnessId) {
      return {
        code: "MODEL_IN_OTHER_HARNESS",
        modelId: input.modelId,
        harnessId: input.harnessId,
      };
    }
  }

  const profile = await findExecutionProfileRow(db, {
    userId: input.userId,
    executionProfileId: input.executionProfileId,
  });
  if (profile === null) {
    return { code: "EXECUTION_PROFILE_NOT_FOUND", executionProfileId: input.executionProfileId };
  }
  if (!profile.enabled) {
    return { code: "EXECUTION_PROFILE_DISABLED", executionProfileId: input.executionProfileId };
  }

  return null;
}

/**
 * As duas formas de escrever as referências, como o contrato as recebe.
 *
 * A forma por id é a da Fase 8. A forma curta (`skills`, `tools`, `mcpServers`)
 * é a do formulário da Fase 7, resolvida pelo nome: o que não existe é criado
 * — Skill com conteúdo vazio na versão 1, Tool como `COMMAND`, servidor a
 * partir do `target` —, exatamente como a migração `0015` fez com o que já
 * estava gravado. As duas formas na mesma coleção são recusadas.
 */
export interface ReferenceInput {
  skillRefs?: readonly { skillId: string; pinnedVersion?: number | null }[];
  toolIds?: readonly string[];
  mcpServerIds?: readonly string[];
  skills?: readonly string[];
  tools?: readonly string[];
  mcpServers?: readonly McpServerRef[];
}

function unique<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(item);
  }
  return result;
}

async function registryChanged(
  db: DatabaseExecutor,
  input: { userId: string; kind: "skill" | "tool" | "mcp_server"; id: string },
): Promise<void> {
  await appendDashboardEvent(db, {
    userId: input.userId,
    type: "registry.changed",
    payload: { kind: input.kind, id: input.id, action: "created" },
  });
}

/**
 * Resolve as referências de um corpo contra o registro.
 *
 * `current` é o que o Loadout tem hoje, para o PATCH que não menciona uma
 * coleção mantê-la; na criação é vazio.
 */
export async function resolveReferenceInput(
  db: DatabaseExecutor,
  input: { userId: string; refs: ReferenceInput; current?: ResolvedReferences },
): Promise<Result<ResolvedReferences, RegistryWriteFailure>> {
  const { userId, refs } = input;
  const current = input.current ?? EMPTY_REFS;

  // ------------------------------------------------------------- Skills
  let skillRefs: ResolvedReferences["skillRefs"];
  if (refs.skillRefs !== undefined && refs.skills !== undefined) {
    return failed<RegistryWriteFailure>({ code: "REFERENCE_FORMS_MIXED", collection: "skills" });
  } else if (refs.skillRefs !== undefined) {
    skillRefs = [];
    for (const ref of unique(refs.skillRefs, (item) => item.skillId)) {
      const skill = await findSkillRow(db, { userId, skillId: ref.skillId });
      if (skill === null) {
        return failed<RegistryWriteFailure>({ code: "SKILL_NOT_FOUND", skillId: ref.skillId });
      }
      const pinnedVersion = ref.pinnedVersion ?? null;
      if (pinnedVersion !== null && !isValidSkillPin(pinnedVersion, skill.latestVersion)) {
        return failed<RegistryWriteFailure>({
          code: "SKILL_VERSION_NOT_FOUND",
          skillId: skill.id,
          version: pinnedVersion,
          latestVersion: skill.latestVersion,
        });
      }
      skillRefs.push({ skillId: skill.id, pinnedVersion });
    }
  } else if (refs.skills !== undefined) {
    skillRefs = [];
    const nomes = unique(
      refs.skills.map((name) => name.trim()).filter((name) => name.length > 0),
      (name) => name,
    );
    for (const name of nomes) {
      const [existing] = await db
        .select()
        .from(skills)
        .where(and(eq(skills.userId, userId), eq(skills.name, name)));
      if (existing !== undefined) {
        skillRefs.push({ skillId: existing.id, pinnedVersion: null });
        continue;
      }
      const { skill } = await insertSkillWithFirstVersion(db, {
        userId,
        name,
        description:
          "Criada pela forma curta do Loadout, só com o nome. Publique uma versão com conteúdo.",
        content: "",
        changelog: "Versão inicial, vazia: o Loadout só trouxe o nome.",
      });
      await registryChanged(db, { userId, kind: "skill", id: skill.id });
      skillRefs.push({ skillId: skill.id, pinnedVersion: null });
    }
  } else {
    skillRefs = [...current.skillRefs];
  }

  // -------------------------------------------------------------- Tools
  let toolIds: string[];
  if (refs.toolIds !== undefined && refs.tools !== undefined) {
    return failed<RegistryWriteFailure>({ code: "REFERENCE_FORMS_MIXED", collection: "tools" });
  } else if (refs.toolIds !== undefined) {
    toolIds = [];
    for (const toolId of unique(refs.toolIds, (id) => id)) {
      const tool = await findToolRow(db, { userId, toolId });
      if (tool === null) return failed<RegistryWriteFailure>({ code: "TOOL_NOT_FOUND", toolId });
      toolIds.push(tool.id);
    }
  } else if (refs.tools !== undefined) {
    toolIds = [];
    const nomes = unique(
      refs.tools.map((name) => name.trim()).filter((name) => name.length > 0),
      (name) => name,
    );
    for (const name of nomes) {
      const existing = await findToolRowByName(db, { userId, name });
      if (existing !== null) {
        toolIds.push(existing.id);
        continue;
      }
      const tool = await insertToolRow(db, {
        userId,
        name,
        kind: "COMMAND",
        command: name,
        description: "Criada pela forma curta do Loadout: o nome vale como comando liberado.",
      });
      await registryChanged(db, { userId, kind: "tool", id: tool.id });
      toolIds.push(tool.id);
    }
  } else {
    toolIds = [...current.toolIds];
  }

  // ------------------------------------------------------- Servidores MCP
  let mcpServerIds: string[];
  if (refs.mcpServerIds !== undefined && refs.mcpServers !== undefined) {
    return failed<RegistryWriteFailure>({
      code: "REFERENCE_FORMS_MIXED",
      collection: "mcpServers",
    });
  } else if (refs.mcpServerIds !== undefined) {
    mcpServerIds = [];
    for (const mcpServerId of unique(refs.mcpServerIds, (id) => id)) {
      const server = await findMcpServerRow(db, { userId, mcpServerId });
      if (server === null) {
        return failed<RegistryWriteFailure>({ code: "MCP_SERVER_NOT_FOUND", mcpServerId });
      }
      mcpServerIds.push(server.id);
    }
  } else if (refs.mcpServers !== undefined) {
    mcpServerIds = [];
    for (const ref of unique(refs.mcpServers, (item) => item.name.trim())) {
      const name = ref.name.trim();
      const target = ref.target.trim();
      const existing = await findMcpServerRowByName(db, { userId, name });
      if (existing !== null) {
        // O mesmo nome com outra definição não é "editar": é ambiguidade, e o
        // registro é quem manda. Editar é assunto de `PATCH /mcp-servers/{id}`.
        if (existing.transport !== ref.transport || mcpServerTarget(existing) !== target) {
          return failed<RegistryWriteFailure>({
            code: "MCP_SERVER_DEFINITION_MISMATCH",
            name,
            mcpServerId: existing.id,
          });
        }
        mcpServerIds.push(existing.id);
        continue;
      }
      const description = "Criado pela forma curta do Loadout, a partir do servidor inline.";
      const server =
        ref.transport === "HTTP"
          ? await insertMcpServerRow(db, {
              userId,
              name,
              transport: "HTTP",
              url: target,
              description,
            })
          : await insertMcpServerRow(db, {
              userId,
              name,
              transport: "STDIO",
              ...splitStdioTarget(target),
              description,
            });
      await registryChanged(db, { userId, kind: "mcp_server", id: server.id });
      mcpServerIds.push(server.id);
    }
  } else {
    mcpServerIds = [...current.mcpServerIds];
  }

  return ok({ skillRefs, toolIds, mcpServerIds });
}

/** Reescreve as três junções do Loadout com as referências dadas, na ordem. */
async function writeLoadoutRefs(
  db: DatabaseExecutor,
  input: { userId: string; loadoutId: string; refs: ResolvedReferences },
): Promise<void> {
  const { userId, loadoutId, refs } = input;

  await db.delete(loadoutSkills).where(eq(loadoutSkills.loadoutId, loadoutId));
  await db.delete(loadoutTools).where(eq(loadoutTools.loadoutId, loadoutId));
  await db.delete(loadoutMcpServers).where(eq(loadoutMcpServers.loadoutId, loadoutId));

  if (refs.skillRefs.length > 0) {
    await db.insert(loadoutSkills).values(
      refs.skillRefs.map((ref, position) => ({
        userId,
        loadoutId,
        skillId: ref.skillId,
        pinnedVersion: ref.pinnedVersion,
        position,
      })),
    );
  }
  if (refs.toolIds.length > 0) {
    await db
      .insert(loadoutTools)
      .values(refs.toolIds.map((toolId, position) => ({ userId, loadoutId, toolId, position })));
  }
  if (refs.mcpServerIds.length > 0) {
    await db.insert(loadoutMcpServers).values(
      refs.mcpServerIds.map((mcpServerId, position) => ({
        userId,
        loadoutId,
        mcpServerId,
        position,
      })),
    );
  }
}

async function insertLoadoutVersion(
  db: DatabaseExecutor,
  input: { userId: string; loadout: LoadoutRow; refs: ResolvedReferences },
): Promise<LoadoutVersionRow> {
  const [row] = await db
    .insert(loadoutVersions)
    .values({
      id: newId(),
      userId: input.userId,
      loadoutId: input.loadout.id,
      version: input.loadout.version,
      definition: toLoadoutDefinition(input.loadout, input.refs),
    })
    .returning();

  if (row === undefined) throw new Error("A inserção em loadout_version não devolveu linha.");
  return row;
}

export interface InsertLoadoutRecordInput {
  userId: string;
  name: string;
  agentId: string;
  harnessId: string;
  modelId: string | null;
  executionProfileId: string;
  refs: ResolvedReferences;
  knowledgePolicy: KnowledgePolicy;
  contextPolicy: ContextPolicy;
  isDefault: boolean;
}

/**
 * Insere o Loadout na versão 1, com as referências e a linha de versão, sem
 * evento e sem checar nada: quem chama já checou. É a peça que `createLoadout`
 * e o `db:seed` compartilham.
 */
export async function insertLoadoutRecord(
  db: DatabaseExecutor,
  input: InsertLoadoutRecordInput,
): Promise<LoadoutRow> {
  const [row] = await db
    .insert(loadouts)
    .values({
      id: newId(),
      userId: input.userId,
      name: input.name,
      agentId: input.agentId,
      harnessId: input.harnessId,
      modelId: input.modelId,
      executionProfileId: input.executionProfileId,
      knowledgePolicy: input.knowledgePolicy,
      contextPolicy: input.contextPolicy,
      version: 1,
      isDefault: input.isDefault,
    })
    .returning();

  if (row === undefined) throw new Error("A inserção em loadout não devolveu linha.");

  await writeLoadoutRefs(db, { userId: input.userId, loadoutId: row.id, refs: input.refs });
  await insertLoadoutVersion(db, { userId: input.userId, loadout: row, refs: input.refs });

  return row;
}

export interface CreateLoadoutInput extends ReferenceInput {
  userId: string;
  name: string;
  agentId: string;
  harnessId: string;
  modelId?: string | null;
  executionProfileId: string;
  knowledgePolicy?: KnowledgePolicy;
  contextPolicy?: ContextPolicy;
  isDefault?: boolean;
}

export async function createLoadout(
  db: Database,
  input: CreateLoadoutInput,
): Promise<Result<Loadout, RegistryWriteFailure>> {
  return await db.transaction(async (tx) => {
    if (await nameTaken(tx, input)) {
      return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: input.name });
    }

    const modelId = input.modelId ?? null;
    const referencia = await checkReferences(tx, { ...input, modelId });
    if (referencia !== null) return failed(referencia);

    const resolved = await resolveReferenceInput(tx, { userId: input.userId, refs: input });
    if (!resolved.ok) return resolved;

    const row = await insertLoadoutRecord(tx, {
      userId: input.userId,
      name: input.name,
      agentId: input.agentId,
      harnessId: input.harnessId,
      modelId,
      executionProfileId: input.executionProfileId,
      refs: resolved.value,
      knowledgePolicy: input.knowledgePolicy ?? DEFAULT_KNOWLEDGE_POLICY,
      contextPolicy: input.contextPolicy ?? DEFAULT_CONTEXT_POLICY,
      isDefault: input.isDefault ?? false,
    });

    if (row.isDefault) {
      await clearOtherDefaults(tx, { userId: input.userId, keepId: row.id });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "loadout.created",
      payload: { loadoutId: row.id, name: row.name, version: row.version },
    });

    return ok(
      toLoadout(row, await loadLoadoutRefs(tx, { userId: input.userId, loadoutId: row.id })),
    );
  });
}

export interface UpdateLoadoutPatch extends ReferenceInput {
  name?: string;
  agentId?: string;
  harnessId?: string;
  modelId?: string | null;
  executionProfileId?: string;
  knowledgePolicy?: KnowledgePolicy;
  contextPolicy?: ContextPolicy;
  isDefault?: boolean;
}

interface ApplyLoadoutChangeInput {
  userId: string;
  current: LoadoutRow;
  patch: UpdateLoadoutPatch;
  /** O que o evento `loadout.updated` leva além de `changed`. */
  eventExtra?: Record<string, unknown>;
}

/**
 * O núcleo de `updateLoadout` e de `restoreLoadoutVersion`.
 *
 * Confere, resolve as referências, compara com o que está gravado e, se algo
 * mudou, sobe `version`, reescreve as junções e grava a linha de
 * `loadout_version` — tudo na transação de quem chamou. Nada mudou é
 * devolver o atual sem tocar em nada: a versão conta edições.
 */
async function applyLoadoutChange(
  tx: DatabaseExecutor,
  input: ApplyLoadoutChangeInput,
): Promise<Result<Loadout, RegistryWriteFailure>> {
  const { userId, current, patch } = input;

  if (patch.name !== undefined && patch.name !== current.name) {
    if (await nameTaken(tx, { userId, name: patch.name })) {
      return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: patch.name });
    }
  }

  const alvo = {
    agentId: patch.agentId ?? current.agentId,
    harnessId: patch.harnessId ?? current.harnessId,
    modelId: patch.modelId === undefined ? current.modelId : patch.modelId,
    executionProfileId: patch.executionProfileId ?? current.executionProfileId,
  };

  const referencia = await checkReferences(tx, { userId, ...alvo });
  if (referencia !== null) return failed(referencia);

  const currentRefs = await loadLoadoutRefs(tx, { userId, loadoutId: current.id });
  const currentResolved = resolvedReferencesOf(currentRefs);

  const resolved = await resolveReferenceInput(tx, {
    userId,
    refs: patch,
    current: currentResolved,
  });
  if (!resolved.ok) return resolved;

  const mudou = <T>(atual: T, novo: T | undefined): boolean =>
    novo !== undefined && JSON.stringify(atual) !== JSON.stringify(novo);

  const changed: string[] = [];
  const values: {
    name?: string;
    agentId?: string;
    harnessId?: string;
    modelId?: string | null;
    executionProfileId?: string;
    knowledgePolicy?: KnowledgePolicy;
    contextPolicy?: ContextPolicy;
    isDefault?: boolean;
  } = {};

  if (mudou(current.name, patch.name)) {
    values.name = patch.name;
    changed.push("name");
  }
  if (current.agentId !== alvo.agentId) {
    values.agentId = alvo.agentId;
    changed.push("agentId");
  }
  if (current.harnessId !== alvo.harnessId) {
    values.harnessId = alvo.harnessId;
    changed.push("harnessId");
  }
  if (current.modelId !== alvo.modelId) {
    values.modelId = alvo.modelId;
    changed.push("modelId");
  }
  if (current.executionProfileId !== alvo.executionProfileId) {
    values.executionProfileId = alvo.executionProfileId;
    changed.push("executionProfileId");
  }
  if (mudou(currentResolved.skillRefs, resolved.value.skillRefs)) changed.push("skillRefs");
  if (mudou(currentResolved.toolIds, resolved.value.toolIds)) changed.push("toolIds");
  if (mudou(currentResolved.mcpServerIds, resolved.value.mcpServerIds))
    changed.push("mcpServerIds");
  if (mudou(current.knowledgePolicy, patch.knowledgePolicy)) {
    values.knowledgePolicy = patch.knowledgePolicy;
    changed.push("knowledgePolicy");
  }
  if (mudou(current.contextPolicy, patch.contextPolicy)) {
    values.contextPolicy = patch.contextPolicy;
    changed.push("contextPolicy");
  }
  if (mudou(current.isDefault, patch.isDefault)) {
    values.isDefault = patch.isDefault;
    changed.push("isDefault");
  }

  if (changed.length === 0) return ok(toLoadout(current, currentRefs));

  const [row] = await tx
    .update(loadouts)
    .set({ ...values, version: sql`${loadouts.version} + 1` })
    .where(and(eq(loadouts.id, current.id), eq(loadouts.userId, userId)))
    .returning();

  if (row === undefined) throw new Error("A atualização de loadout não devolveu linha.");

  await writeLoadoutRefs(tx, { userId, loadoutId: row.id, refs: resolved.value });
  await insertLoadoutVersion(tx, { userId, loadout: row, refs: resolved.value });

  if (row.isDefault) {
    await clearOtherDefaults(tx, { userId, keepId: row.id });
  }

  await appendDashboardEvent(tx, {
    userId,
    type: "loadout.updated",
    payload: { loadoutId: row.id, version: row.version, changed, ...(input.eventExtra ?? {}) },
  });

  return ok(toLoadout(row, await loadLoadoutRefs(tx, { userId, loadoutId: row.id })));
}

/**
 * Edita o Loadout e **incrementa `version`** quando algo muda de fato.
 *
 * Um PATCH que não muda nada não sobe a versão, pelo mesmo motivo pelo qual não
 * grava linha no diário: a versão conta edições, e "alguém enviou os mesmos
 * valores" não é uma edição. Sem isso, um Run de amanhã diria que usou a versão
 * 7 de um equipamento idêntico ao da versão 3.
 *
 * `isDefault` sozinho **também** sobe a versão: é um campo do Loadout como
 * qualquer outro, e tratá-lo como metadado criaria uma segunda regra sobre o
 * que conta como edição.
 */
export async function updateLoadout(
  db: Database,
  input: { userId: string; loadoutId: string; patch: UpdateLoadoutPatch },
): Promise<Result<Loadout, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findLoadoutRow(tx, input);
    if (current === null) return null;

    return await applyLoadoutChange(tx, { userId: input.userId, current, patch: input.patch });
  });
}

/**
 * Apaga o Loadout.
 *
 * Recusa enquanto algum Run o referencia. O Run guarda o snapshot inteiro, mas
 * `loadout_id` continua sendo o fio que liga a execução ao equipamento que hoje
 * existe — e apagar o Loadout cortaria esse fio no histórico. Quem quer o
 * cadastro limpo pode apagar os Runs antigos da Task primeiro.
 */
export async function deleteLoadout(
  db: Database,
  input: { userId: string; loadoutId: string },
): Promise<Result<null, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findLoadoutRow(tx, input);
    if (current === null) return null;

    const emUso = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.userId, input.userId), eq(runs.loadoutId, input.loadoutId)))
      .limit(IN_USE_SAMPLE_LIMIT);

    if (emUso.length > 0) {
      return failed<RegistryWriteFailure>({
        code: "IN_USE_BY_RUN",
        runIds: emUso.map((row) => row.id),
      });
    }

    await tx
      .delete(loadouts)
      .where(and(eq(loadouts.id, input.loadoutId), eq(loadouts.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "loadout.deleted",
      payload: { loadoutId: input.loadoutId, name: current.name },
    });

    return ok(null);
  });
}

// --------------------------------------------------------------------------
// Versões
// --------------------------------------------------------------------------

export interface ListLoadoutVersionsInput extends PageInput {
  userId: string;
  loadoutId: string;
}

export async function listLoadoutVersions(
  db: DatabaseExecutor,
  input: ListLoadoutVersionsInput,
): Promise<PageResult<LoadoutVersion>> {
  const where = and(
    eq(loadoutVersions.userId, input.userId),
    eq(loadoutVersions.loadoutId, input.loadoutId),
  );

  const rows = await db
    .select()
    .from(loadoutVersions)
    .where(where)
    .orderBy(desc(loadoutVersions.version))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(loadoutVersions).where(where);

  return { items: rows.map(toLoadoutVersion), total: counted?.total ?? 0 };
}

export async function findLoadoutVersionRow(
  db: DatabaseExecutor,
  input: { userId: string; loadoutId: string; version: number },
): Promise<LoadoutVersionRow | null> {
  const [row] = await db
    .select()
    .from(loadoutVersions)
    .where(
      and(
        eq(loadoutVersions.userId, input.userId),
        eq(loadoutVersions.loadoutId, input.loadoutId),
        eq(loadoutVersions.version, input.version),
      ),
    );

  return row ?? null;
}

/**
 * Restaura uma versão: cria uma versão **nova** com a definição da antiga.
 *
 * Nunca reescreve: a versão N continua existindo e o Loadout passa a estar em
 * `max + 1`, igual à N. Se a definição de N for idêntica à atual, não há
 * edição e nada é gravado — restaurar o que já está lá não é uma mudança.
 * As referências são conferidas de novo: uma Skill apagada desde então torna
 * a versão irrestaurável, e a API diz qual.
 */
export async function restoreLoadoutVersion(
  db: Database,
  input: { userId: string; loadoutId: string; version: number },
): Promise<Result<Loadout, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findLoadoutRow(tx, input);
    if (current === null) return null;

    const antiga = await findLoadoutVersionRow(tx, input);
    if (antiga === null) {
      return failed<RegistryWriteFailure>({
        code: "LOADOUT_VERSION_NOT_FOUND",
        loadoutId: input.loadoutId,
        version: input.version,
      });
    }

    const definition = antiga.definition;

    return await applyLoadoutChange(tx, {
      userId: input.userId,
      current,
      patch: {
        name: definition.name,
        agentId: definition.agentId,
        harnessId: definition.harnessId,
        modelId: definition.modelId,
        executionProfileId: definition.executionProfileId,
        skillRefs: definition.skillRefs,
        toolIds: definition.toolIds,
        mcpServerIds: definition.mcpServerIds,
        knowledgePolicy: definition.knowledgePolicy,
        contextPolicy: definition.contextPolicy,
        isDefault: definition.isDefault,
      },
      eventExtra: { restoredFromVersion: antiga.version },
    });
  });
}
