import { RUN_EVENT_PAGE_LIMIT, type RunEvent } from "@dungeon-master/contracts";
import { type EventsLogger, sanitizeJson } from "@dungeon-master/events";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import type { DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { runEvents, type RunEventRow, runs } from "./schema/run.js";

/**
 * O log append-only de execução, com os dois contratos de escrita do CLAUDE.md,
 * seção 9: `appendRunEvent` **nunca lança**, `persistRunEvent` propaga.
 *
 * A escolha entre os dois é consciente e não é estilo. Um evento de texto
 * incremental perdido custa uma linha na timeline; derrubar o Run por causa
 * dele custa a execução inteira. Já a linha que o worker precisa ter gravado
 * para poder continuar — a captura da sessão do harness, por exemplo — usa
 * `persistRunEvent`, e a falha sobe.
 */

export function toRunEvent(row: RunEventRow): RunEvent {
  return {
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    type: row.type,
    timestamp: row.timestamp.toISOString(),
    payload: row.payload,
  };
}

/** O que quem escreve um evento precisa informar. */
export interface RunEventInput {
  /** Tipo no vocabulário do `ExecutionEvent`. */
  readonly type: string;
  /** Quando o fato aconteceu. Padrão: agora. */
  readonly timestamp?: Date;
  /** Dados do evento. Passa pelo sanitizador de credenciais antes de persistir. */
  readonly payload?: unknown;
}

export interface WriteRunEventInput {
  userId: string;
  runId: string;
  event: RunEventInput;
  logger?: EventsLogger;
}

/**
 * Reserva a próxima `sequence` do Run, travando a linha do Run.
 *
 * O `FOR UPDATE` na linha de `run` é o que serializa duas escritas concorrentes
 * do mesmo Run — o worker e um evento de cancelamento vindo da API, por
 * exemplo. Sem ele, `MAX(sequence) + 1` calculado por duas transações daria o
 * mesmo número e a segunda quebraria no índice único.
 *
 * **Por que não uma sequência do PostgreSQL por Run.** Seria mais barato e
 * daria a garantia errada: sequências não voltam atrás em `ROLLBACK`, então uma
 * transação abortada deixaria um buraco permanente. A marca d'água do poller
 * (planejamento v0.4, Fase 2B) só avança até a primeira lacuna, e esperaria para
 * sempre por um evento que nunca existiu. Travar a linha do Run custa o
 * bloqueio de escritas concorrentes **do mesmo Run**, que já eram serializadas
 * na prática: quem produz eventos de um Run é um worker só.
 */
async function nextSequence(db: DatabaseExecutor, runId: string): Promise<number> {
  const lock = await db.execute<{ id: string }>(
    sql`select ${runs.id} from ${runs} where ${runs.id} = ${runId} for update`,
  );

  if (lock.rows.length === 0) {
    throw new Error(`Run ${runId} não existe: não há log a que acrescentar evento.`);
  }

  const [row] = await db
    .select({ maior: sql<number>`coalesce(max(${runEvents.sequence}), 0)` })
    .from(runEvents)
    .where(eq(runEvents.runId, runId));

  return Number(row?.maior ?? 0) + 1;
}

/**
 * Grava um evento dentro da transação de quem chama.
 *
 * Recebe um `DatabaseExecutor` porque as duas portas públicas abaixo abrem a
 * transação, e `writeRunTerminalStatus` acrescenta os eventos dele na mesma
 * transação do status.
 */
export async function insertRunEvent(
  db: DatabaseExecutor,
  input: WriteRunEventInput,
): Promise<RunEvent> {
  const sequence = await nextSequence(db, input.runId);

  // Todo payload passa pelo sanitizador antes de persistir (planejamento v0.4,
  // Fase 2B). O log é append-only: uma credencial que entrar fica.
  const payload = input.event.payload === undefined ? null : sanitizeJson(input.event.payload);

  const [row] = await db
    .insert(runEvents)
    .values({
      id: newId(),
      userId: input.userId,
      runId: input.runId,
      sequence,
      type: input.event.type,
      timestamp: input.event.timestamp ?? new Date(),
      // O jsonb é tipado como `unknown` deste lado: o vocabulário de payload é
      // do `ExecutionEvent`, e quem o fecha é o runtime.
      payload: payload as never,
    })
    .returning();

  if (row === undefined) throw new Error("A inserção em run_event não devolveu linha.");

  return toRunEvent(row);
}

/**
 * Grava um evento e **propaga** a falha.
 *
 * Use quando a execução não pode seguir sem a linha: sem ela, o worker estaria
 * continuando sobre um registro que ninguém tem.
 */
export async function persistRunEvent(db: Database, input: WriteRunEventInput): Promise<RunEvent> {
  return await db.transaction(async (tx) => insertRunEvent(tx, input));
}

/**
 * Grava um evento e **nunca lança**.
 *
 * Observabilidade pura. Devolve `null` quando não conseguiu gravar, e loga o
 * motivo — inclusive com o banco fora do ar. É o contrato que o caminho quente
 * do streaming usa: um `TextDelta` perdido custa uma linha da timeline; uma
 * exceção subindo daqui custaria o Run inteiro.
 */
export async function appendRunEvent(
  db: Database,
  input: WriteRunEventInput,
): Promise<RunEvent | null> {
  try {
    return await persistRunEvent(db, input);
  } catch (error) {
    input.logger?.warn?.(
      { err: error, runId: input.runId, type: input.event.type },
      "run_event_append_failed",
    );
    return null;
  }
}

export interface ListRunEventsInput {
  userId: string;
  runId: string;
  /** Cursor exclusivo: só eventos com `sequence` maior que este. */
  afterSequence: number;
  limit?: number;
}

/**
 * Os eventos posteriores a um cursor, em ordem crescente de `sequence`.
 *
 * É o drain do NOTIFY, o replay da reconexão e a leitura da rota de histórico:
 * os três usam esta consulta, então não existe uma segunda definição de "o que
 * o cliente perdeu".
 */
export async function listRunEventsSince(
  db: DatabaseExecutor,
  input: ListRunEventsInput,
): Promise<RunEvent[]> {
  const limit = Math.min(input.limit ?? RUN_EVENT_PAGE_LIMIT, RUN_EVENT_PAGE_LIMIT);

  const rows = await db
    .select()
    .from(runEvents)
    .where(
      and(
        eq(runEvents.userId, input.userId),
        eq(runEvents.runId, input.runId),
        gt(runEvents.sequence, input.afterSequence),
      ),
    )
    .orderBy(asc(runEvents.sequence))
    .limit(limit);

  return rows.map(toRunEvent);
}

/** A maior `sequence` já gravada para o Run, ou `0` se não houver nenhuma. */
export async function latestRunEventSequence(
  db: DatabaseExecutor,
  input: { runId: string },
): Promise<number> {
  const [row] = await db
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .where(eq(runEvents.runId, input.runId))
    .orderBy(desc(runEvents.sequence))
    .limit(1);

  return row?.sequence ?? 0;
}
