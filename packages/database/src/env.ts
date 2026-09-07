/**
 * A URL do banco vem sempre de `DATABASE_URL`.
 *
 * Quando a variável não está definida, cai no banco de desenvolvimento do
 * `docker-compose.yml` na raiz do repositório, para que
 * `docker compose up -d db && pnpm db:migrate` funcione sem configuração.
 * Testes e CI nunca passam por aqui: recebem a URL do `embedded-postgres`.
 */

export const DEFAULT_DATABASE_URL =
  "postgresql://dungeon:dungeon@127.0.0.1:5433/dungeon_master" as const;

export interface ResolveDatabaseUrlOptions {
  /** De onde ler a variável. Padrão: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Suprime o aviso quando o padrão de desenvolvimento é usado. */
  silent?: boolean;
}

export function resolveDatabaseUrl(options: ResolveDatabaseUrlOptions = {}): string {
  const env = options.env ?? process.env;
  const fromEnv = env["DATABASE_URL"]?.trim();

  if (fromEnv) {
    return fromEnv;
  }

  if (!options.silent) {
    console.warn(
      `[database] DATABASE_URL não definida; usando o banco de desenvolvimento ${DEFAULT_DATABASE_URL}`,
    );
  }

  return DEFAULT_DATABASE_URL;
}
