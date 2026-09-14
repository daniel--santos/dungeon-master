import type { AutonomyLevel } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  allowsAutomation,
  AUTONOMY_MINIMUM_LEVEL,
  describeAutonomy,
  isAutonomyLevel,
} from "./autonomy-levels.js";

describe("allowsAutomation", () => {
  it("0 e 1 nunca automatizam; 1 só sugere", () => {
    expect(allowsAutomation(0, "SUGGEST")).toBe(false);
    expect(allowsAutomation(1, "SUGGEST")).toBe(true);
    for (const kind of ["AUTO_APPROVE_PROPOSAL", "AUTO_APPROVE_GATE", "AUTO_DISPATCH", "DELEGATE"] as const) {
      expect(allowsAutomation(0, kind)).toBe(false);
      expect(allowsAutomation(1, kind)).toBe(false);
    }
  });

  it("2 (o padrão) propõe e o humano decide: nada automático", () => {
    expect(describeAutonomy(2)).toEqual({
      SUGGEST: true,
      AUTO_APPROVE_PROPOSAL: false,
      AUTO_APPROVE_GATE: false,
      AUTO_DISPATCH: false,
      DELEGATE: false,
    });
  });

  it("3 libera propostas, gates e auto-despacho; delegação só no 4", () => {
    expect(describeAutonomy(3)).toEqual({
      SUGGEST: true,
      AUTO_APPROVE_PROPOSAL: true,
      AUTO_APPROVE_GATE: true,
      AUTO_DISPATCH: true,
      DELEGATE: false,
    });
    expect(describeAutonomy(4).DELEGATE).toBe(true);
  });

  it("fail-closed: nível fora da escada não libera nada", () => {
    expect(isAutonomyLevel(5)).toBe(false);
    expect(isAutonomyLevel(-1)).toBe(false);
    expect(isAutonomyLevel("3")).toBe(false);
    expect(allowsAutomation(5 as AutonomyLevel, "SUGGEST")).toBe(false);
    expect(allowsAutomation(9 as AutonomyLevel, "DELEGATE")).toBe(false);
  });

  it("a tabela é a única fonte: todo mínimo está na escada", () => {
    for (const minimo of Object.values(AUTONOMY_MINIMUM_LEVEL)) {
      expect(isAutonomyLevel(minimo)).toBe(true);
    }
  });
});
