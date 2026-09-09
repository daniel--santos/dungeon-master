import type { McpServer, McpServerRef } from "@dungeon-master/contracts";
import { and, asc, count, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { IN_USE_SAMPLE_LIMIT, type RegistryWriteFailure } from "./registry.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { loadoutMcpServers } from "./schema/execution.js";
import { type McpServerRow, mcpServers, tools } from "./schema/registry.js";

/**
 * Servidor MCP: a forma de subi-lo, sem segredo (Fase 8A).
 *
 * `STDIO` guarda comando e argumentos separados; `HTTP` guarda a URL. Os dois
 * guardam só **nomes** de variáveis de ambiente. O `builtIn` (o `knowledge`
 * do Grimório) é do Worker: só a descrição dele é editável, e ele não se apaga.
 */

export function toMcpServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: row.args,
    url: row.url,
    envKeys: row.envKeys,
    readOnly: row.readOnly,
    builtIn: row.builtIn,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A forma curta que o snapshot do Run carrega: comando e argumentos numa
 * string só, ou a URL. É a mesma leitura que o Worker da Fase 7 faz.
 */
export function mcpServerTarget(
  row: Pick<McpServerRow, "transport" | "command" | "args" | "url">,
): string {
  if (row.transport === "HTTP") return row.url ?? "";
  return [row.command ?? "", ...row.args].filter((parte) => parte.length > 0).join(" ");
}

export function toMcpServerRef(row: McpServerRow): McpServerRef {
  return { name: row.name, transport: row.transport, target: mcpServerTarget(row) };
}

/** Quebra o `target` da forma curta em comando e argumentos, por espaço, sem shell. */
export function splitStdioTarget(target: string): { command: string; args: string[] } {
  const [command = "", ...args] = target
    .trim()
    .split(/\s+/)
    .filter((parte) => parte.length > 0);
  return { command, args };
}

export async function findMcpServerRow(
  db: DatabaseExecutor,
  input: { userId: string; mcpServerId: string },
): Promise<McpServerRow | null> {
  const [row] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, input.mcpServerId), eq(mcpServers.userId, input.userId)));

  return row ?? null;
}

export async function findMcpServerRowByName(
  db: DatabaseExecutor,
  input: { userId: string; name: string },
): Promise<McpServerRow | null> {
  const [row] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.userId, input.userId), eq(mcpServers.name, input.name)));

  return row ?? null;
}

export interface ListMcpServersInput extends PageInput {
  userId: string;
}

export async function listMcpServers(
  db: DatabaseExecutor,
  input: ListMcpServersInput,
): Promise<PageResult<McpServer>> {
  const where = eq(mcpServers.userId, input.userId);

  const rows = await db
    .select()
    .from(mcpServers)
    .where(where)
    .orderBy(asc(mcpServers.name), asc(mcpServers.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(mcpServers).where(where);

  return { items: rows.map(toMcpServer), total: counted?.total ?? 0 };
}

export type CreateMcpServerInput = {
  userId: string;
  name: string;
  envKeys?: string[];
  readOnly?: boolean;
  builtIn?: boolean;
  description?: string | null;
} & ({ transport: "STDIO"; command: string; args?: string[] } | { transport: "HTTP"; url: string });

/** Insere a linha, sem evento. Quem chama decide o evento e já checou o nome. */
export async function insertMcpServerRow(
  db: DatabaseExecutor,
  input: CreateMcpServerInput,
): Promise<McpServerRow> {
  const [row] = await db
    .insert(mcpServers)
    .values({
      id: newId(),
      userId: input.userId,
      name: input.name,
      transport: input.transport,
      command: input.transport === "STDIO" ? input.command : null,
      args: input.transport === "STDIO" ? (input.args ?? []) : [],
      url: input.transport === "HTTP" ? input.url : null,
      envKeys: input.envKeys ?? [],
      readOnly: input.readOnly ?? false,
      builtIn: input.builtIn ?? false,
      description: input.description ?? null,
    })
    .returning();

  if (row === undefined) throw new Error("A inserção em mcp_server não devolveu linha.");
  return row;
}

export async function createMcpServer(
  db: Database,
  input: CreateMcpServerInput,
): Promise<Result<McpServer, RegistryWriteFailure>> {
  return await db.transaction(async (tx) => {
    const existente = await findMcpServerRowByName(tx, input);
    if (existente !== null) {
      return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: input.name });
    }

    const row = await insertMcpServerRow(tx, { ...input, builtIn: false });

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "mcp_server", id: row.id, action: "created" },
    });

    return ok(toMcpServer(row));
  });
}

export interface UpdateMcpServerPatch {
  name?: string;
  command?: string;
  args?: string[];
  url?: string;
  envKeys?: string[];
  readOnly?: boolean;
  description?: string | null;
}

