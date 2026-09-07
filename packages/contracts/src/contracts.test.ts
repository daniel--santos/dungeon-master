import { describe, expect, it } from "vitest";

import { HealthResponseSchema } from "./health.js";
import { PROBLEM_TYPE_BASE_URI, ProblemDetailsSchema } from "./problem-details.js";
import { UserSettingKeySchema, UserSettingSchema } from "./user-setting.js";

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
