import type { McpServerPage } from "@dungeon-master/contracts";
import type { UpdateMcpServerPatch } from "@dungeon-master/database";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { McpServersPort } from "../ports.js";
import {
  mcpServersCreateRoute,
  mcpServersDeleteRoute,
  mcpServersGetRoute,
  mcpServersListRoute,
  mcpServersUpdateRoute,
} from "../routes/mcp-servers.js";
import { notFoundProblem, registryFailureProblem } from "./failures.js";

export function registerMcpServerRoutes(app: OpenAPIHono, servers: McpServersPort): void {
  app.openapi(mcpServersListRoute, async (c) => {
    const { page, pageSize } = resolvePage(c.req.valid("query"));
    const result = await servers.list({ page, pageSize });
    const body: McpServerPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(mcpServersCreateRoute, async (c) => {
    const input = c.req.valid("json");
    const comum = {
      name: input.name,
      ...(input.envKeys === undefined ? {} : { envKeys: input.envKeys }),
      ...(input.readOnly === undefined ? {} : { readOnly: input.readOnly }),
      description: input.description ?? null,
    };
    const created = await servers.create(
      input.transport === "STDIO"
        ? {
            ...comum,
            transport: "STDIO",
            command: input.command,
            ...(input.args === undefined ? {} : { args: input.args }),
          }
        : { ...comum, transport: "HTTP", url: input.url },
    );
    if (!created.ok) throw registryFailureProblem(created.failure);
    return c.json(created.value, 201);
  });

  app.openapi(mcpServersGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const server = await servers.get(id);
    if (server === null) throw notFoundProblem("McpServer", id);
    return c.json(server, 200);
  });

  app.openapi(mcpServersUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const patch: UpdateMcpServerPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.command !== undefined) patch.command = body.command;
    if (body.args !== undefined) patch.args = body.args;
    if (body.url !== undefined) patch.url = body.url;
    if (body.envKeys !== undefined) patch.envKeys = body.envKeys;
    if (body.readOnly !== undefined) patch.readOnly = body.readOnly;
    if (Object.hasOwn(body, "description")) patch.description = body.description ?? null;

    const updated = await servers.update(id, patch);
    if (updated === null) throw notFoundProblem("McpServer", id);
    if (!updated.ok) throw registryFailureProblem(updated.failure);
    return c.json(updated.value, 200);
  });

  app.openapi(mcpServersDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const removed = await servers.remove(id);
    if (removed === null) throw notFoundProblem("McpServer", id);
    if (!removed.ok) throw registryFailureProblem(removed.failure);
    return c.body(null, 204);
  });
}
