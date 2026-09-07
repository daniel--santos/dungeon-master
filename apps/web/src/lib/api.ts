import { createApiClient } from "@dungeon-master/api-client";

/**
 * Único ponto de contato com o backend.
 *
 * A web importa somente `@dungeon-master/api-client` e tipos de
 * `@dungeon-master/contracts` (planejamento v0.4, seção 5). A regra é aplicada
 * pelo ESLint; se este import mudar para um pacote interno, o lint falha.
 *
 * A URL base é relativa: em desenvolvimento o Vite faz proxy de `/api` para a
 * API, e em produção a web é servida pela mesma origem.
 */
export const api = createApiClient();
