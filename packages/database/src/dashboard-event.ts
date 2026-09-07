import type { DashboardEvent, DashboardEventType, JsonValue } from "@dungeon-master/contracts";
import { and, asc, eq, gt } from "drizzle-orm";

import type { Database } from "./client.js";
import { dashboardEvents, type DashboardEventRow } from "./schema/dashboard-event.js";

/**
 * A mesma API de escrita/leitura vale dentro e fora de uma transação.
 *
 * `PUT /api/v1/settings/{key}` grava a configuração e o evento na mesma
 * transação, então `appendDashboardEvent` precisa aceitar o `tx` do Drizzle
 * além do handle normal.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type DatabaseExecutor = Database | Transaction;

/** Teto de linhas por leitura, para uma reconexão antiga não puxar a tabela toda. */
export const DASHBOARD_EVENT_PAGE_LIMIT = 500;

export interface AppendDashboardEventInput {
  userId: string;
  /** Fechado na escrita: só os tipos que o sistema emite hoje. */
  type: DashboardEventType;
  payload: JsonValue;
}

export interface ListDashboardEventsInput {
  userId: string;
  /** Cursor exclusivo: devolve apenas eventos com `sequence` maior que este. */
  afterSequence: number;
  limit?: number;
}

/** Converte a linha do banco no contrato que vai para o SSE. */
export function toDashboardEvent(row: DashboardEventRow): DashboardEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Grava um evento e devolve a linha com a `sequence` que o banco atribuiu.
 *
 * Propaga o erro: quem chama decide o que fazer. O contrato que nunca lança
 * (`appendEvent`, seção 9 do CLAUDE.md) é do log de execução de Run, que ainda
 * não existe; um evento de dashboard perdido em silêncio deixaria a tela parada
 * sem nenhum sinal.
 *
 * O `NOTIFY` sai do trigger da migração `0001`, no COMMIT — não daqui.
 */
export async function appendDashboardEvent(
  db: DatabaseExecutor,
  input: AppendDashboardEventInput,
): Promise<DashboardEvent> {
  const [row] = await db
    .insert(dashboardEvents)
    .values({ userId: input.userId, type: input.type, payload: input.payload })
    .returning();

  if (row === undefined) {
    throw new Error("A inserção em dashboard_event não devolveu linha.");
  }

  return toDashboardEvent(row);
}

/**
 * Lê os eventos posteriores a um cursor, em ordem crescente de `sequence`.
 *
 * É o drain do padrão de notificação sem payload e também o replay da
 * reconexão: os dois usam exatamente esta consulta, então não existe uma
 * segunda definição de "o que o cliente perdeu".
 */
export async function listDashboardEventsSince(
  db: DatabaseExecutor,
  input: ListDashboardEventsInput,
): Promise<DashboardEvent[]> {
  const limit = Math.min(input.limit ?? DASHBOARD_EVENT_PAGE_LIMIT, DASHBOARD_EVENT_PAGE_LIMIT);

  const rows = await db
    .select()
    .from(dashboardEvents)
    .where(
      and(
        eq(dashboardEvents.userId, input.userId),
        gt(dashboardEvents.sequence, input.afterSequence),
      ),
    )
    .orderBy(asc(dashboardEvents.sequence))
    .limit(limit);

  return rows.map(toDashboardEvent);
}
