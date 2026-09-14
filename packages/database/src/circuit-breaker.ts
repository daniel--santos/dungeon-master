import type {
  BreakerAdmission,
  BreakerScope,
  BreakerState,
  BreakerTriggers,
  CircuitBreaker,
  HarnessKey,
} from "@dungeon-master/contracts";
import {
  admitThroughBreaker,
  type BreakerAdmission as DomainAdmission,
  breakerOutcomeForRunStatus,
  type BreakerSignals,
  evaluateBreakerTriggers,
  nextBreakerState,
} from "@dungeon-master/domain";
import { and, asc, count, eq, gte, inArray, or, type SQL, sql } from "drizzle-orm";

import type { AutonomyWriteFailure } from "./autonomy-failure.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { findLoadoutRow } from "./loadout.js";
import { findProjectRow } from "./project.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { type CircuitBreakerRow, circuitBreakers } from "./schema/autonomy.js";
import { harnesses } from "./schema/execution.js";
import { type RunRow, runEvents, runs } from "./schema/run.js";
import { tasks } from "./schema/task.js";

/**
 * CircuitBreaker: o disjuntor por escopo (planejamento v0.4, Fase 9A).
 *
 * **Todo estado muda por CAS.** A admissão em `POST /runs` (esta fase), o
 * desfecho gravado pelo Worker (9B) e o reset disputam a mesma linha; a
 * condição `WHERE state = <esperado>` é o que impede uma transição decidida
 * sobre um retrato velho. A máquina de estados é do domínio; aqui só se
 * aplica o que ela decidiu, com o evento de painel na mesma transação.
 */

export const DEFAULT_COOLDOWN_MS = 15 * 60 * 1_000;

