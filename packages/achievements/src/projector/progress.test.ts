import { describe, expect, it } from "vitest";

import type { Condition } from "../condition.js";
import { CONDITION_PREDICATES } from "../condition.js";

import type { EventFields, ProjectionEvent } from "./event.js";
import { isContrarySource, matchesFilter } from "./event.js";
import {
  achievementTargets,
  achievementTierCount,
  achievementValue,
  applyEvent,
  EMPTY_PROGRESS,
  tiersReached,
  type AchievementProgress,
} from "./progress.js";

/**
 * Os cinco predicados, um a um, sem banco.
 *
 * O projetor inteiro é um fold destas funções sobre uma lista ordenada de
 * fatos: se cada predicado está certo aqui, o que o teste com banco precisa
 * provar é só a leitura, a escrita e a idempotência — não a aritmética.
 */

function fato(
  source: ProjectionEvent["source"],
  extra: Partial<ProjectionEvent> = {},
): ProjectionEvent {
  return {
    source,
    at: "2026-09-07T12:00:00.000Z",
    runId: null,
    taskId: null,
    fields: {},
    ...extra,
  };
}

function comCampos(source: ProjectionEvent["source"], fields: EventFields): ProjectionEvent {
  return fato(source, { fields });
}

/** Aplica uma lista de fatos em ordem e devolve o estado e todos os tiers. */
function dobrar(
  condition: Condition,
  eventos: readonly ProjectionEvent[],
): { progress: AchievementProgress; unlocked: number[] } {
  let progress = EMPTY_PROGRESS;
  const unlocked: number[] = [];

  for (const evento of eventos) {
    const resultado = applyEvent(condition, progress, evento);
    progress = resultado.progress;
    unlocked.push(...resultado.unlocked);
  }

  return { progress, unlocked };
}

describe("count", () => {
  const condition: Condition = {
    predicate: "count",
    source: "task.completed",
    filter: { "task.kind": "BUG" },
    thresholds: [2, 4],
  };

  it("conta só o que casa com o filtro e desbloqueia um tier por limiar", () => {
    const { progress, unlocked } = dobrar(condition, [
      comCampos("task.completed", { "task.kind": "BUG" }),
      comCampos("task.completed", { "task.kind": "FEATURE" }),
      comCampos("task.completed", { "task.kind": "BUG" }),
      comCampos("task.completed", { "task.kind": "BUG" }),
      comCampos("task.completed", { "task.kind": "BUG" }),
    ]);

    expect(progress.counter).toBe(4);
    expect(unlocked).toEqual([1, 2]);
  });

  it("ignora fato de outra fonte", () => {
    const { progress, unlocked } = dobrar(condition, [
      comCampos("run.succeeded", { "task.kind": "BUG" }),
    ]);

    expect(progress.counter).toBe(0);
    expect(unlocked).toEqual([]);
  });

  it("um campo de filtro que o fato não traz nunca casa", () => {
    const { progress } = dobrar(condition, [fato("task.completed")]);
    expect(progress.counter).toBe(0);
  });

  it("reprocessar sobre o estado já avançado não devolve tier novo", () => {
    const evento = comCampos("task.completed", { "task.kind": "BUG" });
    const primeiro = applyEvent(condition, EMPTY_PROGRESS, evento);
    const segundo = applyEvent(condition, primeiro.progress, evento);

    expect(primeiro.unlocked).toEqual([]);
    expect(segundo.unlocked).toEqual([1]);
    // O terceiro passa do limiar e não redesbloqueia o tier 1.
    expect(applyEvent(condition, segundo.progress, evento).unlocked).toEqual([]);
  });
});

describe("streak", () => {
  const condition: Condition = { predicate: "streak", source: "run.succeeded", length: 3 };

  it("desbloqueia ao encadear e zera num fato contrário", () => {
    const { progress, unlocked } = dobrar(condition, [
      fato("run.succeeded"),
      fato("run.succeeded"),
      fato("run.failed"),
      fato("run.succeeded"),
      fato("run.succeeded"),
      fato("run.succeeded"),
    ]);

    expect(unlocked).toEqual([1]);
    expect(progress.streak).toBe(3);
    expect(progress.bestStreak).toBe(3);
  });

  it("cancelamento também é contrário de vitória", () => {
    const { progress } = dobrar(condition, [
      fato("run.succeeded"),
      fato("run.succeeded"),
      fato("run.cancelled"),
    ]);

    expect(progress.streak).toBe(0);
    expect(progress.bestStreak).toBe(2);
  });

  it("fato de outra família não zera a sequência", () => {
    const { progress } = dobrar(condition, [
      fato("run.succeeded"),
      fato("task.completed"),
      fato("run.succeeded"),
    ]);

    expect(progress.streak).toBe(2);
  });

  it("o contrário que não casa com o filtro não zera", () => {
    const comFiltro: Condition = {
      predicate: "streak",
      source: "run.succeeded",
      filter: { "run.harness": "claude" },
      length: 3,
    };

    const { progress } = dobrar(comFiltro, [
      comCampos("run.succeeded", { "run.harness": "claude" }),
      comCampos("run.failed", { "run.harness": "codex" }),
      comCampos("run.succeeded", { "run.harness": "claude" }),
    ]);

    expect(progress.streak).toBe(2);
  });
});

