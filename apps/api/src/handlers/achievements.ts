import type { OpenAPIHono } from "@hono/zod-openapi";

import { type AchievementCatalog, achievementsCatalogRoute } from "../routes/achievements.js";

/**
 * Uma rota, um handler, nenhuma consulta.
 *
 * O catálogo chega pronto, carregado uma vez no boot, e o handler só o devolve.
 * Ler o arquivo por requisição custaria I/O em toda abertura do Hall, e ler
 * dentro do módulo faria `pnpm gen` tocar o disco para gerar a spec.
 */
export function registerAchievementRoutes(app: OpenAPIHono, catalog: AchievementCatalog): void {
  app.openapi(achievementsCatalogRoute, (c) => c.json(catalog, 200));
}
