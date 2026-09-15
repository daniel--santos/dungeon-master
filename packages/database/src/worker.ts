import type { WorkerHarness, WorkerPresence, WorkerStatus } from "@dungeon-master/contracts";
import { WORKER_STALE_INTERVALS } from "@dungeon-master/contracts";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { type RunRow, runs } from "./schema/run.js";
import { type WorkerRow, workers } from "./schema/worker.js";

/**
 * Presença de Worker por batimento (planejamento v0.4, Fase 10A).
 *
 * Fecha a pendência que o post-mortem #6 deixou registrada em
 * `apps/worker/src/reconcile.ts`: sem lease, um Worker de outra máquina era
 * indistinguível de um morto, e a reconciliação de partida só conseguia
 * adivinhar olhando o PID quando o host coincidia. Agora cada processo tem
 * linha própria, renova `last_heartbeat_at` a cada intervalo e escreve
 * `stopped_at` ao se despedir — e "este Run tem dono vivo?" vira uma pergunta
 * que o banco responde, de qualquer máquina.
 *
 * O estado nunca é coluna: `ONLINE`, `STALE` e `OFFLINE` saem da subtração de
 * dois instantes na leitura. `stale_at` existe para outra coisa — marcar que o
 * silêncio já foi **anunciado** —, e é ela que faz `worker.stale` sair uma vez
 * só mesmo com vários Workers vivos varrendo a tabela ao mesmo tempo.
 */

/** Silêncio que torna um Worker `STALE`: três intervalos de batimento. */
export function staleAfterMs(heartbeatIntervalMs: number): number {
  return heartbeatIntervalMs * WORKER_STALE_INTERVALS;
}

export function workerStatusOf(
  row: Pick<WorkerRow, "stoppedAt" | "lastHeartbeatAt">,
  input: { now: Date; staleAfterMs: number },
): WorkerStatus {
  if (row.stoppedAt !== null) return "OFFLINE";
  const silencio = input.now.getTime() - row.lastHeartbeatAt.getTime();
  return silencio > input.staleAfterMs ? "STALE" : "ONLINE";
}

export interface RegisterWorkerInput {
  userId: string;
  workerId: string;
  hostname: string;
  pid: number;
  version: string;
  nodeVersion: string;
  capacity: number;
  harnesses: readonly WorkerHarness[];
}

/**
 * Grava a linha deste processo e anuncia que ele subiu.
 *
 * `on conflict` porque o id é o `workerId`, e um processo que reinicia com o
 * mesmo id — o que não acontece hoje, já que `newWorkerId()` sorteia um UUID —
 * precisa reaparecer vivo em vez de esbarrar na chave primária. O `stale_at` e
 * o `stopped_at` voltam a nulo: quem está subindo agora não está nem parado nem
 * silencioso.
 */
export async function registerWorker(db: Database, input: RegisterWorkerInput): Promise<void> {
  await db.transaction(async (tx) => {
    const agora = new Date();

    await tx
      .insert(workers)
      .values({
        id: input.workerId,
        userId: input.userId,
        hostname: input.hostname,
        pid: input.pid,
        version: input.version,
        nodeVersion: input.nodeVersion,
        capacity: input.capacity,
        harnesses: [...input.harnesses],
        startedAt: agora,
        lastHeartbeatAt: agora,
        stoppedAt: null,
        staleAt: null,
      })
      .onConflictDoUpdate({
        target: workers.id,
        set: {
          hostname: input.hostname,
          pid: input.pid,
          version: input.version,
          nodeVersion: input.nodeVersion,
          capacity: input.capacity,
          harnesses: [...input.harnesses],
          startedAt: agora,
          lastHeartbeatAt: agora,
          stoppedAt: null,
          staleAt: null,
        },
      });

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "worker.online",
      payload: {
        workerId: input.workerId,
        hostname: input.hostname,
        pid: input.pid,
        capacity: input.capacity,
      },
    });
  });
}

/**
 * Renova o batimento.
 *
 * Devolve `true` quando o Worker estava **anunciado como silencioso** e voltou:
 * um processo que ficou sem CPU por meio minuto é marcado `STALE` pelo colega,
 * e quando ele volta a bater o painel precisa saber. Quem chama emite o
 * `worker.online` da ressurreição.
 *
 * O `returning` do `UPDATE` traria o valor novo (nulo), então o estado anterior
 * é lido na mesma transação, antes de escrever.
 */