export function toCircuitBreaker(row: CircuitBreakerRow): CircuitBreaker {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    projectId: row.projectId,
    loadoutId: row.loadoutId,
    harnessKey: row.harnessKey,
    triggers: row.triggers,
    cooldownMs: row.cooldownMs,
    state: row.state,
    openedAt: row.openedAt?.toISOString() ?? null,
    reason: row.reason,
    probeRunId: row.probeRunId,
    consecutiveFailures: row.consecutiveFailures,
    stateChangedAt: row.stateChangedAt.toISOString(),
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findCircuitBreakerRow(
  db: DatabaseExecutor,
  input: { userId: string; circuitBreakerId: string },
): Promise<CircuitBreakerRow | null> {
  const [row] = await db
    .select()
    .from(circuitBreakers)
    .where(
      and(eq(circuitBreakers.id, input.circuitBreakerId), eq(circuitBreakers.userId, input.userId)),
    );
  return row ?? null;
}

export interface CircuitBreakerFilters {
  scope?: BreakerScope | undefined;
  state?: BreakerState | undefined;
  projectId?: string | undefined;
}

export interface ListCircuitBreakersInput extends PageInput {
  userId: string;
  filters?: CircuitBreakerFilters;
}

export async function listCircuitBreakers(
  db: DatabaseExecutor,
  input: ListCircuitBreakersInput,
): Promise<PageResult<CircuitBreaker>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(circuitBreakers.userId, input.userId)];
  if (filters.scope !== undefined) conditions.push(eq(circuitBreakers.scope, filters.scope));
  if (filters.state !== undefined) conditions.push(eq(circuitBreakers.state, filters.state));
  if (filters.projectId !== undefined) {
    conditions.push(eq(circuitBreakers.projectId, filters.projectId));
  }
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(circuitBreakers)
    .where(where)
    .orderBy(asc(circuitBreakers.name), asc(circuitBreakers.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(circuitBreakers).where(where);

  return { items: rows.map(toCircuitBreaker), total: counted?.total ?? 0 };
}

/**
 * Os disjuntores ligados que alcançam um Run, **travados** para o resto da
 * transação, em ordem de id: quem consulta o estado para admitir um Run
 * precisa que ninguém o mude antes do COMMIT, e travar sempre na mesma ordem
 * é o que evita deadlock entre duas criações simultâneas.
 */
export async function lockApplicableBreakers(
  db: DatabaseExecutor,
  input: {
    userId: string;
    projectId: string | null;
    loadoutId: string | null;
    harnessKey: HarnessKey;
  },
): Promise<CircuitBreakerRow[]> {
  const escopos: SQL[] = [eq(circuitBreakers.harnessKey, input.harnessKey)];
  if (input.projectId !== null) escopos.push(eq(circuitBreakers.projectId, input.projectId));
  if (input.loadoutId !== null) escopos.push(eq(circuitBreakers.loadoutId, input.loadoutId));

  return await db
    .select()
    .from(circuitBreakers)
    .where(
      and(
        eq(circuitBreakers.userId, input.userId),
        eq(circuitBreakers.enabled, true),
        or(...escopos),
      ),
    )
    .orderBy(asc(circuitBreakers.id))
    .for("update");
}

export function toBreakerAdmission(
  breaker: Pick<CircuitBreakerRow, "id" | "name">,
  admission: DomainAdmission,
): BreakerAdmission {
  return {
    breakerId: breaker.id,
    name: breaker.name,
    state: admission.state,
    probe: admission.admit ? admission.probe : false,
    decidedBy: `BREAKER:${breaker.id}`,
    reason: admission.reason,
  };
}

export type BreakersAdmissionResult =
  | { readonly admitted: false; readonly refused: BreakerAdmission }
  | {
      readonly admitted: true;
      /** Os disjuntores que vão tomar o Run novo como sondagem, já travados. */
      readonly probes: {
        readonly breaker: CircuitBreakerRow;
        readonly admission: DomainAdmission & { admit: true };
      }[];
    };

/**
 * Consulta todos os disjuntores do Run, sem gravar nada.
 *
 * A gravação da sondagem (`markBreakerProbe`) fica para depois do `INSERT`
 * do Run, porque `probe_run_id` é chave estrangeira; as linhas continuam
 * travadas até lá, então o retrato não envelhece.
 */
export function admitRunThroughBreakers(
  breakers: readonly CircuitBreakerRow[],
  now: Date,
): BreakersAdmissionResult {
  const probes: { breaker: CircuitBreakerRow; admission: DomainAdmission & { admit: true } }[] = [];

  for (const breaker of breakers) {
    const admission = admitThroughBreaker(
      {
        state: breaker.state,
        openedAt: breaker.openedAt,
        cooldownMs: breaker.cooldownMs,
        probeRunId: breaker.probeRunId,
      },
      now,
    );
    if (!admission.admit) {
      return { admitted: false, refused: toBreakerAdmission(breaker, admission) };
    }
    if (admission.probe) probes.push({ breaker, admission });
  }

  return { admitted: true, probes };
}

/**
 * Marca o Run como sondagem do disjuntor, movendo-o a `HALF_OPEN` se o
 * cooldown acabou de passar. CAS sobre o estado e sobre a ausência de
 * sondagem; zero linhas é defeito, porque a linha estava travada.
 */
export async function markBreakerProbe(
  db: DatabaseExecutor,
  input: { userId: string; breaker: CircuitBreakerRow; runId: string; now: Date },
): Promise<CircuitBreakerRow> {
  const { breaker } = input;
  const [row] = await db
    .update(circuitBreakers)
    .set({
      state: "HALF_OPEN",
      probeRunId: input.runId,
      ...(breaker.state === "HALF_OPEN" ? {} : { stateChangedAt: input.now }),
    })
    .where(
      and(
        eq(circuitBreakers.id, breaker.id),
        eq(circuitBreakers.userId, input.userId),
        eq(circuitBreakers.state, breaker.state),
        sql`${circuitBreakers.probeRunId} is null`,
      ),
    )
    .returning();

  if (row === undefined) {
    throw new Error(`O disjuntor ${breaker.id} mudou sob a trava; a sondagem não foi marcada.`);
  }

  if (breaker.state !== "HALF_OPEN") {
    await appendDashboardEvent(db, {
      userId: input.userId,
      type: "breaker.half_open",
      payload: {
        breakerId: row.id,
        name: row.name,
        scope: row.scope,
        from: breaker.state,
        to: "HALF_OPEN",
        probeRunId: input.runId,
        decidedBy: `BREAKER:${row.id}`,
      },
    });
  }

  return row;
}

// --------------------------------------------------------------------------
// Alimentação pelos desfechos (Fase 9B)
// --------------------------------------------------------------------------

/** Uma transição de estado que um desfecho provocou. Vai ao diário do Run. */
export interface BreakerTransition {
  readonly breakerId: string;
  readonly name: string;
  readonly scope: BreakerScope;
  readonly from: BreakerState;
  readonly to: BreakerState;
  readonly decidedBy: string;
  readonly reason: string;
}

/** A condição de escopo de um disjuntor sobre `run` junto de `task`. */
function escopoDoDisjuntor(breaker: CircuitBreakerRow): SQL | undefined {
  switch (breaker.scope) {
    case "PROJECT":
      return breaker.projectId === null ? undefined : eq(tasks.projectId, breaker.projectId);
    case "LOADOUT":
      return breaker.loadoutId === null ? undefined : eq(runs.loadoutId, breaker.loadoutId);
    case "HARNESS":
      return breaker.harnessKey === null ? undefined : eq(runs.harnessKey, breaker.harnessKey);
  }
}

/** Quantos Runs do escopo terminaram em `FAILED`/`TIMED_OUT` na janela. */
async function contarFalhasNaJanela(
  db: DatabaseExecutor,
  input: { userId: string; breaker: CircuitBreakerRow; windowMs: number; now: Date },
): Promise<number> {
  const escopo = escopoDoDisjuntor(input.breaker);
  const desde = new Date(input.now.getTime() - input.windowMs);
  const [row] = await db
    .select({ total: count() })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(
      and(
        eq(runs.userId, input.userId),
        inArray(runs.status, ["FAILED", "TIMED_OUT"]),
        gte(runs.finishedAt, desde),
        ...(escopo === undefined ? [] : [escopo]),
      ),
    );
  return row?.total ?? 0;
}

/** Quantos `Diagnostic` com `PERMISSION_DENIED` o escopo produziu na janela. */
async function contarPermissoesNegadasNaJanela(
  db: DatabaseExecutor,
  input: { userId: string; breaker: CircuitBreakerRow; windowMs: number; now: Date },
): Promise<number> {
  const escopo = escopoDoDisjuntor(input.breaker);
  const desde = new Date(input.now.getTime() - input.windowMs);
  const [row] = await db
    .select({ total: count() })
    .from(runEvents)
    .innerJoin(runs, eq(runs.id, runEvents.runId))
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(
      and(
        eq(runEvents.userId, input.userId),
        eq(runEvents.type, "Diagnostic"),
        sql`${runEvents.payload} ->> 'code' = 'PERMISSION_DENIED'`,
        gte(runEvents.timestamp, desde),
        ...(escopo === undefined ? [] : [escopo]),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Alimenta os disjuntores do escopo do Run com o desfecho dele (Fase 9B).
 *
 * Chamada **na transação** do status terminal, com a linha do Run já
 * gravada — é por isso que a falha deste Run já conta em `failuresInWindow`.
 * Os disjuntores do Project, do Loadout e do Harness são travados em ordem
 * de id, como na admissão, e cada um é movido por CAS.
 *
 * O que cada desfecho faz, pela máquina do domínio:
 *
 * - `SUCCEEDED`: a sondagem de um `HALF_OPEN` fecha o disjuntor e zera tudo
 *   (`breaker.closed`); num `CLOSED`, a sequência de falhas volta a zero.
 * - `FAILED`/`TIMED_OUT`: a sondagem de um `HALF_OPEN` reabre com o cooldown
 *   renovado (`breaker.opened`); num `CLOSED`, a sequência sobe e os gatilhos
 *   são avaliados com os sinais medidos agora — `consecutiveFailures` pelo
 *   contador, `failuresInWindow` e `permissionDeniedInWindow` pelas
 *   contagens do escopo, `authNotAuthenticated` pelo `auth_status` que o
 *   preflight de boot mediu (Fase 8B). Disparou, abre (`breaker.opened`).
 * - `CANCELLED`: nada. Cancelar não é evidência sobre o escopo.
 *
 * Um `OPEN` não se mexe por desfecho, e um `HALF_OPEN` só pela sondagem
 * dele: um Run antigo que termina não decide por um disjuntor que já mudou.
 */
export async function feedBreakersWithRunOutcome(
  db: DatabaseExecutor,
  input: { userId: string; run: RunRow; projectId: string | null; now?: Date },
): Promise<BreakerTransition[]> {
  const outcome = breakerOutcomeForRunStatus(input.run.status);
  if (outcome === null) return [];

  const now = input.now ?? new Date();
  const breakers = await lockApplicableBreakers(db, {
    userId: input.userId,
    projectId: input.projectId,
    loadoutId: input.run.loadoutId,
    harnessKey: input.run.harnessKey,
  });
  if (breakers.length === 0) return [];

  const transicoes: BreakerTransition[] = [];

  for (const breaker of breakers) {
    const isProbe = breaker.probeRunId === input.run.id;
    const decidedBy = `BREAKER:${breaker.id}`;

    if (outcome === "SUCCEEDED") {
      if (breaker.state === "HALF_OPEN" && isProbe) {
        const reason = `A sondagem ${input.run.id} terminou em SUCCEEDED; o disjuntor fecha.`;
        await aplicarTransicao(db, {
          userId: input.userId,
          breaker,
          to: "CLOSED",
          patch: { openedAt: null, reason: null, probeRunId: null, consecutiveFailures: 0 },
          now,
          event: "breaker.closed",
          decidedBy,
          reason,
          probeRunId: input.run.id,
        });
        transicoes.push({
          breakerId: breaker.id,
          name: breaker.name,
          scope: breaker.scope,
          from: "HALF_OPEN",
          to: "CLOSED",
          decidedBy,
          reason,
        });
      } else if (breaker.state === "CLOSED" && breaker.consecutiveFailures > 0) {
        await db
          .update(circuitBreakers)
          .set({ consecutiveFailures: 0 })
          .where(and(eq(circuitBreakers.id, breaker.id), eq(circuitBreakers.state, "CLOSED")));
      }
      continue;
    }

    // ------------------------------------------------------------- falha
    if (breaker.state === "HALF_OPEN" && isProbe) {
      const reason = `A sondagem ${input.run.id} terminou em ${input.run.status}; o disjuntor reabre.`;
      await aplicarTransicao(db, {
        userId: input.userId,
        breaker,
        to: "OPEN",
        patch: {
          openedAt: now,
          reason,
          probeRunId: null,
          consecutiveFailures: breaker.consecutiveFailures + 1,
        },
        now,
        event: "breaker.opened",
        decidedBy,
        reason,
        probeRunId: input.run.id,
      });
      transicoes.push({
        breakerId: breaker.id,
        name: breaker.name,
        scope: breaker.scope,
        from: "HALF_OPEN",
        to: "OPEN",
        decidedBy,
        reason,
      });
      continue;
    }

    if (breaker.state !== "CLOSED") continue;

    const consecutivas = breaker.consecutiveFailures + 1;
    const signals: BreakerSignals = { consecutiveFailures: consecutivas };
    const sinais: BreakerSignals & {
      failuresInWindow?: number;
      permissionDeniedInWindow?: number;
      authNotAuthenticated?: boolean;
    } = { ...signals };
    if (breaker.triggers.failuresInWindow !== null) {
      sinais.failuresInWindow = await contarFalhasNaJanela(db, {
        userId: input.userId,
        breaker,
        windowMs: breaker.triggers.failuresInWindow.windowMs,
        now,
      });
    }
    if (breaker.triggers.permissionDeniedInWindow !== null) {
      sinais.permissionDeniedInWindow = await contarPermissoesNegadasNaJanela(db, {
        userId: input.userId,
        breaker,
        windowMs: breaker.triggers.permissionDeniedInWindow.windowMs,
        now,
      });
    }
    if (breaker.triggers.authNotAuthenticated) {
      const [harness] = await db
        .select({ authStatus: harnesses.authStatus })
        .from(harnesses)
        .where(and(eq(harnesses.userId, input.userId), eq(harnesses.key, input.run.harnessKey)));
      if (harness !== undefined && harness.authStatus !== null) {
        sinais.authNotAuthenticated = harness.authStatus === "NOT_AUTHENTICATED";
      }
    }

    const trip = evaluateBreakerTriggers(breaker.triggers, sinais);
    const next = nextBreakerState({ state: "CLOSED", outcome, isProbe: false, tripped: trip.trip });

    if (next === "OPEN" && trip.trip) {
      await aplicarTransicao(db, {
        userId: input.userId,
        breaker,
        to: "OPEN",
        patch: { openedAt: now, reason: trip.reason, consecutiveFailures: consecutivas },
        now,
        event: "breaker.opened",
        decidedBy,
        reason: trip.reason,
        probeRunId: null,
        trigger: trip.trigger,
      });
      transicoes.push({
        breakerId: breaker.id,
        name: breaker.name,
        scope: breaker.scope,
        from: "CLOSED",
        to: "OPEN",
        decidedBy,
        reason: trip.reason,
      });
      continue;
    }

    await db
      .update(circuitBreakers)
      .set({ consecutiveFailures: consecutivas })
      .where(and(eq(circuitBreakers.id, breaker.id), eq(circuitBreakers.state, "CLOSED")));
  }

  return transicoes;
}

/** O CAS de uma transição de estado e o evento de painel que a anuncia. */
async function aplicarTransicao(
  db: DatabaseExecutor,
  input: {
    userId: string;
    breaker: CircuitBreakerRow;
    to: BreakerState;
    patch: Partial<
      Pick<CircuitBreakerRow, "openedAt" | "reason" | "probeRunId" | "consecutiveFailures">
    >;
    now: Date;
    event: "breaker.opened" | "breaker.closed";
    decidedBy: string;
    reason: string;
    probeRunId: string | null;
    trigger?: keyof BreakerTriggers;
  },
): Promise<void> {
  const [row] = await db
    .update(circuitBreakers)
    .set({ state: input.to, stateChangedAt: input.now, ...input.patch })
    .where(
      and(
        eq(circuitBreakers.id, input.breaker.id),
        eq(circuitBreakers.userId, input.userId),
        eq(circuitBreakers.state, input.breaker.state),
      ),
    )
    .returning();
  if (row === undefined) {
    throw new Error(
      `O disjuntor ${input.breaker.id} mudou sob a trava; a transição não foi gravada.`,
    );
  }

  await appendDashboardEvent(db, {
    userId: input.userId,
    type: input.event,
    payload: {
      breakerId: row.id,
      name: row.name,
      scope: row.scope,
      from: input.breaker.state,
      to: input.to,
      decidedBy: input.decidedBy,
      reason: input.reason,
      probeRunId: input.probeRunId,
      ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
      ...(input.to === "OPEN" ? { cooldownMs: row.cooldownMs } : {}),
    },
  });
}

/** O estado de cada disjuntor ligado, para o log de boot do Worker. */
export async function listEnabledBreakerStates(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<
  ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly scope: BreakerScope;
    readonly state: BreakerState;
    readonly openedAt: string | null;
    readonly probeRunId: string | null;
  }>
> {
  const rows = await db
    .select()
    .from(circuitBreakers)
    .where(and(eq(circuitBreakers.userId, input.userId), eq(circuitBreakers.enabled, true)))
    .orderBy(asc(circuitBreakers.scope), asc(circuitBreakers.name), asc(circuitBreakers.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scope: row.scope,
    state: row.state,
    openedAt: row.openedAt?.toISOString() ?? null,
    probeRunId: row.probeRunId,
  }));
}

// --------------------------------------------------------------------------
// Escrita
// --------------------------------------------------------------------------

export interface CreateCircuitBreakerInput {
  userId: string;
  name: string;
  scope: BreakerScope;
  projectId?: string | null;
  loadoutId?: string | null;
  harnessKey?: HarnessKey | null;
  consecutiveFailures?: number | null;
  failuresInWindow?: { count: number; windowMs: number } | null;
  permissionDeniedInWindow?: { count: number; windowMs: number } | null;
  authNotAuthenticated?: boolean;
  cooldownMs?: number;
  enabled?: boolean;
}

function semGatilho(triggers: BreakerTriggers): boolean {
  return (
    triggers.consecutiveFailures === null &&
    triggers.failuresInWindow === null &&
    triggers.permissionDeniedInWindow === null &&
    !triggers.authNotAuthenticated
  );
}

async function conferirEscopo(
  db: DatabaseExecutor,
  input: {
    userId: string;
    scope: BreakerScope;
    projectId: string | null;
    loadoutId: string | null;
    harnessKey: HarnessKey | null;
  },
): Promise<AutonomyWriteFailure | null> {
  const { scope } = input;
  const campos = [
    ["PROJECT", "projectId", input.projectId] as const,
    ["LOADOUT", "loadoutId", input.loadoutId] as const,
    ["HARNESS", "harnessKey", input.harnessKey] as const,
  ];
  for (const [doEscopo, field, valor] of campos) {
    if ((scope === doEscopo) !== (valor !== null)) {
      return {
        code: "SCOPE_MISMATCH",
        scope,
        field,
        expected: scope === doEscopo ? "required" : "forbidden",
      };
    }
  }
  if (input.projectId !== null) {
    const project = await findProjectRow(db, { userId: input.userId, projectId: input.projectId });
    if (project === null) return { code: "PROJECT_NOT_FOUND", projectId: input.projectId };
  }
  if (input.loadoutId !== null) {
    const loadout = await findLoadoutRow(db, { userId: input.userId, loadoutId: input.loadoutId });
    if (loadout === null) return { code: "LOADOUT_NOT_FOUND", loadoutId: input.loadoutId };
  }
  return null;
}

export async function createCircuitBreaker(
  db: Database,
  input: CreateCircuitBreakerInput,
): Promise<Result<CircuitBreaker, AutonomyWriteFailure>> {
  return await db.transaction(async (tx) => {
    const projectId = input.projectId ?? null;
    const loadoutId = input.loadoutId ?? null;
    const harnessKey = input.harnessKey ?? null;
    const triggers: BreakerTriggers = {
      consecutiveFailures: input.consecutiveFailures ?? null,
      failuresInWindow: input.failuresInWindow ?? null,
      permissionDeniedInWindow: input.permissionDeniedInWindow ?? null,
      authNotAuthenticated: input.authNotAuthenticated ?? false,
    };

    const recusa = await conferirEscopo(tx, {
      userId: input.userId,
      scope: input.scope,
      projectId,
      loadoutId,
      harnessKey,
    });
    if (recusa !== null) return failed(recusa);
    if (semGatilho(triggers))
      return failed<AutonomyWriteFailure>({ code: "BREAKER_WITHOUT_TRIGGER" });

    const [row] = await tx
      .insert(circuitBreakers)
      .values({
        id: newId(),
        userId: input.userId,
        name: input.name,
        scope: input.scope,
        projectId,
        loadoutId,
        harnessKey,
        triggers,
        cooldownMs: input.cooldownMs ?? DEFAULT_COOLDOWN_MS,
        enabled: input.enabled ?? true,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em circuit_breaker não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "circuit_breaker", id: row.id, action: "created" },
    });

    return ok(toCircuitBreaker(row));
  });
}

export interface UpdateCircuitBreakerPatch {
  name?: string;
  consecutiveFailures?: number | null;
  failuresInWindow?: { count: number; windowMs: number } | null;
  permissionDeniedInWindow?: { count: number; windowMs: number } | null;
  authNotAuthenticated?: boolean;
  cooldownMs?: number;
  enabled?: boolean;
}

export async function updateCircuitBreaker(
  db: Database,
  input: { userId: string; circuitBreakerId: string; patch: UpdateCircuitBreakerPatch },
): Promise<Result<CircuitBreaker, AutonomyWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findCircuitBreakerRow(tx, input);
    if (current === null) return null;

    const { patch } = input;
    const triggers: BreakerTriggers = {
      consecutiveFailures:
        patch.consecutiveFailures === undefined
          ? current.triggers.consecutiveFailures
          : patch.consecutiveFailures,
      failuresInWindow:
        patch.failuresInWindow === undefined
          ? current.triggers.failuresInWindow
          : patch.failuresInWindow,
      permissionDeniedInWindow:
        patch.permissionDeniedInWindow === undefined
          ? current.triggers.permissionDeniedInWindow
          : patch.permissionDeniedInWindow,
      authNotAuthenticated:
        patch.authNotAuthenticated === undefined
          ? current.triggers.authNotAuthenticated
          : patch.authNotAuthenticated,
    };
    if (semGatilho(triggers))
      return failed<AutonomyWriteFailure>({ code: "BREAKER_WITHOUT_TRIGGER" });

    const [row] = await tx
      .update(circuitBreakers)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        triggers,
        ...(patch.cooldownMs === undefined ? {} : { cooldownMs: patch.cooldownMs }),
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      })
      .where(
        and(
          eq(circuitBreakers.id, input.circuitBreakerId),
          eq(circuitBreakers.userId, input.userId),
        ),
      )
      .returning();

    if (row === undefined) throw new Error("A atualização de circuit_breaker não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "circuit_breaker", id: row.id, action: "updated" },
    });

    return ok(toCircuitBreaker(row));
  });
}

