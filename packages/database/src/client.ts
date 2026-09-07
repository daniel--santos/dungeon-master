import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { resolveDatabaseUrl } from "./env.js";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: Pool;
  /** Fecha o pool. Idempotente. */
  close: () => Promise<void>;
}

export interface CreateDatabaseOptions {
  /** URL de conexão. Padrão: `DATABASE_URL`. */
  url?: string;
  /** Tamanho máximo do pool. */
  max?: number;
  /** Aparece em `pg_stat_activity`, o que ajuda a separar API de Worker. */
  applicationName?: string;
  /** Milissegundos até desistir de abrir a conexão. */
  connectionTimeoutMillis?: number;
}

/**
 * Abre o pool e devolve o cliente Drizzle.
 *
 * Toda sessão é fixada em UTC. As colunas são `timestamptz`, então o valor
 * gravado independe do fuso, mas fixar a sessão mantém logs e `now()` legíveis
 * e iguais em Windows e macOS.
 */
export function createDatabase(options: CreateDatabaseOptions = {}): DatabaseHandle {
  const connectionString = options.url ?? resolveDatabaseUrl();

  const config: PoolConfig = {
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
    application_name: options.applicationName ?? "dungeon-master",
    // Fixa o fuso da sessão no handshake da conexão, em vez de emitir um
    // `SET TIME ZONE` depois. Evita um round-trip por conexão nova e não
    // disputa a fila de consultas do cliente.
    options: "-c timezone=UTC",
  };

  const pool = new Pool(config);

  // Sem este listener, um erro em conexão ociosa derruba o processo.
  pool.on("error", (error) => {
    console.error("[database] erro em conexão ociosa do pool:", error);
  });

  const db = drizzle(pool, { schema });

  let closed = false;

  return {
    db,
    pool,
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