export async function heartbeatWorker(
  db: Database,
  input: { userId: string; workerId: string },
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [antes] = await tx
      .select({ staleAt: workers.staleAt })
      .from(workers)
      .where(and(eq(workers.id, input.workerId), eq(workers.userId, input.userId)));

    if (antes === undefined) return false;

    await tx
      .update(workers)
      .set({ lastHeartbeatAt: new Date(), staleAt: null, stoppedAt: null })
      .where(and(eq(workers.id, input.workerId), eq(workers.userId, input.userId)));

    if (antes.staleAt === null) return false;

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "worker.online",
      payload: { workerId: input.workerId, resumed: true },
    });

    return true;
  });
}

/** Grava o desligamento gracioso e anuncia. Idempotente. */
export async function stopWorker(
  db: Database,
  input: { userId: string; workerId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workers)
      .set({ stoppedAt: new Date() })
      .where(
        and(
          eq(workers.id, input.workerId),
          eq(workers.userId, input.userId),
          isNull(workers.stoppedAt),
        ),
      )
      .returning({ id: workers.id });

    // Sem linha afetada, o desligamento já foi gravado: nada a anunciar de novo.
    if (row === undefined) return;

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "worker.offline",
      payload: { workerId: input.workerId },
    });
  });
}

export interface StaleWorker {
  readonly id: string;
  readonly hostname: string;
  readonly pid: number;
  readonly lastHeartbeatAt: string;
}

/**
 * Marca e anuncia os Workers que pararam de bater.
 *
 * O `UPDATE ... WHERE stale_at IS NULL ... RETURNING` **é** a idempotência:
 * dois Workers vivos varrendo ao mesmo tempo disputam a mesma linha, e só o que
 * ganhar a trava recebe a linha de volta — o outro vê zero e não anuncia nada.
 * Sem isso, cada Worker vivo emitiria um `worker.stale` por tique para o mesmo
 * colega morto.
 */
export async function markStaleWorkers(
  db: Database,
  input: { userId: string; staleAfterMs: number; now?: Date },
): Promise<StaleWorker[]> {
  const agora = input.now ?? new Date();
  const limite = new Date(agora.getTime() - input.staleAfterMs);

  return await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      hostname: string;
      pid: number;
      last_heartbeat_at: Date;
    }>(
      sql`update worker
          set stale_at = ${agora}::timestamptz, updated_at = now()
          where user_id = ${input.userId}::uuid
            and stopped_at is null
            and stale_at is null
            and last_heartbeat_at < ${limite}::timestamptz
          returning id, hostname, pid, last_heartbeat_at`,
    );

    const marcados = rows.map((row) => ({
      id: row.id,
      hostname: row.hostname,
      pid: row.pid,
      lastHeartbeatAt: new Date(row.last_heartbeat_at).toISOString(),
    }));

    for (const worker of marcados) {
      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "worker.stale",
        payload: {
          workerId: worker.id,
          hostname: worker.hostname,
          pid: worker.pid,
          lastHeartbeatAt: worker.lastHeartbeatAt,
        },
      });
    }

    return marcados;
  });
}

/**
 * Os Runs em `PREPARING`/`RUNNING` cujo dono não está vivo.
 *
 * Três motivos, e nenhum deles é "o `claimed_by` é diferente do meu":
 *
 * 1. **Sem linha em `worker`.** Run reclamado antes desta migração, ou por um
 *    processo de uma versão anterior. É o comportamento antigo como fallback —
 *    e é também por isso que `worker.id` reusa o `workerId`.
 * 2. **`stopped_at` preenchido.** O dono se despediu sem fechar o Run; ninguém
 *    mais vai escrever o desfecho dele.
 * 3. **Silencioso.** Passou de {@link WORKER_STALE_INTERVALS} intervalos sem
 *    bater. É o caso do `kill -9`.
 *
 * Um Worker **vivo** nunca perde um Run para outro que sobe, e essa é a
 * regressão que o post-mortem #6 registrou. Por isso a varredura roda também no
 * tique, e não só na partida: o sobrevivente fecha o que o colega morto deixou
 * sem precisar ser reiniciado.
 */
