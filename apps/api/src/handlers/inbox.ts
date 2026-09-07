import type { InboxPage } from "@dungeon-master/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { InboxPort, PromoteInboxRequest } from "../ports.js";
import {
  inboxCaptureRoute,
  inboxDiscardRoute,
  inboxListRoute,
  inboxPromoteRoute,
} from "../routes/inbox.js";
import { inboxFailureProblem, notFoundProblem } from "./failures.js";

export function registerInboxRoutes(app: OpenAPIHono, inbox: InboxPort): void {
  app.openapi(inboxCaptureRoute, async (c) => {
    const { text } = c.req.valid("json");

    return c.json(await inbox.capture(text), 201);
  });

  app.openapi(inboxListRoute, async (c) => {
    const { page, pageSize } = resolvePage(c.req.valid("query"));

    const result = await inbox.list({ page, pageSize });
    const body: InboxPage = { items: result.items, page, pageSize, total: result.total };

    return c.json(body, 200);
  });

  app.openapi(inboxPromoteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const input: PromoteInboxRequest = { projectId: body.projectId };
    if (body.title !== undefined) input.title = body.title;
    if (body.kind !== undefined) input.kind = body.kind;
    if (body.priority !== undefined) input.priority = body.priority;

    const promoted = await inbox.promote(id, input);
    if (promoted === null) throw notFoundProblem("Task", id);
    if (!promoted.ok) throw inboxFailureProblem(promoted.failure);

    return c.json(promoted.value, 200);
  });

  app.openapi(inboxDiscardRoute, async (c) => {
    const { id } = c.req.valid("param");

    const discarded = await inbox.discard(id);
    if (discarded === null) throw notFoundProblem("Task", id);
    if (!discarded.ok) throw inboxFailureProblem(discarded.failure);

    return c.json(discarded.value, 200);
  });
}
