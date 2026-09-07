import { describe, expect, it } from "vitest";

import { AchievementDefinitionSchema, AchievementTemplateSchema } from "./definition.js";
import { CONDITION_PREDICATES, ConditionSchema } from "./condition.js";

/** Uma definição mínima e válida, para variar um campo por vez. */
function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "sample",
    origin: "CATALOG",
    scope: "GLOBAL",
    name: { theme: "Amostra", plain: "Amostra" },
    description: { theme: "Uma amostra.", plain: "Uma amostra." },
    icon: "flag",
    rarity: "COMMON",
    hidden: false,
    condition: { predicate: "first", source: "run.succeeded" },
    ...overrides,
  };
}

const accepts = (condition: unknown): boolean => ConditionSchema.safeParse(condition).success;

describe("vocabulário fechado de condições", () => {
  it("tem exatamente cinco predicados", () => {
    expect(CONDITION_PREDICATES).toHaveLength(5);
  });

  it("aceita os cinco predicados bem formados", () => {
    expect(accepts({ predicate: "count", source: "project.created", thresholds: [1, 2] })).toBe(
      true,
    );
    expect(accepts({ predicate: "streak", source: "run.succeeded", length: 3 })).toBe(true);
    expect(accepts({ predicate: "first", source: "approval.granted" })).toBe(true);
    expect(
      accepts({
        predicate: "set",
        source: "run.succeeded",
        dimension: "run.executionMode",
        values: ["HOST", "DOCKER"],
      }),
    ).toBe(true);
    expect(
      accepts({
        predicate: "record",
        source: "run.succeeded",
        metric: "run.durationMs",
        direction: "min",
      }),
    ).toBe(true);
  });

  it("recusa predicado desconhecido", () => {
    expect(accepts({ predicate: "average", source: "run.succeeded" })).toBe(false);
    expect(accepts({ source: "run.succeeded" })).toBe(false);
  });

  it("recusa fonte desconhecida", () => {
    expect(accepts({ predicate: "first", source: "run.paused" })).toBe(false);
  });

  it("recusa campo de filtro desconhecido", () => {
    expect(
      accepts({ predicate: "first", source: "run.succeeded", filter: { "run.model": "opus" } }),
    ).toBe(false);
  });

  it("recusa valor fora do vocabulário em um campo conhecido", () => {
    expect(
      accepts({ predicate: "first", source: "task.completed", filter: { "task.kind": "EPIC" } }),
    ).toBe(false);
    expect(
      accepts({
        predicate: "first",
        source: "run.succeeded",
        filter: { "run.resumedFrom": "MAYBE" },
      }),
    ).toBe(false);
  });

  it("recusa thresholds fora de ordem crescente ou repetidos", () => {
    expect(accepts({ predicate: "count", source: "task.completed", thresholds: [50, 10] })).toBe(
      false,
    );
    expect(accepts({ predicate: "count", source: "task.completed", thresholds: [10, 10] })).toBe(
      false,
    );
    expect(accepts({ predicate: "count", source: "task.completed", thresholds: [] })).toBe(false);
  });

  it("recusa faixa de hora local invertida ou fora de 0..23", () => {
    const comFaixa = (hourLocal: unknown): boolean =>
      accepts({ predicate: "first", source: "run.succeeded", filter: { hourLocal } });
    expect(comFaixa({ from: 0, to: 5 })).toBe(true);
    expect(comFaixa({ from: 5, to: 0 })).toBe(false);
    expect(comFaixa({ from: 0, to: 24 })).toBe(false);
  });

  it("recusa conjunto com valor repetido", () => {
    expect(
      accepts({
        predicate: "set",
        source: "run.succeeded",
        dimension: "run.harness",
        values: ["claude", "claude"],
      }),
    ).toBe(false);
  });
});

describe("definição de Conquista", () => {
  it("aceita a definição mínima", () => {
    expect(AchievementDefinitionSchema.safeParse(definition()).success).toBe(true);
  });

  it("recusa campo desconhecido na raiz", () => {
    expect(AchievementDefinitionSchema.safeParse(definition({ points: 10 })).success).toBe(false);
  });

  it("recusa tiers de tamanho diferente de thresholds", () => {
    const result = AchievementDefinitionSchema.safeParse(
      definition({
        condition: { predicate: "count", source: "project.created", thresholds: [5, 25] },
        tiers: ["I", "II", "III"],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("aceita tiers de tamanho igual a thresholds", () => {
    const result = AchievementDefinitionSchema.safeParse(
      definition({
        condition: { predicate: "count", source: "project.created", thresholds: [5, 25] },
        tiers: ["I", "II"],
        tierRarities: ["COMMON", "RARE"],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("recusa tiers em condição que não é count", () => {
    expect(AchievementDefinitionSchema.safeParse(definition({ tiers: ["I"] })).success).toBe(false);
  });

  it("recusa flavor com versão plain: sabor é só do tema", () => {
    const result = AchievementDefinitionSchema.safeParse(
      definition({ flavor: { theme: "Só no tema.", plain: "Sem tema." } }),
    );
    expect(result.success).toBe(false);
  });

  it("aceita flavor como texto simples do tema", () => {
    expect(
      AchievementDefinitionSchema.safeParse(definition({ flavor: "Só no tema." })).success,
    ).toBe(true);
  });

  it("recusa campo extra dentro de name", () => {
    const result = AchievementDefinitionSchema.safeParse(
      definition({ name: { theme: "A", plain: "A", flavor: "B" } }),
    );
    expect(result.success).toBe(false);
  });

  it("recusa description sem a versão plain, ou com plain vazio", () => {
    expect(
      AchievementDefinitionSchema.safeParse(definition({ description: { theme: "Só o tema." } }))
        .success,
    ).toBe(false);
    expect(
      AchievementDefinitionSchema.safeParse(
        definition({ description: { theme: "Tema.", plain: "" } }),
      ).success,
    ).toBe(false);
  });

  it("recusa chave e ícone fora do formato canônico", () => {
    expect(
      AchievementDefinitionSchema.safeParse(definition({ key: "Primeira-Missão" })).success,
    ).toBe(false);
    expect(AchievementDefinitionSchema.safeParse(definition({ icon: "FlagIcon" })).success).toBe(
      false,
    );
  });
});

describe("template de Conquista", () => {
  function template(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...definition({
        origin: "TEMPLATE",
        scope: "PROJECT",
        name: { theme: "Guardião de {project}", plain: "Veterano de {project}" },
      }),
      instantiatedBy: "project",
      scopeFrom: "project.id",
      ...overrides,
    };
  }

  it("aceita o template mínimo", () => {
    expect(AchievementTemplateSchema.safeParse(template()).success).toBe(true);
  });

  it("recusa placeholder desconhecido", () => {
    const result = AchievementTemplateSchema.safeParse(
      template({ name: { theme: "Guardião de {campanha}", plain: "Veterano de {campanha}" } }),
    );
    expect(result.success).toBe(false);
  });

  it("recusa nome sem placeholder", () => {
    const result = AchievementTemplateSchema.safeParse(
      template({ name: { theme: "Guardião", plain: "Veterano" } }),
    );
    expect(result.success).toBe(false);
  });

  it("recusa origem diferente de TEMPLATE", () => {
    expect(AchievementTemplateSchema.safeParse(template({ origin: "CATALOG" })).success).toBe(
      false,
    );
  });

  it("recusa scopeFrom fora da lista de campos amarráveis", () => {
    expect(
      AchievementTemplateSchema.safeParse(template({ scopeFrom: "run.harnessId" })).success,
    ).toBe(false);
  });
});
