import { sql } from "drizzle-orm";

import type { Database } from "./client.js";

export interface DatabasePingResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error: string | null;
}

/**
 * `SELECT 1` com medição de latência. Nunca lança: o health check reporta a
 * falha em vez de virar 500, para que a API continue respondendo `degraded`.
 */
export async function pingDatabase(db: Database): Promise<DatabasePingResult> {
  const startedAt = Date.now();

  try {
    const result = await db.execute<{ ok: number }>(sql`select 1 as ok`);
    const first = result.rows[0];
    const ok = first?.ok === 1 || String(first?.ok) === "1";

    return {
      ok,
      latencyMs: Date.now() - startedAt,
      error: ok ? null : "A consulta `SELECT 1` respondeu um valor inesperado.",
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
