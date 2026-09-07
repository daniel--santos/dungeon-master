import { describe, expect, it, vi } from "vitest";

import { API_BASE_PATH, createApiClient, fetchHealth } from "./index.js";

describe("createApiClient", () => {
  it("chama o caminho versionado do health", async () => {
    const requested: string[] = [];

    const fetchMock = vi.fn(async (input: Request) => {
      requested.push(input.url);
      return Response.json({
        status: "ok",
        service: "dungeon-master-api",
        version: "0.0.0",
        uptimeSeconds: 1,
        checkedAt: "2026-09-07T12:00:00.000Z",
        database: { ok: true, latencyMs: 1, error: null },
      });
    });

    const client = createApiClient({
      baseUrl: "http://127.0.0.1:3333",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const health = await fetchHealth(client);

    expect(health.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requested).toHaveLength(1);
    expect(new URL(requested[0] ?? "").pathname).toBe(`${API_BASE_PATH}/health`);
  });

  it("lança quando a API responde erro", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 500 }), {
          status: 500,
          headers: { "content-type": "application/problem+json" },
        }),
    );

    const client = createApiClient({
      baseUrl: "http://127.0.0.1:3333",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(fetchHealth(client)).rejects.toThrow("respondeu 500");
  });
});
