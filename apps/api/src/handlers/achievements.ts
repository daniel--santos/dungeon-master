import type { HeroStatsResponse } from "@dungeon-master/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { resolvePage } from "../pagination.js";
import type { AchievementsPort } from "../ports.js";
import {
  type AchievementCatalog,
  achievementsCatalogRoute,
  achievementsListRoute,
  achievementUnlocksListRoute,
  achievementUnlockSeenRoute,
  heroStatsRoute,
} from "../routes/achievements.js";
import { notFoundProblem } from "./failures.js";

/**
 * As rotas de Conquista, em duas naturezas.
 *
 * `GET /achievements/catalog` é sem estado: o catálogo chega pronto, carregado
 * uma vez no boot, e o handler só o devolve. Ler o arquivo por requisição
 * custaria I/O em toda abertura do Hall, e ler dentro do módulo faria
 * `pnpm gen` tocar o disco para gerar a spec.
 *
 * As outras quatro leem a projeção que o Worker mantém, e entram pela porta
 * como todo o resto: o handler não sabe se atrás dela existe PostgreSQL.
 */
export function registerAchievementRoutes(
  app: OpenAPIHono,
  catalog: AchievementCatalog,
  achievements: AchievementsPort,
): void {
  app.openapi(achievementsCatalogRoute, (c) => c.json(catalog, 200));

  app.openapi(achievementsListRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(await achievements.list(query), 200);
  });

  app.openapi(achievementUnlocksListRoute, async (c) => {
    const { page, pageSize } = resolvePage(c.req.valid("query"));
    const result = await achievements.unlocks({ page, pageSize });

    return c.json({ items: result.items, page, pageSize, total: result.total }, 200);
  });

  app.openapi(achievementUnlockSeenRoute, async (c) => {
    const { id } = c.req.valid("param");
    const unlock = await achievements.markSeen(id);

    if (unlock === null) throw notFoundProblem("desbloqueio de Conquista", id);

    return c.json(unlock, 200);
  });

  app.openapi(heroStatsRoute, async (c) => {
    const stats: HeroStatsResponse = await achievements.heroStats();
    return c.json(stats, 200);
  });
}
