import type { Agent, AgentRole } from "@dungeon-master/contracts";
import { and, asc, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { IN_USE_SAMPLE_LIMIT, type RegistryWriteFailure } from "./registry.js";
import { failed, ok, type Result } from "./result.js";
import { type AgentRow, agents, loadouts } from "./schema/execution.js";

export function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    instructions: row.instructions,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findAgentRow(
  db: DatabaseExecutor,
  input: { userId: string; agentId: string },
): Promise<AgentRow | null> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, input.agentId), eq(agents.userId, input.userId)));

  return row ?? null;
}

export async function listAgents(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<Agent[]> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.userId, input.userId))
    .orderBy(asc(agents.name), asc(agents.id));

  return rows.map(toAgent);
}

/**
 * O nome é a chave que o usuário enxerga, então a colisão precisa virar `409`
 * com o nome dentro, e não um erro de constraint que ninguém sabe ler.
 */
async function nameTaken(
  db: DatabaseExecutor,
  input: { userId: string; name: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.userId, input.userId), eq(agents.name, input.name)));

  return row !== undefined;
}

export interface CreateAgentInput {
  userId: string;
  name: string;
  role: AgentRole;
  instructions: string;
  description?: string | null;
}

export async function createAgent(
  db: Database,
  input: CreateAgentInput,
): Promise<Result<Agent, RegistryWriteFailure>> {
  return await db.transaction(async (tx) => {
    if (await nameTaken(tx, input)) {
      return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: input.name });
    }

    const [row] = await tx
      .insert(agents)
      .values({
        id: newId(),
        userId: input.userId,
        name: input.name,
        role: input.role,
        instructions: input.instructions,
        description: input.description ?? null,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em agent não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "agent.created",
      payload: { agentId: row.id, name: row.name, role: row.role },
    });

    return ok(toAgent(row));
  });
}

export interface UpdateAgentPatch {
  name?: string;
  role?: AgentRole;
  instructions?: string;
  description?: string | null;
}

export async function updateAgent(
  db: Database,
  input: { userId: string; agentId: string; patch: UpdateAgentPatch },
): Promise<Result<Agent, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findAgentRow(tx, input);
    if (current === null) return null;

    const { patch } = input;

    if (patch.name !== undefined && patch.name !== current.name) {
      if (await nameTaken(tx, { userId: input.userId, name: patch.name })) {
        return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: patch.name });
      }
    }

    const changed: string[] = [];
    const values: UpdateAgentPatch = {};

    if (patch.name !== undefined && patch.name !== current.name) {
      values.name = patch.name;
      changed.push("name");
    }
    if (patch.role !== undefined && patch.role !== current.role) {
      values.role = patch.role;
      changed.push("role");
    }
    if (patch.instructions !== undefined && patch.instructions !== current.instructions) {
      values.instructions = patch.instructions;
      changed.push("instructions");
    }
    if (patch.description !== undefined && patch.description !== current.description) {
      values.description = patch.description;
      changed.push("description");
    }

    if (changed.length === 0) return ok(toAgent(current));

    const [row] = await tx
      .update(agents)
      .set(values)
      .where(and(eq(agents.id, input.agentId), eq(agents.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de agent não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "agent.updated",
      payload: { agentId: row.id, changed },
    });

    return ok(toAgent(row));
  });
}

/**
 * Apaga o Agent.
 *
 * Recusa enquanto algum Loadout o usa: a referência é `on delete restrict`, e
 * a checagem aqui existe para o usuário receber um `409` com os ids dos
 * Loadouts em vez de um erro de chave estrangeira. Runs antigos não impedem
 * nada — o snapshot deles já carrega o Agent inteiro, e é por isso que ele
 * carrega.
 */
export async function deleteAgent(
  db: Database,
  input: { userId: string; agentId: string },
): Promise<Result<null, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findAgentRow(tx, input);
    if (current === null) return null;

    const emUso = await tx
      .select({ id: loadouts.id })
      .from(loadouts)
      .where(and(eq(loadouts.userId, input.userId), eq(loadouts.agentId, input.agentId)))
      .limit(IN_USE_SAMPLE_LIMIT);

    if (emUso.length > 0) {
      return failed<RegistryWriteFailure>({
        code: "IN_USE_BY_LOADOUT",
        loadoutIds: emUso.map((row) => row.id),
      });
    }

    await tx
      .delete(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "agent.deleted",
      payload: { agentId: input.agentId, name: current.name },
    });

    return ok(null);
  });
}
