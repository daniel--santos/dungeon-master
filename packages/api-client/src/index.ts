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

import type { components, paths } from "./schema.js";

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

export type ProblemDetails = components["schemas"]["ProblemDetails"];
export type UserSettings = components["schemas"]["UserSettings"];
export type UiTheme = components["schemas"]["UiTheme"];
export type DashboardEvent = components["schemas"]["DashboardEvent"];

/** Caminho do stream SSE. A web abre com `EventSource`, não pelo cliente gerado. */
export const EVENTS_STREAM_PATH = `${API_BASE_PATH}/events/stream` as const;

/**
 * Transforma um erro da API na mensagem que a tela mostra.
 *
 * Todo erro vem em `application/problem+json` (RFC 9457), então o `detail` já é
 * a explicação daquela ocorrência específica. O `status` entra como último
 * recurso, para nunca sobrar um "algo deu errado" sem informação nenhuma.
 */
function describeProblem(problem: unknown, status: number, fallback: string): string {
  if (typeof problem === "object" && problem !== null) {
    const detail = (problem as Partial<ProblemDetails>).detail;
    if (typeof detail === "string" && detail !== "") return detail;
  }
  return `${fallback} (HTTP ${String(status)})`;
}

/** Lê as configurações do usuário, já com os padrões aplicados. */
export async function fetchSettings(client: ApiClient): Promise<UserSettings> {
  const result = await client.GET("/api/v1/settings");

  if (result.data === undefined) {
    throw new Error(
      describeProblem(
        result.error,
        result.response.status,
        "Não foi possível ler as configurações",
      ),
    );
  }

  return result.data;
}

/**
 * Grava uma configuração e devolve o objeto completo já atualizado.
 *
 * A API responde com todas as chaves, então a tela não precisa de uma segunda
 * ida ao servidor para se atualizar.
 */
export async function updateSetting(
  client: ApiClient,
  key: string,
  value: unknown,
): Promise<UserSettings> {
  const result = await client.PUT("/api/v1/settings/{key}", {
    params: { path: { key } },
    body: { value },
  });

  if (result.data === undefined) {
    throw new Error(
      describeProblem(
        result.error,
        result.response.status,
        `Não foi possível gravar a configuração ${key}`,
      ),
    );
  }

  return result.data;
}

/** Grava um `system.ping`. Existe só para verificar o caminho do SSE à mão. */
export async function sendPing(client: ApiClient): Promise<DashboardEvent> {
  const result = await client.POST("/api/v1/events/ping");

  if (result.data === undefined) {
    throw new Error(
      describeProblem(result.error, result.response.status, "Não foi possível gravar o ping"),
    );
  }

  return result.data.event;
}
