import type { ToolPage } from "@dungeon-master/contracts";
import type { UpdateToolPatch } from "@dungeon-master/database";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { ToolsPort } from "../ports.js";
import {
  toolsCreateRoute,
  toolsDeleteRoute,
  toolsGetRoute,
  toolsListRoute,
  toolsUpdateRoute,
} from "../routes/tools.js";
import { notFoundProblem, registryFailureProblem } from "./failures.js";

export function registerToolRoutes(app: OpenAPIHono, tools: ToolsPort): void {
  app.openapi(toolsListRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, pageSize } = resolvePage(query);
    const result = await tools.list({
      page,
      pageSize,
      filters: { kind: query.kind, mcpServerId: query.mcpServerId },
    });
    const body: ToolPage = { items: result.items, page, pageSize, total: result.total };
    return c.json(body, 200);
  });

  app.openapi(toolsCreateRoute, async (c) => {
    const input = c.req.valid("json");
    const created = await tools.create(
      input.kind === "COMMAND"
        ? {
            kind: "COMMAND",
            name: input.name,
            command: input.command,
            description: input.description ?? null,
          }
        : {
            kind: "MCP_TOOL",
            name: input.name,
            mcpServerId: input.mcpServerId,
            toolName: input.toolName,
            description: input.description ?? null,
          },
    );
    if (!created.ok) throw registryFailureProblem(created.failure);
    return c.json(created.value, 201);
  });

  app.openapi(toolsGetRoute, async (c) => {
    const { id } = c.req.valid("param");
    const tool = await tools.get(id);
    if (tool === null) throw notFoundProblem("Tool", id);
    return c.json(tool, 200);
  });

  app.openapi(toolsUpdateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const patch: UpdateToolPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.command !== undefined) patch.command = body.command;
    if (body.mcpServerId !== undefined) patch.mcpServerId = body.mcpServerId;
    if (body.toolName !== undefined) patch.toolName = body.toolName;
    if (Object.hasOwn(body, "description")) patch.description = body.description ?? null;

    const updated = await tools.update(id, patch);
    if (updated === null) throw notFoundProblem("Tool", id);
    if (!updated.ok) throw registryFailureProblem(updated.failure);
    return c.json(updated.value, 200);
  });

  app.openapi(toolsDeleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const removed = await tools.remove(id);
    if (removed === null) throw notFoundProblem("Tool", id);
    if (!removed.ok) throw registryFailureProblem(removed.failure);
    return c.body(null, 204);
  });
}
