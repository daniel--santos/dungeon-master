import type {
  ContextPolicy,
  KnowledgePolicy,
  Loadout,
  LoadoutSnapshot,
  McpServerRef,
} from "@dungeon-master/contracts";
import { and, asc, eq, ne, sql } from "drizzle-orm";

import { findAgentRow } from "./agent.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { findExecutionProfileRow } from "./execution-profile.js";
import { findHarnessRow, findModelRow } from "./harness.js";
import { newId } from "./ids.js";
import { IN_USE_SAMPLE_LIMIT, type RegistryWriteFailure } from "./registry.js";
import { failed, ok, type Result } from "./result.js";
import {
  type AgentRow,
  type HarnessRow,
  loadouts,
  type LoadoutRow,
  models,
} from "./schema/execution.js";
import { runs } from "./schema/run.js";

export function toLoadout(row: LoadoutRow): Loadout {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agentId,
    harnessId: row.harnessId,
    modelId: row.modelId,
    executionProfileId: row.executionProfileId,
    skills: row.skills,
    tools: row.tools,
    mcpServers: row.mcpServers,
    knowledgePolicy: row.knowledgePolicy,
    contextPolicy: row.contextPolicy,
    version: row.version,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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

export async function listLoadouts(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<Loadout[]> {
  const rows = await db
    .select()
    .from(loadouts)
    .where(eq(loadouts.userId, input.userId))
    .orderBy(asc(loadouts.name), asc(loadouts.id));

  return rows.map(toLoadout);
}

/**
 * Monta o snapshot congelado, com Agent, Harness e Model já resolvidos.
 *
 * Resolvidos, e não como ids: um Run precisa continuar legível depois de
 * alguém apagar o Agent, e as instruções do papel são exatamente o que foi
 * enviado ao harness naquele dia (documento técnico, seção 13).
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
    skills: loadout.skills,
    tools: loadout.tools,
    mcpServers: loadout.mcpServers,
    knowledgePolicy: loadout.knowledgePolicy,
    contextPolicy: loadout.contextPolicy,
    capturedAt: capturedAt.toISOString(),
  };
}

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

export interface CreateLoadoutInput {
  userId: string;
  name: string;
  agentId: string;
  harnessId: string;
  modelId?: string | null;
  executionProfileId: string;
  skills?: string[];
  tools?: string[];
  mcpServers?: McpServerRef[];
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

    const [row] = await tx
      .insert(loadouts)
      .values({
        id: newId(),
        userId: input.userId,
        name: input.name,
        agentId: input.agentId,
        harnessId: input.harnessId,
        modelId,
        executionProfileId: input.executionProfileId,
        skills: input.skills ?? [],
        tools: input.tools ?? [],
        mcpServers: input.mcpServers ?? [],
        knowledgePolicy: input.knowledgePolicy ?? DEFAULT_KNOWLEDGE_POLICY,
        contextPolicy: input.contextPolicy ?? DEFAULT_CONTEXT_POLICY,
        version: 1,
        isDefault: input.isDefault ?? false,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em loadout não devolveu linha.");

    if (row.isDefault) {
      await clearOtherDefaults(tx, { userId: input.userId, keepId: row.id });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "loadout.created",
      payload: { loadoutId: row.id, name: row.name, version: row.version },
    });

    return ok(toLoadout(row));
  });
}

export interface UpdateLoadoutPatch {
  name?: string;
  agentId?: string;
  harnessId?: string;
  modelId?: string | null;
  executionProfileId?: string;
  skills?: string[];
  tools?: string[];
  mcpServers?: McpServerRef[];
  knowledgePolicy?: KnowledgePolicy;
  contextPolicy?: ContextPolicy;
  isDefault?: boolean;
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

    const { patch } = input;

    if (patch.name !== undefined && patch.name !== current.name) {
      if (await nameTaken(tx, { userId: input.userId, name: patch.name })) {
        return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: patch.name });
      }
    }

    const alvo = {
      agentId: patch.agentId ?? current.agentId,
      harnessId: patch.harnessId ?? current.harnessId,
      modelId: patch.modelId === undefined ? current.modelId : patch.modelId,
      executionProfileId: patch.executionProfileId ?? current.executionProfileId,
    };

    const referencia = await checkReferences(tx, { userId: input.userId, ...alvo });
    if (referencia !== null) return failed(referencia);

    const mudou = <T>(atual: T, novo: T | undefined): boolean =>
      novo !== undefined && JSON.stringify(atual) !== JSON.stringify(novo);

    const changed: string[] = [];
    const values: UpdateLoadoutPatch = {};

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
    if (mudou(current.skills, patch.skills)) {
      values.skills = patch.skills;
      changed.push("skills");
    }
    if (mudou(current.tools, patch.tools)) {
      values.tools = patch.tools;
      changed.push("tools");
    }
    if (mudou(current.mcpServers, patch.mcpServers)) {
      values.mcpServers = patch.mcpServers;
      changed.push("mcpServers");
    }
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

    if (changed.length === 0) return ok(toLoadout(current));

    const [row] = await tx
      .update(loadouts)
      .set({ ...values, version: sql`${loadouts.version} + 1` })
      .where(and(eq(loadouts.id, input.loadoutId), eq(loadouts.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de loadout não devolveu linha.");

    if (row.isDefault) {
      await clearOtherDefaults(tx, { userId: input.userId, keepId: row.id });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "loadout.updated",
      payload: { loadoutId: row.id, version: row.version, changed },
    });

    return ok(toLoadout(row));
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