export async function deleteCircuitBreaker(
  db: Database,
  input: { userId: string; circuitBreakerId: string },
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const current = await findCircuitBreakerRow(tx, input);
    if (current === null) return false;

    await tx
      .delete(circuitBreakers)
      .where(
        and(
          eq(circuitBreakers.id, input.circuitBreakerId),
          eq(circuitBreakers.userId, input.userId),
        ),
      );

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "circuit_breaker", id: input.circuitBreakerId, action: "deleted" },
    });

    return true;
  });
}

/**
 * O reset manual: de qualquer estado para `CLOSED`, zerando instante, motivo,
 * sondagem e contador. Idempotente: um disjuntor já fechado devolve o mesmo
 * e não grava um segundo fato. `breaker.closed` sai na mesma transação.
 */
export async function resetCircuitBreaker(
  db: Database,
  input: { userId: string; circuitBreakerId: string },
): Promise<CircuitBreaker | null> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(circuitBreakers)
      .where(
        and(
          eq(circuitBreakers.id, input.circuitBreakerId),
          eq(circuitBreakers.userId, input.userId),
        ),
      )
      .for("update");
    if (current === undefined) return null;

    if (current.state === "CLOSED" && current.consecutiveFailures === 0) {
      return toCircuitBreaker(current);
    }

    const agora = new Date();
    const [row] = await tx
      .update(circuitBreakers)
      .set({
        state: "CLOSED",
        openedAt: null,
        reason: null,
        probeRunId: null,
        consecutiveFailures: 0,
        stateChangedAt: agora,
      })
      .where(
        and(
          eq(circuitBreakers.id, current.id),
          eq(circuitBreakers.userId, input.userId),
          eq(circuitBreakers.state, current.state),
        ),
      )
      .returning();

    if (row === undefined) throw new Error("O reset do disjuntor perdeu o CAS sob a trava.");

    if (current.state !== "CLOSED") {
      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "breaker.closed",
        payload: {
          breakerId: row.id,
          name: row.name,
          scope: row.scope,
          from: current.state,
          to: "CLOSED",
          decidedBy: "RESET",
          reason: "Reset manual pela API.",
        },
      });
    }

    return toCircuitBreaker(row);
  });
}
