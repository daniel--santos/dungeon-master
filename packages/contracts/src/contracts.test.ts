import { describe, expect, it } from "vitest";

import {
  DASHBOARD_EVENT_TYPE_VALUES,
  DashboardEventSchema,
  DashboardEventTypeSchema,
} from "./dashboard-event.js";
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

  it("rejeita chave que começa em maiúscula", () => {
    expect(() => UserSettingKeySchema.parse("UI.Theme")).toThrow();
    expect(() => UserSettingKeySchema.parse("Execution.hostAcknowledged")).toThrow();
  });

  it("aceita camelCase depois do primeiro caractere", () => {
    expect(UserSettingKeySchema.parse("execution.hostAcknowledged")).toBe(
      "execution.hostAcknowledged",
    );
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
    // O exemplo é sintético de propósito, e nasce checado contra o vocabulário
    // real: um nome de fase futura envelhece mal. `achievement.unlocked` entrou
    // no enum na Fase 2.5 e fez o teste afirmar o contrário do que verifica;
    // `approval.granted`, que o substituiu, nunca existiu — a Fase 4 emitiu
    // `approval.requested` e `approval.resolved` —, e a segunda asserção parou
    // de dizer algo sobre o vocabulário. Com a primeira asserção, o dia em que
    // este nome virar um tipo de verdade é o dia em que o teste quebra.
    const tipoAusente = "test.tipo_fora_do_enum";
    expect(DASHBOARD_EVENT_TYPE_VALUES).not.toContain(tipoAusente);

    const parsed = DashboardEventSchema.parse({
      sequence: 1,
      type: tipoAusente,
      payload: null,
      createdAt: "2026-09-07T12:00:00.000Z",
    });

    expect(parsed.type).toBe(tipoAusente);
    expect(DashboardEventTypeSchema.safeParse(tipoAusente).success).toBe(false);
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
    const parsed = UserSettingsSchema.parse(DEFAULT_USER_SETTINGS);

    expect(parsed["ui.theme"]).toBe("dnd");
    // O aceite do modo host nasce falso: o aviso aparece na primeira Expedição.
    expect(parsed["execution.hostAcknowledged"]).toBe(false);
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