export async function listRunRowsWithDeadWorker(
  db: DatabaseExecutor,
  input: { userId: string; workerId: string; staleAfterMs: number; now?: Date },
): Promise<RunRow[]> {
  const agora = input.now ?? new Date();
  const limite = new Date(agora.getTime() - input.staleAfterMs);

  const rows = await db
    .select({ run: runs })
    .from(runs)
    .leftJoin(workers, and(eq(workers.id, runs.claimedBy), eq(workers.userId, runs.userId)))
    .where(
      and(
        eq(runs.userId, input.userId),
        inArray(runs.status, ["PREPARING", "RUNNING"]),
        sql`(${runs.claimedBy} is null or ${runs.claimedBy} <> ${input.workerId})`,
        sql`(${workers.id} is null
             or ${workers.stoppedAt} is not null
             or ${workers.lastHeartbeatAt} < ${limite}::timestamptz)`,
      ),
    )
    .orderBy(runs.createdAt, runs.id);

  return rows.map((row) => row.run);
}

export interface ListWorkerPresenceInput {
  userId: string;
  staleAfterMs: number;
  now?: Date;
}

/**
 * Os Workers conhecidos, com o estado calculado e quantos Runs cada um segura.
 *
 * `runningRuns` conta os Runs que **ainda apontam** para o Worker, mesmo depois
 * de ele morrer: é justamente esse número que a reconciliação vai zerar, e
 * escondê-lo esconderia o trabalho preso.
 */
export async function listWorkerPresence(
  db: DatabaseExecutor,
  input: ListWorkerPresenceInput,
): Promise<WorkerPresence[]> {
  const agora = input.now ?? new Date();

  const rows = await db
    .select({
      worker: workers,
      // A referência à coluna de fora vai **qualificada e crua**. Interpolar a
      // coluna do Drizzle aqui produz `"id"` sem tabela, e dentro da subconsulta
      // `"id"` resolve para `r.id` — um `uuid` comparado com o `text` de
      // `claimed_by`, que o PostgreSQL recusa com "operator does not exist".
      runningRuns: sql<number>`(
        select count(*)::int from run r
        where r.user_id = ${input.userId}::uuid
          and r.claimed_by = ${sql.raw(`"worker"."id"`)}
          and r.status in ('PREPARING', 'RUNNING')
      )`,
    })
    .from(workers)
    .where(eq(workers.userId, input.userId))
    .orderBy(workers.stoppedAt, sql`${workers.lastHeartbeatAt} desc`, workers.id);

  return rows.map((row) => ({
    id: row.worker.id,
    hostname: row.worker.hostname,
    pid: row.worker.pid,
    version: row.worker.version,
    nodeVersion: row.worker.nodeVersion,
    capacity: row.worker.capacity,
    harnesses: row.worker.harnesses,
    startedAt: row.worker.startedAt.toISOString(),
    lastHeartbeatAt: row.worker.lastHeartbeatAt.toISOString(),
    stoppedAt: row.worker.stoppedAt?.toISOString() ?? null,
    staleAt: row.worker.staleAt?.toISOString() ?? null,
    status: workerStatusOf(row.worker, { now: agora, staleAfterMs: input.staleAfterMs }),
    runningRuns: row.runningRuns,
  }));
}

export interface WorkerCounts {
  readonly online: number;
  readonly stale: number;
  readonly offline: number;
}

/** Quantos Workers em cada estado, para os tiles do painel. */
export async function countWorkersByStatus(
  db: DatabaseExecutor,
  input: ListWorkerPresenceInput,
): Promise<WorkerCounts> {
  const agora = input.now ?? new Date();

  const rows = await db
    .select({ stoppedAt: workers.stoppedAt, lastHeartbeatAt: workers.lastHeartbeatAt })
    .from(workers)
    .where(eq(workers.userId, input.userId));

  const contagem = { online: 0, stale: 0, offline: 0 };

  for (const row of rows) {
    const status = workerStatusOf(row, { now: agora, staleAfterMs: input.staleAfterMs });
    if (status === "ONLINE") contagem.online += 1;
    else if (status === "STALE") contagem.stale += 1;
    else contagem.offline += 1;
  }

  return contagem;
}
