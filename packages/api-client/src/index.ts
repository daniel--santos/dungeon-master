/**
 * `@dungeon-master/api-client` — cliente tipado gerado da spec OpenAPI.
 *
 * `openapi.json` e `src/schema.d.ts` são artefatos gerados e commitados. O CI
 * regenera e falha se houver diff (`pnpm gen:check`). Nunca edite os dois à
 * mão: mude os schemas em `@dungeon-master/contracts` ou as rotas em
 * `apps/api` e rode `pnpm gen`.
 *
 * Este é o único pacote de backend que `apps/web` pode importar como valor
 * (planejamento v0.4, seção 5), e a regra é aplicada por lint.
 */
import createClient, { type Client, type ClientOptions } from "openapi-fetch";

import type { paths } from "./schema.js";

export type { components, operations, paths } from "./schema.js";

export type ApiClient = Client<paths>;

/** Caminho base de toda rota. A versão faz parte da URL. */
export const API_BASE_PATH = "/api/v1" as const;

/**
 * Em desenvolvimento o Vite faz proxy de `/api` para a API, então o padrão é
 * relativo. Passe `baseUrl` para apontar para outra origem.
 */
export function createApiClient(options: ClientOptions = {}): ApiClient {
  return createClient<paths>({ baseUrl: "/", ...options });
}

export type HealthResponse =
  paths["/api/v1/health"]["get"]["responses"][200]["content"]["application/json"];

/** Busca a saúde da API. Lança quando a resposta não é 200. */
export async function fetchHealth(client: ApiClient): Promise<HealthResponse> {
  const { data, error, response } = await client.GET("/api/v1/health");

  if (error !== undefined || data === undefined) {
    throw new Error(`GET ${API_BASE_PATH}/health respondeu ${response.status}.`);
  }

  return data;
}