export async function updateMcpServer(
  db: Database,
  input: { userId: string; mcpServerId: string; patch: UpdateMcpServerPatch },
): Promise<Result<McpServer, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findMcpServerRow(tx, input);
    if (current === null) return null;

    const { patch } = input;

    // Um `builtIn` é do Worker: a forma de subi-lo não se edita por aqui.
    if (current.builtIn) {
      const proibidos = (["name", "command", "args", "url", "envKeys", "readOnly"] as const).filter(
        (campo) => patch[campo] !== undefined,
      );
      if (proibidos.length > 0) {
        return failed<RegistryWriteFailure>({
          code: "BUILT_IN_PROTECTED",
          mcpServerId: current.id,
          name: current.name,
        });
      }
    }

    // Campo do outro transporte: recusado, e não ignorado.
    if (current.transport === "STDIO" && patch.url !== undefined) {
      return failed<RegistryWriteFailure>({
        code: "MCP_SERVER_SHAPE_INVALID",
        transport: "STDIO",
        field: "url",
      });
    }
    if (current.transport === "HTTP") {
      const campo =
        patch.command !== undefined ? "command" : patch.args !== undefined ? "args" : null;
      if (campo !== null) {
        return failed<RegistryWriteFailure>({
          code: "MCP_SERVER_SHAPE_INVALID",
          transport: "HTTP",
          field: campo,
        });
      }
    }

    if (patch.name !== undefined && patch.name !== current.name) {
      const tomado = await findMcpServerRowByName(tx, { userId: input.userId, name: patch.name });
      if (tomado !== null) {
        return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: patch.name });
      }
    }

    const mudou = <T>(atual: T, novo: T | undefined): boolean =>
      novo !== undefined && JSON.stringify(atual) !== JSON.stringify(novo);

    const changed: string[] = [];
    const values: UpdateMcpServerPatch = {};

    if (mudou(current.name, patch.name)) {
      values.name = patch.name;
      changed.push("name");
    }
    if (mudou(current.command, patch.command)) {
      values.command = patch.command;
      changed.push("command");
    }
    if (mudou(current.args, patch.args)) {
      values.args = patch.args;
      changed.push("args");
    }
    if (mudou(current.url, patch.url)) {
      values.url = patch.url;
      changed.push("url");
    }
    if (mudou(current.envKeys, patch.envKeys)) {
      values.envKeys = patch.envKeys;
      changed.push("envKeys");
    }
    if (mudou(current.readOnly, patch.readOnly)) {
      values.readOnly = patch.readOnly;
      changed.push("readOnly");
    }
    if (mudou(current.description, patch.description)) {
      values.description = patch.description;
      changed.push("description");
    }

    if (changed.length === 0) return ok(toMcpServer(current));

    const [row] = await tx
      .update(mcpServers)
      .set(values)
      .where(and(eq(mcpServers.id, input.mcpServerId), eq(mcpServers.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de mcp_server não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "mcp_server", id: row.id, action: "updated", changed },
    });

    return ok(toMcpServer(row));
  });
}

/**
 * Apaga o servidor.
 *
 * Um `builtIn` nunca se apaga: o Worker sabe subi-lo e os Loadouts contam com
 * ele. Os demais recusam enquanto uma Tool ou um Loadout os referenciam.
 */
export async function deleteMcpServer(
  db: Database,
  input: { userId: string; mcpServerId: string },
): Promise<Result<null, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findMcpServerRow(tx, input);
    if (current === null) return null;

    if (current.builtIn) {
      return failed<RegistryWriteFailure>({
        code: "BUILT_IN_PROTECTED",
        mcpServerId: current.id,
        name: current.name,
      });
    }

    const ferramentas = await tx
      .select({ id: tools.id })
      .from(tools)
      .where(and(eq(tools.userId, input.userId), eq(tools.mcpServerId, input.mcpServerId)))
      .limit(IN_USE_SAMPLE_LIMIT);

    if (ferramentas.length > 0) {
      return failed<RegistryWriteFailure>({
        code: "IN_USE_BY_TOOL",
        toolIds: ferramentas.map((row) => row.id),
      });
    }

    const emUso = await tx
      .select({ loadoutId: loadoutMcpServers.loadoutId })
      .from(loadoutMcpServers)
      .where(
        and(
          eq(loadoutMcpServers.userId, input.userId),
          eq(loadoutMcpServers.mcpServerId, input.mcpServerId),
        ),
      )
      .limit(IN_USE_SAMPLE_LIMIT);

    if (emUso.length > 0) {
      return failed<RegistryWriteFailure>({
        code: "IN_USE_BY_LOADOUT",
        loadoutIds: emUso.map((row) => row.loadoutId),
      });
    }

    await tx
      .delete(mcpServers)
      .where(and(eq(mcpServers.id, input.mcpServerId), eq(mcpServers.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "mcp_server", id: input.mcpServerId, action: "deleted" },
    });

    return ok(null);
  });
}
