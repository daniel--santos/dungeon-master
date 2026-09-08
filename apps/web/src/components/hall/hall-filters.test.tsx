import { describe, expect, it } from "vitest";

import {
  achievementKeys,
  hallSearchSchema,
  toAchievementQuery,
  type HallFilters,
} from "@/lib/achievements";

/**
 * O filtro do Hall vive nos parâmetros de busca da rota, e vai para a API.
 *
 * Desde a Fase 2.5D a peneira não é mais no cliente: o que a URL diz vira a
 * query de `GET /achievements`, e é a API que responde só com o que casa. Isso
 * importa porque o medidor ao lado dos filtros continua contando o **total** —
 * `counts` ignora os filtros de propósito —, e um filtro aplicado no cliente
 * teria de manter duas listas para conseguir a mesma coisa.
 *
 * O teste faz o caminho inteiro: a URL vira filtro tipado pelo schema, o filtro
 * vira a query, e a query vira a chave de cache.
 */

describe("filtros do Hall", () => {
  it("lê aba, raridade, origem e estado da URL, e ignora o que não conhece", () => {
    expect(hallSearchSchema.parse({ rarity: "EPIC" })).toEqual({
      tab: undefined,
      origin: undefined,
      rarity: "EPIC",
      state: undefined,
    });

    expect(
      hallSearchSchema.parse({ origin: "TEMPLATE", state: "HIDDEN", tab: "bestiary" }),
    ).toEqual({ tab: "bestiary", origin: "TEMPLATE", rarity: undefined, state: "HIDDEN" });

    // Um valor inválido cai no padrão em vez de derrubar a rota.
    expect(hallSearchSchema.parse({ rarity: "MITICA" }).rarity).toBeUndefined();
    expect(hallSearchSchema.parse({ tab: "inventario" }).tab).toBeUndefined();
  });

  it("leva para a query só o que a URL trouxe", () => {
    expect(toAchievementQuery(hallSearchSchema.parse({}))).toEqual({});

    expect(toAchievementQuery(hallSearchSchema.parse({ rarity: "EPIC" }))).toEqual({
      rarity: "EPIC",
    });

    expect(
      toAchievementQuery(
        hallSearchSchema.parse({ origin: "CATALOG", rarity: "RARE", state: "UNLOCKED" }),
      ),
    ).toEqual({ origin: "CATALOG", rarity: "RARE", state: "UNLOCKED" });
  });

  it("a aba não entra na query: trocar de aba não refaz a consulta", () => {
    const semAba = hallSearchSchema.parse({ rarity: "EPIC" });
    const comAba = hallSearchSchema.parse({ rarity: "EPIC", tab: "chronicle" });

    expect(toAchievementQuery(comAba)).toEqual(toAchievementQuery(semAba));
  });

  it("filtros diferentes têm chaves de cache diferentes", () => {
    const um: HallFilters = { origin: undefined, rarity: "EPIC", state: undefined };
    const outro: HallFilters = { origin: undefined, rarity: "RARE", state: undefined };

    expect(achievementKeys.list(um)).not.toEqual(achievementKeys.list(outro));
    expect(achievementKeys.list(um)[0]).toBe(achievementKeys.all[0]);
  });
});