describe("first", () => {
  const condition: Condition = {
    predicate: "first",
    source: "run.succeeded",
    filter: { "run.executionMode": "DOCKER" },
  };

  it("desbloqueia na primeira vez e não conta as seguintes", () => {
    const { progress, unlocked } = dobrar(condition, [
      comCampos("run.succeeded", { "run.executionMode": "HOST" }),
      comCampos("run.succeeded", { "run.executionMode": "DOCKER" }),
      comCampos("run.succeeded", { "run.executionMode": "DOCKER" }),
    ]);

    expect(unlocked).toEqual([1]);
    expect(progress.counter).toBe(1);
  });

  it("faixa de hora local é inclusiva nas duas pontas", () => {
    const noturna: Condition = {
      predicate: "first",
      source: "run.succeeded",
      filter: { hourLocal: { from: 0, to: 5 } },
    };

    expect(dobrar(noturna, [comCampos("run.succeeded", { hourLocal: 5 })]).unlocked).toEqual([1]);
    expect(dobrar(noturna, [comCampos("run.succeeded", { hourLocal: 6 })]).unlocked).toEqual([]);
    expect(dobrar(noturna, [comCampos("run.succeeded", { hourLocal: 0 })]).unlocked).toEqual([1]);
  });
});

describe("set", () => {
  const condition: Condition = {
    predicate: "set",
    source: "run.succeeded",
    dimension: "run.harness",
    values: ["claude", "codex", "pi"],
  };

  it("desbloqueia só com a dimensão completa, e repetição não conta", () => {
    const { progress, unlocked } = dobrar(condition, [
      comCampos("run.succeeded", { "run.harness": "claude" }),
      comCampos("run.succeeded", { "run.harness": "claude" }),
      comCampos("run.succeeded", { "run.harness": "antigravity" }),
      comCampos("run.succeeded", { "run.harness": "codex" }),
      comCampos("run.succeeded", { "run.harness": "pi" }),
    ]);

    expect(progress.seen).toEqual(["claude", "codex", "pi"]);
    expect(unlocked).toEqual([1]);
  });
});

describe("record", () => {
  const condition: Condition = {
    predicate: "record",
    source: "run.succeeded",
    metric: "run.durationMs",
    direction: "max",
    min: 1000,
  };

  it("guarda a maior marca acima do piso e desbloqueia uma vez só", () => {
    const { progress, unlocked } = dobrar(condition, [
      fato("run.succeeded", { metrics: { "run.durationMs": 500 } }),
      fato("run.succeeded", { metrics: { "run.durationMs": 2000 } }),
      fato("run.succeeded", { metrics: { "run.durationMs": 1500 } }),
      fato("run.succeeded", { metrics: { "run.durationMs": 9000 } }),
    ]);

    expect(progress.best).toBe(9000);
    expect(unlocked).toEqual([1]);
  });

  it("direção min guarda a menor marca e o piso continua valendo", () => {
    const menor: Condition = {
      predicate: "record",
      source: "run.succeeded",
      metric: "run.durationMs",
      direction: "min",
      min: 1000,
    };

    const { progress } = dobrar(menor, [
      fato("run.succeeded", { metrics: { "run.durationMs": 5 } }),
      fato("run.succeeded", { metrics: { "run.durationMs": 8000 } }),
      fato("run.succeeded", { metrics: { "run.durationMs": 3000 } }),
    ]);

    expect(progress.best).toBe(3000);
  });

  it("fato sem a métrica não mexe no recorde", () => {
    const { progress } = dobrar(condition, [fato("run.succeeded")]);
    expect(progress.best).toBeNull();
  });
});

describe("alvos e valores", () => {
  it("todo predicado sabe dizer o alvo e o valor atual", () => {
    const condicoes: Record<(typeof CONDITION_PREDICATES)[number], Condition> = {
      count: { predicate: "count", source: "task.completed", thresholds: [1, 5] },
      streak: { predicate: "streak", source: "run.succeeded", length: 3 },
      first: { predicate: "first", source: "run.succeeded" },
      set: {
        predicate: "set",
        source: "run.succeeded",
        dimension: "run.harness",
        values: ["a", "b"],
      },
      record: {
        predicate: "record",
        source: "run.succeeded",
        metric: "run.durationMs",
        direction: "max",
      },
    };

    for (const predicate of CONDITION_PREDICATES) {
      const condition = condicoes[predicate];
      expect(achievementTargets(condition).length).toBeGreaterThan(0);
      expect(achievementValue(condition, EMPTY_PROGRESS)).toBe(0);
      expect(tiersReached(condition, EMPTY_PROGRESS)).toBe(0);
    }

    expect(achievementTierCount(condicoes.count)).toBe(2);
    expect(achievementTierCount(condicoes.first)).toBe(1);
  });
});

describe("filtro e contrariedade", () => {
  it("filtro ausente casa com qualquer fato", () => {
    expect(matchesFilter(undefined, {})).toBe(true);
  });

  it("a contrariedade só vale dentro da mesma família", () => {
    expect(isContrarySource("run.succeeded", "run.failed")).toBe(true);
    expect(isContrarySource("run.succeeded", "run.succeeded")).toBe(false);
    expect(isContrarySource("run.succeeded", "task.completed")).toBe(false);
    expect(isContrarySource("approval.granted", "approval.rejected")).toBe(true);
    expect(isContrarySource("task.completed", "project.created")).toBe(false);
  });
});
