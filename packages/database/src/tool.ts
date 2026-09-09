import type { Tool, ToolKind } from "@dungeon-master/contracts";
import { and, asc, count, eq, type SQL } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { findMcpServerRow } from "./mcp-server.js";
import { IN_USE_SAMPLE_LIMIT, type RegistryWriteFailure } from "./registry.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { loadoutTools } from "./schema/execution.js";
import { type ToolRow, tools } from "./schema/registry.js";

/**
 * Tool: comando liberado ou ferramenta de um servidor MCP (Fase 8A).
 *
 * A espécie (`kind`) não muda depois de criada: trocar é apagar e criar. Um
 * campo da outra espécie num PATCH é recusado com o nome do campo, e não
 * ignorado — ignorar deixaria o cliente achando que gravou.
 */

export function toTool(row: ToolRow): Tool {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    command: row.command,
    mcpServerId: row.mcpServerId,
    toolName: row.toolName,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findToolRow(
  db: DatabaseExecutor,
  input: { userId: string; toolId: string },
): Promise<ToolRow | null> {
  const [row] = await db
    .select()
    .from(tools)
    .where(and(eq(tools.id, input.toolId), eq(tools.userId, input.userId)));

  return row ?? null;
}

export async function findToolRowByName(
  db: DatabaseExecutor,
  input: { userId: string; name: string },
): Promise<ToolRow | null> {
  const [row] = await db
    .select()
    .from(tools)
    .where(and(eq(tools.userId, input.userId), eq(tools.name, input.name)));

  return row ?? null;
}

export interface ToolFilters {
  kind?: ToolKind | undefined;
  mcpServerId?: string | undefined;
}

export interface ListToolsInput extends PageInput {
  userId: string;
  filters?: ToolFilters;
}

export async function listTools(
  db: DatabaseExecutor,
  input: ListToolsInput,
): Promise<PageResult<Tool>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(tools.userId, input.userId)];
  if (filters.kind !== undefined) conditions.push(eq(tools.kind, filters.kind));
  if (filters.mcpServerId !== undefined) {
    conditions.push(eq(tools.mcpServerId, filters.mcpServerId));
  }
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(tools)
    .where(where)
    .orderBy(asc(tools.name), asc(tools.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(tools).where(where);

  return { items: rows.map(toTool), total: counted?.total ?? 0 };
}

export type CreateToolInput = {
  userId: string;
  name: string;
  description?: string | null;
} & (
  { kind: "COMMAND"; command: string } | { kind: "MCP_TOOL"; mcpServerId: string; toolName: string }
);

/** Insere a linha, sem evento. Quem chama já checou nome e servidor. */
export async function insertToolRow(
  db: DatabaseExecutor,
  input: CreateToolInput,
): Promise<ToolRow> {
  const [row] = await db
    .insert(tools)
    .values({
      id: newId(),
      userId: input.userId,
      name: input.name,
      kind: input.kind,
      command: input.kind === "COMMAND" ? input.command : null,
      mcpServerId: input.kind === "MCP_TOOL" ? input.mcpServerId : null,
      toolName: input.kind === "MCP_TOOL" ? input.toolName : null,
      description: input.description ?? null,
    })
    .returning();

  if (row === undefined) throw new Error("A inserção em tool não devolveu linha.");
  return row;
}

export async function createTool(
  db: Database,
  input: CreateToolInput,
): Promise<Result<Tool, RegistryWriteFailure>> {
  return await db.transaction(async (tx) => {
    const tomado = await findToolRowByName(tx, input);
    if (tomado !== null) {
      return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: input.name });
    }

    if (input.kind === "MCP_TOOL") {
      const servidor = await findMcpServerRow(tx, {
        userId: input.userId,
        mcpServerId: input.mcpServerId,
      });
      if (servidor === null) {
        return failed<RegistryWriteFailure>({
          code: "MCP_SERVER_NOT_FOUND",
          mcpServerId: input.mcpServerId,
        });
      }
    }

    const row = await insertToolRow(tx, input);

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "tool", id: row.id, action: "created" },
    });

    return ok(toTool(row));
  });
}

