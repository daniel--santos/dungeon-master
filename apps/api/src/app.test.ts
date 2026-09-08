import { HealthResponseSchema, ProblemDetailsSchema } from "@dungeon-master/contracts";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { API_BASE_PATH } from "./config.js";
import { buildOpenApiDocument } from "./openapi.js";
import { createSpecPorts } from "./ports.js";
import { PROBLEM_CONTENT_TYPE } from "./problem.js";

function appWithDatabase(ok: boolean) {
  return createApp({
    // As portas de evento e de configuração são inertes: estes testes só
    // exercitam `/health`, e uma chamada acidental a elas lança em vez de
    // passar por acidente. Os caminhos com banco estão em `test/`.
    ...createSpecPorts(),
    probeDatabase: async () => ({
      ok,
      latencyMs: 1,
      error: ok ? null : "connection refused",
    }),
  });
}

describe(`GET ${API_BASE_PATH}/health`, () => {
  it("responde 200 e ok com o banco no ar", async () => {
    const response = await appWithDatabase(true).request(`${API_BASE_PATH}/health`);

    expect(response.status).toBe(200);

    const body = HealthResponseSchema.parse(await response.json());
    expect(body.status).toBe("ok");
    expect(body.database.ok).toBe(true);
    expect(body.service).toBe("dungeon-master-api");
  });

  it("responde 200 e degraded com o banco fora", async () => {
    const response = await appWithDatabase(false).request(`${API_BASE_PATH}/health`);

    expect(response.status).toBe(200);

    const body = HealthResponseSchema.parse(await response.json());
    expect(body.status).toBe("degraded");
    expect(body.database.error).toBe("connection refused");
  });

  it("carrega um requestId em toda resposta", async () => {
    const response = await appWithDatabase(true).request(`${API_BASE_PATH}/health`);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("erros", () => {
  it("rota inexistente vira problem details 404", async () => {
    const response = await appWithDatabase(true).request("/api/v1/nao-existe");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.status).toBe(404);
    expect(problem.instance).toBe("/api/v1/nao-existe");
    expect(problem.requestId).toBeTruthy();
  });

  it("corpo que não é JSON válido vira 400, e não 500", async () => {
    // O Hono levanta `HTTPException(400)` no parser de corpo, antes de qualquer
    // handler nosso rodar. Sem honrar o status dela, um corpo malformado saía
    // como "erro interno" e o cliente ficava sem saber que bastava corrigir o
    // JSON — o servidor levava a culpa por um erro da requisição.
    const response = await appWithDatabase(true).request(`${API_BASE_PATH}/settings/theme`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: '{"value": ',
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(PROBLEM_CONTENT_TYPE);

    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.status).toBe(400);
    expect(problem.type).toContain("validation-error");
    // O `detail` diz o que houve: uma mensagem do framework sobre a requisição
    // é informação do cliente, não do servidor.
    expect(problem.detail.toLowerCase()).toContain("json");
    expect(problem.requestId).toBeTruthy();
  });

  it("uma HTTPException 5xx não vaza a mensagem interna", async () => {
    const app = appWithDatabase(true);
    app.get("/api/v1/explode", () => {
      throw new HTTPException(503, { message: "postgres primary unreachable at 10.0.0.7" });
    });

    const response = await app.request("/api/v1/explode");

    expect(response.status).toBe(503);
    const problem = ProblemDetailsSchema.parse(await response.json());
    expect(problem.detail).not.toContain("10.0.0.7");
    expect(problem.detail).toContain("requestId");
  });
});

describe("spec OpenAPI", () => {
  it("é servida em /api/v1/openapi.json", async () => {
    const response = await appWithDatabase(true).request(`${API_BASE_PATH}/openapi.json`);

    expect(response.status).toBe(200);

    const document = (await response.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toContain(`${API_BASE_PATH}/health`);
  });

  it("é gerada sem subir servidor", () => {
    const document = buildOpenApiDocument();
    const paths = document["paths"] as Record<string, unknown>;

    expect(document["openapi"]).toBe("3.1.0");
    expect(Object.keys(paths)).toContain(`${API_BASE_PATH}/health`);
  });

  it("a UI de documentação responde em /api/v1/docs", async () => {
    const response = await appWithDatabase(true).request(`${API_BASE_PATH}/docs`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
