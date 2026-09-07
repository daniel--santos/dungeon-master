import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  CONDITION_PREDICATES,
  XP_BONUS_FIRST_DOCKER,
  XP_BONUS_MONSTER,
  XP_PER_VICTORY,
  catalogFile,
  levelForXp,
  loadCatalog,
  loadTemplates,
  parseCondition,
  parseDefinition,
  templatesFile,
  xpForLevel,
  xpToNextLevel,
  type AchievementDefinition,
} from "./index.js";

const catalog = loadCatalog();
const templates = loadTemplates();

const workspace = mkdtempSync(join(tmpdir(), "dm-achievements-"));

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function fixture(name: string, content: string): string {
  const file = join(workspace, name);
  writeFileSync(file, content, "utf8");
  return file;
}

/** Uma definição mínima e válida, usada nas fixturas de carga. */
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

describe("catálogo fixo v1", () => {
  it("carrega as quinze entradas, nenhuma inválida", () => {
    expect(catalog.invalid).toEqual([]);
    expect(catalog.valid).toHaveLength(15);
  });

  it("traz exatamente as chaves da tabela do planejamento", () => {
    expect(catalog.valid.map((entry) => entry.key)).toEqual([
      "first_expedition",
      "monster_slayer",
      "flawless_streak",
      "tactical_retreat",
      "sealed_dungeon",
      "four_guilds",
      "second_wind",
      "guild_seal",
      "veto",
      "grimoire_scribe",
      "ritualist",
      "cartographer",
      "long_march",
      "night_watch",
      "campaign_founder",
    ]);
  });

  it("não repete chave", () => {
    const keys = catalog.valid.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("é toda de origem CATALOG, escopo GLOBAL e visível", () => {
    for (const entry of catalog.valid) {
      expect(entry.origin, entry.key).toBe("CATALOG");
      expect(entry.scope, entry.key).toBe("GLOBAL");
      expect(entry.hidden, entry.key).toBe(false);
    }
  });

  it("tem nome e descrição plain não vazios em toda entrada", () => {
    for (const entry of [...catalog.valid, ...templates.valid]) {
      expect(entry.name.plain.trim(), entry.key).not.toBe("");
      expect(entry.description.plain.trim(), entry.key).not.toBe("");
    }
  });

  it("usa os cinco predicados do vocabulário fechado", () => {
    const usados = new Set(catalog.valid.map((entry) => entry.condition.predicate));
    expect([...usados].sort()).toEqual([...CONDITION_PREDICATES].sort());
  });

  it("long_march é um recorde de duração com piso de sessenta minutos", () => {
    const entry = catalog.valid.find((item) => item.key === "long_march");
    expect(entry?.condition).toEqual({
      predicate: "record",
      source: "run.succeeded",
      metric: "run.durationMs",
      direction: "max",
      min: 3_600_000,
    });
  });

  it("monster_slayer conta Tasks BUG em três tiers", () => {
    const entry = catalog.valid.find((item) => item.key === "monster_slayer");
    expect(entry?.condition).toMatchObject({
      predicate: "count",
      source: "task.completed",
      filter: { "task.kind": "BUG" },
      thresholds: [10, 50, 200],
    });
    expect(entry?.tiers).toEqual(["I", "II", "III"]);
    expect(entry?.tierRarities).toEqual(["COMMON", "RARE", "EPIC"]);
  });

  it("four_guilds exige o conjunto completo de Harnesses", () => {
    const entry = catalog.valid.find((item) => item.key === "four_guilds");
    expect(entry?.condition).toEqual({
      predicate: "set",
      source: "run.succeeded",
      dimension: "run.harness",
      values: ["claude", "codex", "pi", "antigravity"],
    });
  });

  it("night_watch usa a faixa de hora local de 0 a 5", () => {
    const entry = catalog.valid.find((item) => item.key === "night_watch");
    expect(entry?.condition).toMatchObject({ filter: { hourLocal: { from: 0, to: 5 } } });
  });
});

describe("templates v1", () => {
  it("carrega as cinco entradas, nenhuma inválida", () => {
    expect(templates.invalid).toEqual([]);
    expect(templates.valid).toHaveLength(5);
  });

  it("traz exatamente as chaves da tabela do planejamento", () => {
    expect(templates.valid.map((entry) => entry.key)).toEqual([
      "campaign_guardian",
      "guild_ally",
      "nemesis",
      "hero_veteran",
      "campaign_record",
    ]);
  });

  it("nasce oculto, com origem TEMPLATE e escopo não global", () => {
    for (const entry of templates.valid) {
      expect(entry.origin, entry.key).toBe("TEMPLATE");
      expect(entry.hidden, entry.key).toBe(true);
      expect(entry.scope, entry.key).not.toBe("GLOBAL");
    }
  });

  it("liga instantiatedBy ao campo de escopo da condição", () => {
    expect(
      templates.valid.map((entry) => [entry.key, entry.instantiatedBy, entry.scopeFrom]),
    ).toEqual([
      ["campaign_guardian", "project", "project.id"],
      ["guild_ally", "harness", "run.harness"],
      ["nemesis", "task.bug.reopened", "task.id"],
      ["hero_veteran", "agent", "agent.id"],
      ["campaign_record", "project", "project.id"],
    ]);
  });

  it("não amarra o id da entidade na condição: quem amarra é scopeFrom", () => {
    for (const entry of templates.valid) {
      const filter =
        "filter" in entry.condition
          ? (entry.condition.filter ?? {})
          : ({} as Record<string, unknown>);
      expect(Object.keys(filter), entry.key).not.toContain(entry.scopeFrom);
    }
  });

  it("todo nome tem placeholder nas duas versões", () => {
    for (const entry of templates.valid) {
      expect(entry.name.theme, entry.key).toMatch(/\{[a-z]+\}/);
      expect(entry.name.plain, entry.key).toMatch(/\{[a-z]+\}/);
    }
  });

  it("as vinte entradas versionadas passam no schema", () => {
    expect(catalog.valid.length + templates.valid.length).toBe(20);
  });
});

describe("carga fail-closed", () => {
  it("devolve invalid, sem lançar, quando o arquivo tem JSON quebrado", () => {
    const file = fixture("quebrado.json", '[{"key": "x",]');
    const result = loadCatalog({ file });
    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.key).toBeNull();
    expect(result.invalid[0]?.error).toContain("JSON inválido");
  });

  it("devolve invalid, sem lançar, quando o arquivo não existe", () => {
    const result = loadCatalog({ file: join(workspace, "ausente.json") });
    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(1);
  });

  it("devolve invalid quando a raiz não é uma lista", () => {
    const file = fixture("objeto.json", '{"key": "x"}');
    const result = loadCatalog({ file });
    expect(result.valid).toEqual([]);
    expect(result.invalid[0]?.error).toContain("lista");
  });

  it("descarta só a entrada torta e guarda a chave e o erro", () => {
    const file = fixture(
      "misto.json",
      JSON.stringify([
        definition({ key: "boa" }),
        definition({ key: "torta", condition: { predicate: "average", source: "run.succeeded" } }),
      ]),
    );
    const result = loadCatalog({ file });
    expect(result.valid.map((entry: AchievementDefinition) => entry.key)).toEqual(["boa"]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.key).toBe("torta");
    expect(result.invalid[0]?.index).toBe(1);
    expect(result.invalid[0]?.error).not.toBe("");
    expect(result.invalid[0]?.issues.length).toBeGreaterThan(0);
  });

  it("descarta a segunda ocorrência de uma chave repetida", () => {
    const file = fixture(
      "repetida.json",
      JSON.stringify([definition({ key: "dupla" }), definition({ key: "dupla" })]),
    );
    const result = loadCatalog({ file });
    expect(result.valid).toHaveLength(1);
    expect(result.invalid[0]?.error).toContain("Chave repetida");
  });

  it("loadTemplates recusa uma definição que não é template", () => {
    const file = fixture("naotemplate.json", JSON.stringify([definition({ key: "avulsa" })]));
    const result = loadTemplates({ file });
    expect(result.valid).toEqual([]);
    expect(result.invalid[0]?.key).toBe("avulsa");
  });

  it("aponta para os arquivos versionados que acompanham o pacote", () => {
    expect(catalogFile()).toMatch(/catalog[\\/]v1[\\/]catalog\.json$/);
    expect(templatesFile()).toMatch(/catalog[\\/]v1[\\/]templates\.json$/);
  });

  it("parseCondition e parseDefinition seguem o mesmo contrato, sem lançar", () => {
    const ok = parseCondition({ predicate: "first", source: "run.succeeded" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.predicate).toBe("first");

    const falha = parseCondition({ predicate: "average", source: "run.succeeded" });
    expect(falha.ok).toBe(false);
    if (!falha.ok) {
      expect(falha.error).not.toBe("");
      expect(falha.issues.length).toBeGreaterThan(0);
    }

    expect(parseDefinition(definition()).ok).toBe(true);
    expect(parseDefinition(undefined).ok).toBe(false);
    expect(parseCondition(null).ok).toBe(false);
  });
});

describe("experiência e nível", () => {
  it("expõe as constantes da Fase 2.5A", () => {
    expect(XP_PER_VICTORY).toBe(100);
    expect(XP_BONUS_MONSTER).toBe(50);
    expect(XP_BONUS_FIRST_DOCKER).toBe(150);
  });

  it("o nível 1 começa em zero", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-500)).toBe(1);
  });

  it("levelForXp é inversa de xpForLevel", () => {
    for (let level = 1; level <= 200; level += 1) {
      expect(levelForXp(xpForLevel(level)), `nível ${String(level)}`).toBe(level);
      if (level > 1) {
        expect(levelForXp(xpForLevel(level) - 1), `nível ${String(level)} - 1 xp`).toBe(level - 1);
      }
    }
  });

  it("levelForXp é monótona não decrescente", () => {
    let anterior = levelForXp(0);
    for (let xp = 0; xp <= 200_000; xp += 37) {
      const atual = levelForXp(xp);
      expect(atual).toBeGreaterThanOrEqual(anterior);
      anterior = atual;
    }
  });

  it("xpForLevel é estritamente crescente", () => {
    for (let level = 1; level < 200; level += 1) {
      expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level));
    }
  });

  it("não quebra com entrada inválida", () => {
    expect(levelForXp(Number.NaN)).toBe(1);
    expect(levelForXp(Number.POSITIVE_INFINITY)).toBe(1);
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(-3)).toBe(0);
    expect(xpForLevel(2.9)).toBe(xpForLevel(2));
  });

  it("xpToNextLevel fecha a conta com xpForLevel", () => {
    for (const xp of [0, 1, 99, 100, 299, 300, 12_345]) {
      expect(xp + xpToNextLevel(xp)).toBe(xpForLevel(levelForXp(xp) + 1));
    }
  });
});
