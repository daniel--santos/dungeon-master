// Adapted from Archon — packages/core/src/utils/credential-sanitizer.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: a lista de variáveis sensíveis passou a incluir as chaves de API dos
// harnesses (Anthropic, OpenAI, Google) além dos tokens de git, porque aqui o
// alvo é o payload de evento de um agente e não a saída de um `git clone`;
// entrou `sanitizeJson`, que aplica a mesma função a todo texto de uma
// estrutura JSON, que é a forma em que os payloads chegam; a lista de nomes
// deixou de ser constante do módulo e virou parâmetro opcional, para o teste
// não depender do ambiente do processo. Mensagens e comentários em português.

/**
 * Remove credenciais de texto antes de ele virar linha de `run_event`.
 *
 * Todo payload de evento passa por aqui (planejamento v0.4, Fase 2B). O agente
 * roda no host com o ambiente do usuário, e a saída dele — stderr de um `git
 * push`, o eco de um comando, uma mensagem de erro de API — é exatamente onde
 * um token aparece por acidente. O log é append-only: uma credencial que entrar
 * fica.
 */

/**
 * As variáveis cujo **valor** é procurado e substituído.
 *
 * Procurar o valor, e não o nome, é o que pega o token no meio de uma frase
 * qualquer. A lista cobre os tokens de git do original mais as chaves de API
 * que os harnesses usam.
 */
export const SENSITIVE_ENV_VARS = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITLAB_TOKEN",
  "GITEA_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
] as const;

export const REDACTED = "[REDACTED]" as const;

/**
 * Valores curtos demais não são procurados.
 *
 * Uma variável definida como `1` ou `true` transformaria todo dígito `1` do
 * payload em `[REDACTED]`, o que destruiria o log inteiro para proteger nada.
 */
export const MIN_SECRET_LENGTH = 8;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface SanitizeOptions {
  /** Nomes das variáveis a procurar. Padrão: `SENSITIVE_ENV_VARS`. */
  readonly variables?: readonly string[];
  /** De onde os valores são lidos. Padrão: `process.env`. */
  readonly env?: Record<string, string | undefined>;
}

export function sanitizeCredentials(input: string, options: SanitizeOptions = {}): string {
  const env = options.env ?? process.env;
  const variables = options.variables ?? SENSITIVE_ENV_VARS;

  let result = input;

  for (const name of variables) {
    const value = env[name];
    if (value === undefined || value.length < MIN_SECRET_LENGTH) continue;
    result = result.replace(new RegExp(escapeRegExp(value), "g"), REDACTED);
  }

  // Pega a credencial embutida numa URL que passou pelas variáveis: desde o
  // Archon #1658, URLs de clone podem embutir token em qualquer host
  // (`oauth2:<token>@gitlab.example.com`, `<token>@gitea.example.com`), então o
  // que é apagado é o `userinfo` inteiro — o próprio usuário pode ser o token —
  // preservando esquema e host, que são o que ajuda a diagnosticar. `[^@/\s]+`
  // não atravessa `/`, então URL sem credencial fica intacta.
  result = result.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@/\s]+@/g, `$1${REDACTED}@`);

  return result;
}

/** Um `Error` novo, com mensagem e stack já limpos. */
export function sanitizeError(error: Error, options: SanitizeOptions = {}): Error {
  const sanitized = new Error(sanitizeCredentials(error.message, options));
  if (error.stack !== undefined) {
    sanitized.stack = sanitizeCredentials(error.stack, options);
  }
  return sanitized;
}

/**
 * Aplica o sanitizador a todo texto de uma estrutura JSON.
 *
 * É a forma que os payloads de `run_event` têm: objetos aninhados com strings
 * espalhadas. Chaves também são limpas — um objeto indexado por caminho de
 * arquivo pode ter o token na chave — e a profundidade é limitada para uma
 * estrutura cíclica ou absurdamente aninhada não travar o worker.
 */
export const MAX_SANITIZE_DEPTH = 32;

export function sanitizeJson(value: unknown, options: SanitizeOptions = {}, depth = 0): unknown {
  if (typeof value === "string") return sanitizeCredentials(value, options);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_SANITIZE_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item, options, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[sanitizeCredentials(key, options)] = sanitizeJson(item, options, depth + 1);
  }
  return result;
}
