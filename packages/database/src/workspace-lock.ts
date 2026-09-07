import { isTerminalRunStatus } from "@dungeon-master/domain";
import { and, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import type { DatabaseExecutor } from "./dashboard-event.js";
import { type RunRow, runs, type WorkspaceLockRow, workspaceLocks } from "./schema/run.js";

/**
 * Um Run ativo por par (repositório, caminho de checkout).
 *
 * O Sandcastle projetou o locking de worktree (ADR 0007) e **não o
 * implementou**: dois `run()` concorrentes com a mesma branch nomeada recebem o
 * mesmo diretório e corrompem em silêncio (documento técnico, seção 16). A
 * trava é nossa, mora no PostgreSQL e é conferida **antes de qualquer processo
 * subir**.
 *
 * A chave primária composta é a trava em si: não existe janela entre
 * "verifiquei" e "peguei", porque a verificação **é** a inserção.
 *
 * ## O desempate
 *
 * Duas coisas nunca acontecem: um Run que já começou perde a trava, e a mesma
 * trava é dada a dois Runs. Fora isso, o desempate é **determinístico e não
 * depende de quem chegou primeiro**:
 *
 * 1. Trava livre → quem pediu leva.
 * 2. Trava do próprio Run → idempotente, leva de novo.
 * 3. Trava de um Run terminal, ou de um Run que não existe mais → obsoleta, é
 *    recuperada.
 * 4. Trava de um Run que **ainda não começou** (`started_at IS NULL`) → vence o
 *    Run de `id` menor. Como os ids são UUIDv7, isso é "o Run criado primeiro
 *    vence", e o resultado final é o mesmo qualquer que tenha sido a ordem de
 *    chegada das duas transações.
 * 5. Trava de um Run que já começou → recusa, dizendo quem segura.
 *
 * O caso 4 é a única forma de um Run perder uma trava que pegou, e só acontece
 * durante a preparação dele. Por isso o contrato com o worker é: **confirmar a
 * posse com `getActiveRunByPath` imediatamente antes de subir o processo**. É
 * uma leitura barata que fecha a única janela que sobra.
 */

export interface WorkspaceLock {
  readonly repoPath: string;
  readonly checkoutPath: string;
  readonly runId: string;
  readonly acquiredAt: string;
}

export function toWorkspaceLock(row: WorkspaceLockRow): WorkspaceLock {
  return {
    repoPath: row.repoPath,
    checkoutPath: row.checkoutPath,
    runId: row.runId,
    acquiredAt: row.acquiredAt.toISOString(),
  };
}

export interface AcquireWorkspaceLockInput {
  userId: string;
  /** Raiz do repositório. Já normalizado por `normalizeAbsolutePath`. */
  repoPath: string;
  /** Diretório em que o agente vai trabalhar. Igual a `repoPath` na estratégia `CURRENT`. */
  checkoutPath: string;
  runId: string;
}

export type AcquireWorkspaceLockResult =
  | { readonly acquired: true; readonly lock: WorkspaceLock; readonly reclaimed: boolean }
  | {
      readonly acquired: false;
      readonly heldBy: string;
      readonly heldSince: string;
      readonly reason: "RUNNING" | "OLDER_RUN_WINS";
    };

async function loadLockRow(
  db: DatabaseExecutor,
  input: { repoPath: string; checkoutPath: string },
): Promise<WorkspaceLockRow | null> {
  const [row] = await db
    .select()
    .from(workspaceLocks)
    .where(
      and(
        eq(workspaceLocks.repoPath, input.repoPath),
        eq(workspaceLocks.checkoutPath, input.checkoutPath),
      ),
    )
    .for("update");

  return row ?? null;
}

/** Toma a trava para outro Run, dentro da seção crítica já aberta. */
async function takeOver(
  db: DatabaseExecutor,
  input: AcquireWorkspaceLockInput,
): Promise<WorkspaceLockRow> {
  const [row] = await db
    .update(workspaceLocks)
    .set({ userId: input.userId, runId: input.runId, acquiredAt: new Date() })
    .where(
      and(
        eq(workspaceLocks.repoPath, input.repoPath),
        eq(workspaceLocks.checkoutPath, input.checkoutPath),
      ),
    )
    .returning();

  if (row === undefined) throw new Error("A tomada da trava de workspace não devolveu linha.");
  return row;
}

export async function acquireWorkspaceLock(
  db: Database,
  input: AcquireWorkspaceLockInput,
): Promise<AcquireWorkspaceLockResult> {
  return await db.transaction(async (tx) => {
    // A inserção **é** a verificação: se ninguém segura o par, esta linha
    // aparece e nenhuma outra transação consegue inserir a mesma. Uma leitura
    // seguida de inserção teria uma janela entre as duas.
    const [inserido] = await tx
      .insert(workspaceLocks)
      .values({
        userId: input.userId,
        repoPath: input.repoPath,
        checkoutPath: input.checkoutPath,
        runId: input.runId,
      })
      .onConflictDoNothing({
        target: [workspaceLocks.repoPath, workspaceLocks.checkoutPath],
      })
      .returning();

    if (inserido !== undefined) {
      return { acquired: true, lock: toWorkspaceLock(inserido), reclaimed: false };
    }

    const atual = await loadLockRow(tx, input);
    if (atual === null) {
      // A trava sumiu entre o conflito e a leitura: o dono liberou. Tenta de
      // novo pelo mesmo caminho, agora sem concorrente.
      const [reinserido] = await tx
        .insert(workspaceLocks)
        .values({
          userId: input.userId,
          repoPath: input.repoPath,
          checkoutPath: input.checkoutPath,
          runId: input.runId,
        })
        .onConflictDoNothing({
          target: [workspaceLocks.repoPath, workspaceLocks.checkoutPath],
        })
        .returning();

      if (reinserido === undefined) {
        throw new Error("A trava de workspace mudou de dono duas vezes na mesma transação.");
      }
      return { acquired: true, lock: toWorkspaceLock(reinserido), reclaimed: false };
    }

    if (atual.runId === input.runId) {
      return { acquired: true, lock: toWorkspaceLock(atual), reclaimed: false };
    }

    const [dono] = await tx.select().from(runs).where(eq(runs.id, atual.runId));

    // Trava obsoleta: o dono terminou (ou o worker morreu e a linha do Run
    // sumiu). Recuperar aqui é o que evita um repositório travado para sempre
    // por um processo que não existe mais.
    if (dono === undefined || isTerminalRunStatus(dono.status)) {
      const row = await takeOver(tx, input);
      return { acquired: true, lock: toWorkspaceLock(row), reclaimed: true };
    }

    if (dono.startedAt === null && input.runId < atual.runId) {
      // Desempate determinístico: entre dois Runs que ainda não começaram, vence
      // o de id menor — UUIDv7, então o criado primeiro. O resultado final não
      // depende da ordem de chegada das transações.
      const row = await takeOver(tx, input);
      return { acquired: true, lock: toWorkspaceLock(row), reclaimed: true };
    }

    return {
      acquired: false,
      heldBy: atual.runId,
      heldSince: atual.acquiredAt.toISOString(),
      reason: dono.startedAt === null ? "OLDER_RUN_WINS" : "RUNNING",
    };
  });
}

/**
 * Libera as travas de um Run. Idempotente; devolve quantas saíram.
 *
 * Por Run, e não por caminho, porque é assim que quem libera sabe o que pedir:
 * o worker terminou o Run 123 e quer soltar tudo que ele segurava, sem precisar
 * lembrar de qual caminho era.
 */
export async function releaseWorkspaceLock(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<number> {
  const removidas = await db
    .delete(workspaceLocks)
    .where(and(eq(workspaceLocks.userId, input.userId), eq(workspaceLocks.runId, input.runId)))
    .returning({ runId: workspaceLocks.runId });

  return removidas.length;
}

/**
 * O Run que segura um caminho agora, ou `null`.
 *
 * É a confirmação de posse que o worker faz imediatamente antes de subir o
 * processo, e é também o que a interface usa para explicar por que um Run está
 * esperando.
 */
export async function getActiveRunByPath(
  db: DatabaseExecutor,
  input: { userId: string; repoPath: string; checkoutPath: string },
): Promise<RunRow | null> {
  const [row] = await db
    .select({ run: runs })
    .from(workspaceLocks)
    .innerJoin(runs, eq(runs.id, workspaceLocks.runId))
    .where(
      and(
        eq(workspaceLocks.userId, input.userId),
        eq(workspaceLocks.repoPath, input.repoPath),
        eq(workspaceLocks.checkoutPath, input.checkoutPath),
      ),
    );

  return row?.run ?? null;
}

/** As travas que um Run segura. Usada pelos testes e pela tela de diagnóstico. */
export async function listWorkspaceLocksByRun(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<WorkspaceLock[]> {
  const rows = await db
    .select()
    .from(workspaceLocks)
    .where(and(eq(workspaceLocks.userId, input.userId), eq(workspaceLocks.runId, input.runId)));

  return rows.map(toWorkspaceLock);
}