export interface UpdateToolPatch {
  name?: string;
  command?: string;
  mcpServerId?: string;
  toolName?: string;
  description?: string | null;
}

export async function updateTool(
  db: Database,
  input: { userId: string; toolId: string; patch: UpdateToolPatch },
): Promise<Result<Tool, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findToolRow(tx, input);
    if (current === null) return null;

    const { patch } = input;

    if (current.kind === "COMMAND") {
      const campo =
        patch.mcpServerId !== undefined
          ? "mcpServerId"
          : patch.toolName !== undefined
            ? "toolName"
            : null;
      if (campo !== null) {
        return failed<RegistryWriteFailure>({
          code: "TOOL_SHAPE_INVALID",
          kind: "COMMAND",
          field: campo,
        });
      }
    } else if (patch.command !== undefined) {
      return failed<RegistryWriteFailure>({
        code: "TOOL_SHAPE_INVALID",
        kind: "MCP_TOOL",
        field: "command",
      });
    }

    if (patch.name !== undefined && patch.name !== current.name) {
      const tomado = await findToolRowByName(tx, { userId: input.userId, name: patch.name });
      if (tomado !== null) {
        return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: patch.name });
      }
    }

    if (patch.mcpServerId !== undefined && patch.mcpServerId !== current.mcpServerId) {
      const servidor = await findMcpServerRow(tx, {
        userId: input.userId,
        mcpServerId: patch.mcpServerId,
      });
      if (servidor === null) {
        return failed<RegistryWriteFailure>({
          code: "MCP_SERVER_NOT_FOUND",
          mcpServerId: patch.mcpServerId,
        });
      }
    }

    const changed: string[] = [];
    const values: UpdateToolPatch = {};

    if (patch.name !== undefined && patch.name !== current.name) {
      values.name = patch.name;
      changed.push("name");
    }
    if (patch.command !== undefined && patch.command !== current.command) {
      values.command = patch.command;
      changed.push("command");
    }
    if (patch.mcpServerId !== undefined && patch.mcpServerId !== current.mcpServerId) {
      values.mcpServerId = patch.mcpServerId;
      changed.push("mcpServerId");
    }
    if (patch.toolName !== undefined && patch.toolName !== current.toolName) {
      values.toolName = patch.toolName;
      changed.push("toolName");
    }
    if (patch.description !== undefined && patch.description !== current.description) {
      values.description = patch.description;
      changed.push("description");
    }

    if (changed.length === 0) return ok(toTool(current));

    const [row] = await tx
      .update(tools)
      .set(values)
      .where(and(eq(tools.id, input.toolId), eq(tools.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de tool não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "tool", id: row.id, action: "updated", changed },
    });

    return ok(toTool(row));
  });
}

/** Apaga a Tool. Recusa enquanto algum Loadout a referencia. */
export async function deleteTool(
  db: Database,
  input: { userId: string; toolId: string },
): Promise<Result<null, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findToolRow(tx, input);
    if (current === null) return null;

    const emUso = await tx
      .select({ loadoutId: loadoutTools.loadoutId })
      .from(loadoutTools)
      .where(and(eq(loadoutTools.userId, input.userId), eq(loadoutTools.toolId, input.toolId)))
      .limit(IN_USE_SAMPLE_LIMIT);

    if (emUso.length > 0) {
      return failed<RegistryWriteFailure>({
        code: "IN_USE_BY_LOADOUT",
        loadoutIds: emUso.map((row) => row.loadoutId),
      });
    }

    await tx.delete(tools).where(and(eq(tools.id, input.toolId), eq(tools.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "tool", id: input.toolId, action: "deleted" },
    });

    return ok(null);
  });
}
