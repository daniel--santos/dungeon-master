import type { OpenAPIHono } from "@hono/zod-openapi";

import type { DockerPreflightPort } from "../ports.js";
import { dockerPreflightRoute } from "../routes/preflight.js";

export function registerPreflightRoutes(app: OpenAPIHono, preflight: DockerPreflightPort): void {
  app.openapi(dockerPreflightRoute, async (c) => c.json(await preflight.check(), 200));
}
