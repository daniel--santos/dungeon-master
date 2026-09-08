import { describe, expect, it } from "vitest";

import { XP_BONUS_FIRST_DOCKER, XP_BONUS_MONSTER, XP_PER_VICTORY, levelForXp } from "../xp.js";

import {
  applyRunOutcome,
  applyUsage,
  EMPTY_HERO_STATS,
  topHarness,
  type HeroStatsState,
} from "./hero-stats.js";

const vitoria = {
  outcome: "VICTORY",
  harness: "claude",
  executionMode: "HOST",
  monster: false,
} as const;

describe("applyRunOutcome", () => {
  it("uma vitória dá XP e sobe o nível pela fórmula do catálogo", () => {
    const estado = applyRunOutcome(EMPTY_HERO_STATS, vitoria);

    expect(estado.xp).toBe(XP_PER_VICTORY);
    expect(estado.level).toBe(levelForXp(XP_PER_VICTORY));
    expect(estado.victories).toBe(1);
    expect(estado.expeditions).toBe(1);
    expect(estado.defeats).toBe(0);
  });

  it("Monstro derrotado soma o bônus e entra na contagem", () => {
    const estado = applyRunOutcome(EMPTY_HERO_STATS, { ...vitoria, monster: true });

    expect(estado.xp).toBe(XP_PER_VICTORY + XP_BONUS_MONSTER);
    expect(estado.monstersSlain).toBe(1);
  });

  it("o bônus de Masmorra selada sai só na primeira vitória em DOCKER", () => {
    const primeira = applyRunOutcome(EMPTY_HERO_STATS, { ...vitoria, executionMode: "DOCKER" });
    const segunda = applyRunOutcome(primeira, { ...vitoria, executionMode: "DOCKER" });

    expect(primeira.xp).toBe(XP_PER_VICTORY + XP_BONUS_FIRST_DOCKER);
    expect(segunda.xp).toBe(primeira.xp + XP_PER_VICTORY);
    expect(segunda.dockerVictories).toBe(2);
  });

  it("derrota conta expedição e não dá XP; cancelamento não é derrota", () => {
    const derrota = applyRunOutcome(EMPTY_HERO_STATS, { ...vitoria, outcome: "DEFEAT" });
    const abandono = applyRunOutcome(derrota, { ...vitoria, outcome: "ABANDONED" });

    expect(derrota.xp).toBe(0);
    expect(derrota.defeats).toBe(1);
    expect(abandono.expeditions).toBe(2);
    expect(abandono.defeats).toBe(1);
  });

  it("toda Expedição terminada conta para a Guilda que a executou", () => {
    let estado: HeroStatsState = EMPTY_HERO_STATS;
    estado = applyRunOutcome(estado, { ...vitoria, harness: "codex" });
    estado = applyRunOutcome(estado, { ...vitoria, harness: "codex", outcome: "DEFEAT" });
    estado = applyRunOutcome(estado, { ...vitoria, harness: "claude" });

    expect(estado.harnessCounts).toEqual({ codex: 2, claude: 1 });
    expect(topHarness(estado.harnessCounts)).toBe("codex");
  });
});

describe("applyUsage e topHarness", () => {
  it("soma tokens e ignora valor inválido", () => {
    expect(applyUsage(EMPTY_HERO_STATS, 120).tokens).toBe(120);
    expect(applyUsage(EMPTY_HERO_STATS, 0).tokens).toBe(0);
    expect(applyUsage(EMPTY_HERO_STATS, Number.NaN).tokens).toBe(0);
  });

  it("empate é desfeito pela ordem alfabética, para a reconstrução repetir", () => {
    expect(topHarness({ pi: 2, codex: 2 })).toBe("codex");
    expect(topHarness({})).toBeNull();
  });
});
