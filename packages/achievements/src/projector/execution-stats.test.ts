import { describe, expect, it } from "vitest";

import {
  XP_BONUS_FIRST_DOCKER,
  XP_BONUS_BUG_TASK,
  XP_PER_SUCCEEDED_RUN,
  levelForXp,
} from "../xp.js";

import {
  applyRunOutcome,
  applyUsage,
  EMPTY_EXECUTION_STATS,
  topHarness,
  type ExecutionStatsState,
} from "./execution-stats.js";

const vitoria = {
  outcome: "SUCCEEDED",
  harness: "claude",
  executionMode: "HOST",
  bug: false,
} as const;

describe("applyRunOutcome", () => {
  it("uma vitória dá XP e sobe o nível pela fórmula do catálogo", () => {
    const estado = applyRunOutcome(EMPTY_EXECUTION_STATS, vitoria);

    expect(estado.xp).toBe(XP_PER_SUCCEEDED_RUN);
    expect(estado.level).toBe(levelForXp(XP_PER_SUCCEEDED_RUN));
    expect(estado.runsSucceeded).toBe(1);
    expect(estado.runsTotal).toBe(1);
    expect(estado.runsFailed).toBe(0);
  });

  it("Monstro derrotado soma o bônus e entra na contagem", () => {
    const estado = applyRunOutcome(EMPTY_EXECUTION_STATS, { ...vitoria, bug: true });

    expect(estado.xp).toBe(XP_PER_SUCCEEDED_RUN + XP_BONUS_BUG_TASK);
    expect(estado.bugTasksCompleted).toBe(1);
  });

  it("o bônus de Masmorra selada sai só na primeira vitória em DOCKER", () => {
    const primeira = applyRunOutcome(EMPTY_EXECUTION_STATS, {
      ...vitoria,
      executionMode: "DOCKER",
    });
    const segunda = applyRunOutcome(primeira, { ...vitoria, executionMode: "DOCKER" });

    expect(primeira.xp).toBe(XP_PER_SUCCEEDED_RUN + XP_BONUS_FIRST_DOCKER);
    expect(segunda.xp).toBe(primeira.xp + XP_PER_SUCCEEDED_RUN);
    expect(segunda.dockerRunsSucceeded).toBe(2);
  });

  it("derrota conta expedição e não dá XP; cancelamento não é derrota", () => {
    const derrota = applyRunOutcome(EMPTY_EXECUTION_STATS, { ...vitoria, outcome: "FAILED" });
    const abandono = applyRunOutcome(derrota, { ...vitoria, outcome: "ABANDONED" });

    expect(derrota.xp).toBe(0);
    expect(derrota.runsFailed).toBe(1);
    expect(abandono.runsTotal).toBe(2);
    expect(abandono.runsFailed).toBe(1);
  });

  it("toda Expedição terminada conta para a Guilda que a executou", () => {
    let estado: ExecutionStatsState = EMPTY_EXECUTION_STATS;
    estado = applyRunOutcome(estado, { ...vitoria, harness: "codex" });
    estado = applyRunOutcome(estado, { ...vitoria, harness: "codex", outcome: "FAILED" });
    estado = applyRunOutcome(estado, { ...vitoria, harness: "claude" });

    expect(estado.harnessCounts).toEqual({ codex: 2, claude: 1 });
    expect(topHarness(estado.harnessCounts)).toBe("codex");
  });
});

describe("applyUsage e topHarness", () => {
  it("soma tokens e ignora valor inválido", () => {
    expect(applyUsage(EMPTY_EXECUTION_STATS, 120).tokens).toBe(120);
    expect(applyUsage(EMPTY_EXECUTION_STATS, 0).tokens).toBe(0);
    expect(applyUsage(EMPTY_EXECUTION_STATS, Number.NaN).tokens).toBe(0);
  });

  it("empate é desfeito pela ordem alfabética, para a reconstrução repetir", () => {
    expect(topHarness({ pi: 2, codex: 2 })).toBe("codex");
    expect(topHarness({})).toBeNull();
  });
});
