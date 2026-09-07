import { describe, expect, it } from "vitest";

import { DashboardEventSchema, DashboardEventTypeSchema } from "./dashboard-event.js";
import { HealthResponseSchema } from "./health.js";
import { PROBLEM_TYPE_BASE_URI, ProblemDetailsSchema } from "./problem-details.js";
import {
  DEFAULT_USER_SETTINGS,
  isUserSettingsKey,
  USER_SETTING_VALUE_SCHEMAS,
  USER_SETTINGS_KEYS,
  UserSettingKeySchema,
  UserSettingSchema,
  UserSettingsSchema,
} from "./user-setting.js";

describe("HealthResponseSchema", () => {
  it("aceita uma resposta saudável", () => {
    const parsed = HealthResponseSchema.parse({
      status: "ok",
      service: "dungeon-master-api",
      version: "0.0.0",
      uptimeSeconds: 1.5,
      checkedAt: "2026-09-07T12:00:00.000Z",
      database: { ok: true, latencyMs: 3, error: null },
    });

    expect(parsed.database.ok).toBe(true);
  });

  it("rejeita status fora da união", () => {
    expect(() =>
      HealthResponseSchema.parse({
        status: "sick",
        service: "dungeon-master-api",
        version: "0.0.0",
        uptimeSeconds: 0,
        checkedAt: "2026-09-07T12:00:00.000Z",
        database: { ok: false, latencyMs: 0, error: "down" },
      }),
    ).toThrow();
  });
});

describe("ProblemDetailsSchema", () => {
  it("aceita um problema com lista de erros de validação", () => {
    const parsed = ProblemDetailsSchema.parse({
      type: `${PROBLEM_TYPE_BASE_URI}/validation-error`,
      title: "Requisição inválida",
      status: 400,
      detail: "O corpo da requisição não passou na validação.",
      instance: "/api/v1/health",
      errors: [{ path: "value", message: "Obrigatório", code: "invalid_type" }],
    });

    expect(parsed.errors).toHaveLength(1);
  });

  it("rejeita status HTTP fora da faixa", () => {
    expect(() =>
      ProblemDetailsSchema.parse({
        type: "about:blank",
        title: "x",
        status: 99,
        detail: "x",
        instance: "/",
      }),
    ).toThrow();
  });
});

describe("UserSettingSchema", () => {
  it("aceita valor JSON aninhado", () => {
    const parsed = UserSettingSchema.parse({
      userId: "01996d00-0000-7000-8000-000000000001",
      key: "ui.theme",
      value: { enabled: true, glossary: "dnd" },
      updatedAt: "2026-09-07T12:00:00.000Z",
    });

    expect(parsed.value).toEqual({ enabled: true, glossary: "dnd" });
  });

  it("rejeita chave com maiúsculas", () => {
    expect(() => UserSettingKeySchema.parse("UI.Theme")).toThrow();
  });
});

describe("DashboardEventSchema", () => {
  it("aceita um evento com payload arbitrário", () => {
    const parsed = DashboardEventSchema.parse({
      sequence: 42,
      type: "settings.changed",
      payload: { key: "ui.theme", value: "plain" },
      createdAt: "2026-09-07T12:00:00.000Z",
    });

    expect(parsed.sequence).toBe(42);
  });

  it("tolera na leitura um tipo que ainda não existe no enum de escrita", () => {
    const parsed = DashboardEventSchema.parse({
      sequence: 1,
      type: "achievement.unlocked",
      payload: null,
      createdAt: "2026-09-07T12:00:00.000Z",
    });

    expect(parsed.type).toBe("achievement.unlocked");
    expect(DashboardEventTypeSchema.safeParse("achievement.unlocked").success).toBe(false);
  });

  it("rejeita sequence zero ou negativo", () => {
    for (const sequence of [0, -1, 1.5]) {
      expect(
        DashboardEventSchema.safeParse({
          sequence,
          type: "system.ping",
          payload: null,
          createdAt: "2026-09-07T12:00:00.000Z",
        }).success,
      ).toBe(false);
    }
  });
});

describe("UserSettingsSchema", () => {
  it("os padrões passam no próprio schema", () => {
    expect(UserSettingsSchema.parse(DEFAULT_USER_SETTINGS)).toEqual({ "ui.theme": "dnd" });
  });

  it("toda chave conhecida tem schema de valor e padrão", () => {
    for (const key of USER_SETTINGS_KEYS) {
      expect(USER_SETTING_VALUE_SCHEMAS[key]).toBeDefined();
      expect(DEFAULT_USER_SETTINGS[key]).toBeDefined();
    }
    expect(USER_SETTINGS_KEYS).toEqual(Object.keys(DEFAULT_USER_SETTINGS));
  });

  it("isUserSettingsKey separa conhecida de desconhecida", () => {
    expect(isUserSettingsKey("ui.theme")).toBe(true);
    expect(isUserSettingsKey("ui.desconhecida")).toBe(false);
    // Não pode achar que herdou uma chave de Object.prototype.
    expect(isUserSettingsKey("toString")).toBe(false);
  });

  it("rejeita um tema fora da união", () => {
    expect(USER_SETTING_VALUE_SCHEMAS["ui.theme"].safeParse("neon").success).toBe(false);
  });
});
