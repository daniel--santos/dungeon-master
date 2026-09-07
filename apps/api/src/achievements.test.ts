import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { loadAchievementCatalog } from "./composition.js";
import { API_BASE_PATH } from "./config.js";
import { buildOpenApiDocument } from "./openapi.js";
import { createSpecPorts } from "./ports.js";
import { AchievementCatalogSchema } from "./routes/achievements.js";

/**
 * O catálogo não toca o banco: as portas de trabalho são as inertes, que lançam
 * se alguém as chamar. Se esta rota algum dia passar a consultar alguma coisa,
 * o teste falha alto em vez de passar por acidente.
 */
function appComCatalogo() {
  return createApp({ ...createSpecPorts(), achievements: loadAchievementCatalog() });
}

const CAMINHO = `${API_BASE_PATH}/achievements/catalog`;

describe(`GET ${CAMINHO}`, () => {
  it("devolve o catálogo versionado inteiro, íntegro", async () => {
    const response = await appComCatalogo().request(CAMINHO);

    expect(response.status).toBe(200);

    const body = AchievementCatalogSchema.parse(await response.json());

    expect(body.definitions).toHaveLength(15);
    expect(body.templates).toHaveLength(5);
    // Fail-closed com o arquivo certo não recusa nada: `invalid` vazio é a
    // prova de que as 20 entradas do repositório passam no schema.
    expect(body.invalid).toEqual([]);
  });

  it("traz nome e descrição nas duas versões, com a condição estruturada", async () => {
    const response = await appComCatalogo().request(CAMINHO);
    const body = AchievementCatalogSchema.parse(await response.json());

    for (const definition of body.definitions) {
      expect(definition.name.theme.length).toBeGreaterThan(0);
      expect(definition.name.plain.length).toBeGreaterThan(0);
      expect(definition.description.theme.length).toBeGreaterThan(0);
      expect(definition.description.plain.length).toBeGreaterThan(0);
      expect(definition.origin).toBe("CATALOG");
      expect(typeof definition.hidden).toBe("boolean");
      expect(definition.icon.length).toBeGreaterThan(0);
      expect(["COMMON", "RARE", "EPIC", "LEGENDARY"]).toContain(definition.rarity);
      // A condição é objeto, não texto: o vocabulário é fechado e o cliente
      // consegue decidir o que desenhar sem interpretar uma expressão.
      expect(["count", "streak", "first", "set", "record"]).toContain(
        definition.condition.predicate,
      );
    }

    for (const template of body.templates) {
      expect(template.origin).toBe("TEMPLATE");
      expect(template.name.theme).toMatch(/\{(project|harness|agent|task)\}/);
      expect(template.name.plain).toMatch(/\{(project|harness|agent|task)\}/);
    }
  });

  it("os tiers casam um a um com os limiares", async () => {
    const response = await appComCatalogo().request(CAMINHO);
    const body = AchievementCatalogSchema.parse(await response.json());

    const comTiers = [...body.definitions, ...body.templates].filter(
      (item) => item.tiers !== undefined,
    );

    expect(comTiers.length).toBeGreaterThan(0);

    for (const item of comTiers) {
      expect(item.condition.predicate).toBe("count");
      const thresholds = item.condition.predicate === "count" ? item.condition.thresholds : [];
      expect(item.tiers).toHaveLength(thresholds.length);
      if (item.tierRarities !== undefined) {
        expect(item.tierRarities).toHaveLength(thresholds.length);
      }
    }
  });

  it("é sem estado: duas leituras devolvem exatamente o mesmo corpo", async () => {
    const app = appComCatalogo();

    const primeira = await (await app.request(CAMINHO)).text();
    const segunda = await (await app.request(CAMINHO)).text();

    expect(segunda).toBe(primeira);
  });
});

describe("catálogo na spec OpenAPI", () => {
  it("registra os schemas do pacote de Conquistas, sem duplicá-los", () => {
    const document = buildOpenApiDocument();
    const paths = document["paths"] as Record<string, unknown>;
    const components = document["components"] as { schemas?: Record<string, unknown> };

    expect(Object.keys(paths)).toContain(CAMINHO);
    expect(Object.keys(components.schemas ?? {})).toEqual(
      expect.arrayContaining([
        "AchievementCatalog",
        "AchievementDefinition",
        "AchievementTemplate",
        "AchievementCatalogInvalidEntry",
      ]),
    );
  });

  it("a spec é gerada sem ler o catálogo do disco", () => {
    // As portas inertes trazem o catálogo vazio; a spec descreve a forma, e a
    // forma não depende de quantas Conquistas o arquivo tem hoje.
    expect(createSpecPorts().achievements).toEqual({
      definitions: [],
      templates: [],
      invalid: [],
    });
  });
});
