import { createApp } from "./app.js";

/**
 * Gera o documento OpenAPI sem subir servidor e sem tocar o banco.
 *
 * A checagem de banco é um stub porque a geração da spec só percorre as rotas
 * declaradas; nenhum handler é executado.
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  const app = createApp({
    probeDatabase: async () => ({ ok: true, latencyMs: 0, error: null }),
  });

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Dungeon Master API",
      version: "0.0.0",
      description:
        "Control Plane do Dungeon Master. Erros seguem a RFC 9457 " +
        "(`application/problem+json`). Todos os instantes são UTC.",
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    },
    servers: [{ url: "http://127.0.0.1:3333", description: "Desenvolvimento local" }],
    tags: [{ name: "system", description: "Saúde, versão e documentação." }],
  }) as unknown as Record<string, unknown>;
}
