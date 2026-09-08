import {
  type AchievementDefinition,
  type AchievementTemplate,
  applyEvent,
  applyRunOutcome,
  applyUsage,
  type Condition,
  EMPTY_HERO_STATS,
  type HeroStatsState,
  parseCondition,
  type ProjectionEvent,
  type RunOutcome,
  topHarness,
  type AchievementProgress as PureProgress,
} from "@dungeon-master/achievements";
import type {
  ExecutionMode,
  HarnessKey,
  LoadoutSnapshot,
  TaskKind,
  TaskStatus,
} from "@dungeon-master/contracts";
import type { EventsLogger } from "@dungeon-master/events";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import {
  formatDefinitionName,
  harnessSlug,
  listAchievementDefinitionRows,
  listAchievementProgressRows,
  resolveScopeLabels,
  syncCatalogDefinitions,
  syncTemplateInstances,
  toPureProgress,
} from "./achievement.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import {
  type AchievementCursorRow,
  type AchievementDefinitionRow,
  achievementCursors,
  achievementDefinitions,
  achievementProgress,
  type AchievementSource,
  achievementUnlocks,
  heroStats,
  type HeroScope,
} from "./schema/achievement.js";
import { runs } from "./schema/run.js";
import { tasks } from "./schema/task.js";

/**
 * O projetor de Conquistas (planejamento v0.4, Fase 2.5B).
 *
 * Consome por cursor três fontes duráveis — `activity`, `run_event` e
 * `dashboard_event` —, avalia cada definição aplicável, grava progresso,
 * desbloqueia por tier de forma idempotente e atualiza as estatísticas de Herói
 * no mesmo passo. Os eventos `achievement.unlocked` e `hero_stats.updated` saem
 * em `dashboard_event` **dentro da mesma transação** do desbloqueio.
 *
 * ## Contrato: nunca lança
 *
 * Nenhuma falha daqui pode alcançar a execução de um Run. Um erro é logado, a
 * transação do lote é desfeita e **o cursor não avança**: o mesmo lote é
 * tentado de novo no passe seguinte. Uma definição inválida é ignorada com log,
 * nunca derruba o passe.
 *
 * ## Por que o desfecho do Run vem de `activity`, e não de `run_event`
 *
 * `activity` grava um `run.status_changed` em **toda** transição terminal, por
 * qualquer caminho — inclusive o cancelamento de um Run que ainda estava na
 * fila, que nunca chega a produzir um evento de execução. E `COMPLETED`,
 * `FAILED`, `TIMED_OUT` e `CANCELLED` não têm saída na máquina de estados, o
 * que dá exatamente uma linha por Run: contar por ali é exatamente-uma-vez sem
 * nenhuma marca extra. `run_event` entra para o que só existe lá: o `Usage`,
 * que alimenta a contagem de tokens do Herói.
 *
 * ## A marca d'água
 *
 * `created_at` é `now()`, o instante de **início** da transação, e o commit vem
 * depois: duas transações concorrentes podem ficar visíveis fora de ordem. Por
 * isso o projetor só lê linhas mais velhas que {@link PROJECTOR_LAG_MS}. É o
 * mesmo raciocínio de `GAP_GRACE_MS` no poller do SSE, e o custo de errar é o
 * mesmo: segurar um fato por um segundo é latência, e pular um fato é perda.
 */

/** Atraso de segurança sobre `created_at`, para não pular um commit fora de ordem. */
export const PROJECTOR_LAG_MS = 1_000;

/** Linhas por lote. Um lote é uma transação. */
export const PROJECTOR_BATCH_SIZE = 200;

/** Os tipos de `activity` que viram fato de Conquista. */
const ACTIVITY_TYPES = [
  "project.created",
  "task.status_changed",
  "task.dependency_created",
  "run.status_changed",
] as const;

/**
 * Os tipos de `dashboard_event` que o projetor consome.
 *
 * Nenhum deles existe hoje: `ApprovalGate` chega na Fase 4 e o Grimório na
 * Fase 6. A fonte já entra ligada, com cursor próprio, porque o dia em que os
 * eventos existirem não pode ser o dia em que alguém lembra de ligar a fonte —
 * e um `IN` que não casa com nada custa uma consulta indexada por passe.
 */
const DASHBOARD_TYPES = [
  "approval.granted",
  "approval.rejected",
  "knowledge_item.promoted",
] as const;

// --------------------------------------------------------------------------
// Ações que um lote produz
// --------------------------------------------------------------------------

/** O fato que altera estatísticas de Herói, separado do que altera Conquistas. */
interface HeroDelta {
  readonly agentId: string | null;
  readonly loadoutId: string;
  readonly outcome?: {
    readonly outcome: RunOutcome;
    readonly harness: string;
    readonly executionMode: ExecutionMode;
    readonly monster: boolean;
  };
  readonly tokens?: number;
}

interface Batch {
  readonly events: ProjectionEvent[];
  readonly heroes: HeroDelta[];
  readonly rows: number;
  readonly cursor: { positionAt: Date | null; positionId: string } | null;
}

const EMPTY_BATCH: Batch = { events: [], heroes: [], rows: 0, cursor: null };

// --------------------------------------------------------------------------
// Contexto de um Run e de uma Task
// --------------------------------------------------------------------------

interface RunContext {
  readonly id: string;
  readonly taskId: string;
  readonly harnessKey: HarnessKey;
  readonly executionMode: ExecutionMode;
  readonly resumedFromRunId: string | null;
  readonly workflowVersionId: string | null;
  readonly loadoutId: string;
  readonly loadoutSnapshot: LoadoutSnapshot;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

interface TaskContext {
  readonly id: string;
  readonly kind: TaskKind;
  readonly status: TaskStatus;
  readonly projectId: string | null;
}

async function loadRunContexts(
  db: DatabaseExecutor,
  input: { userId: string; runIds: readonly string[] },
): Promise<Map<string, RunContext>> {
  if (input.runIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: runs.id,
      taskId: runs.taskId,
      harnessKey: runs.harnessKey,
      executionMode: runs.executionMode,
      resumedFromRunId: runs.resumedFromRunId,
      workflowVersionId: runs.workflowVersionId,
      loadoutId: runs.loadoutId,
      loadoutSnapshot: runs.loadoutSnapshot,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .where(and(eq(runs.userId, input.userId), inArray(runs.id, [...input.runIds])));

  return new Map(rows.map((row) => [row.id, row]));
}

async function loadTaskContexts(
  db: DatabaseExecutor,
  input: { userId: string; taskIds: readonly string[] },
): Promise<Map<string, TaskContext>> {
  if (input.taskIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: tasks.id,
      kind: tasks.kind,
      status: tasks.status,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, input.userId), inArray(tasks.id, [...input.taskIds])));

  return new Map(rows.map((row) => [row.id, row]));
}

// --------------------------------------------------------------------------
// Tradução de linha em fato
// --------------------------------------------------------------------------

/** O desfecho de Run, no vocabulário fechado das condições. */
function runOutcomeSource(status: string): ProjectionEvent["source"] | null {
  switch (status) {
    case "SUCCEEDED":
      return "run.succeeded";
    // Um estouro de relógio é uma derrota: o vocabulário tem três desfechos, e
    // inventar um quarto obrigaria a mexer no catálogo por causa da máquina de
    // estados. Para a sequência de vitórias, os dois quebram igual.
    case "FAILED":
    case "TIMED_OUT":
      return "run.failed";
    case "CANCELLED":
      return "run.cancelled";
    default:
      return null;
  }
}

function heroOutcome(source: ProjectionEvent["source"]): RunOutcome {
  if (source === "run.succeeded") return "VICTORY";
  if (source === "run.cancelled") return "ABANDONED";
  return "DEFEAT";
}

function readString(payload: unknown, key: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/** A duração da Expedição, quando os dois instantes existem. */
function durationOf(run: RunContext): number | undefined {
  if (run.startedAt === null || run.finishedAt === null) return undefined;
  const ms = run.finishedAt.getTime() - run.startedAt.getTime();
  return ms >= 0 ? ms : undefined;
}

// --------------------------------------------------------------------------
// Cursores
// --------------------------------------------------------------------------

async function readCursor(
  db: DatabaseExecutor,
  input: { userId: string; source: AchievementSource },
): Promise<AchievementCursorRow | null> {
  const [row] = await db
    .select()
    .from(achievementCursors)
    .where(
      and(eq(achievementCursors.userId, input.userId), eq(achievementCursors.source, input.source)),
    );

  return row ?? null;
}

async function writeCursor(
  db: DatabaseExecutor,
  input: {
    userId: string;
    source: AchievementSource;
    positionAt: Date | null;
    positionId: string;
  },
): Promise<void> {
  await db
    .insert(achievementCursors)
    .values({
      source: input.source,
      userId: input.userId,
      positionAt: input.positionAt,
      positionId: input.positionId,
    })
    .onConflictDoUpdate({
      target: [achievementCursors.source, achievementCursors.userId],
      set: { positionAt: input.positionAt, positionId: input.positionId, updatedAt: new Date() },
    });
}

/** `(created_at, id) > (cursor)`, ou nada quando o cursor ainda não existe. */
function afterCursor(cursor: AchievementCursorRow | null, table: string): SQL | undefined {
  if (cursor === null || cursor.positionAt === null || cursor.positionId === null) return undefined;
  const coluna = sql.raw(`${table}.created_at`);
  const id = sql.raw(`${table}.id`);
  return sql`(${coluna}, ${id}) > (${cursor.positionAt}::timestamptz, ${cursor.positionId}::uuid)`;
}

// --------------------------------------------------------------------------
// Leitura das três fontes
// --------------------------------------------------------------------------

interface DrainContext {
  readonly userId: string;
  readonly cutoff: Date;
  readonly batchSize: number;
  readonly timeZoneHour: (at: Date) => number;
}

async function drainActivity(db: DatabaseExecutor, ctx: DrainContext): Promise<Batch> {
  const cursor = await readCursor(db, { userId: ctx.userId, source: "activity" });
  const depois = afterCursor(cursor, "a");

  const rows = (
    await db.execute<{
      id: string;
      created_at: Date;
      type: string;
      payload: unknown;
      task_id: string | null;
      project_id: string | null;
    }>(
      sql`select a.id, a.created_at, a.type, a.payload, a.task_id, a.project_id
          from activity a
          where a.user_id = ${ctx.userId}
            and a.created_at <= ${ctx.cutoff}::timestamptz
            and a.type in (${sql.join(
              ACTIVITY_TYPES.map((type) => sql`${type}`),
              sql`, `,
            )})
            ${depois === undefined ? sql`` : sql`and ${depois}`}
          order by a.created_at, a.id
          limit ${ctx.batchSize}`,
    )
  ).rows;

  if (rows.length === 0) return EMPTY_BATCH;

  const runIds = [
    ...new Set(
      rows
        .filter((row) => row.type === "run.status_changed")
        .map((row) => readString(row.payload, "runId"))
        .filter((id): id is string => id !== null),
    ),
  ];

  const runContexts = await loadRunContexts(db, { userId: ctx.userId, runIds });

  const taskIds = [
    ...new Set(
      [
        ...rows.map((row) => row.task_id),
        ...[...runContexts.values()].map((run) => run.taskId),
      ].filter((id): id is string => id !== null),
    ),
  ];

  const taskContexts = await loadTaskContexts(db, { userId: ctx.userId, taskIds });

  const events: ProjectionEvent[] = [];
  const heroes: HeroDelta[] = [];

  for (const row of rows) {
    const at = new Date(row.created_at);
    const hourLocal = ctx.timeZoneHour(at);

    if (row.type === "project.created") {
      const projectId = row.project_id ?? readString(row.payload, "projectId");
      if (projectId === null) continue;
      events.push({
        source: "project.created",
        at: at.toISOString(),
        runId: null,
        taskId: null,
        fields: { "project.id": projectId, hourLocal },
      });
      continue;
    }

    if (row.type === "task.dependency_created") {
      const task = row.task_id === null ? undefined : taskContexts.get(row.task_id);
      events.push({
        source: "task.dependency_created",
        at: at.toISOString(),
        runId: null,
        taskId: row.task_id,
        fields: {
          ...(row.task_id === null ? {} : { "task.id": row.task_id }),
          ...(task?.kind === undefined ? {} : { "task.kind": task.kind }),
          ...(task?.projectId == null ? {} : { "project.id": task.projectId }),
          hourLocal,
        },
      });
      continue;
    }

    if (row.type === "task.status_changed") {
      if (readString(row.payload, "to") !== "COMPLETED") continue;
      const taskId = row.task_id;
      if (taskId === null) continue;
      const task = taskContexts.get(taskId);
      events.push({
        source: "task.completed",
        at: at.toISOString(),
        runId: readString(row.payload, "runId"),
        taskId,
        fields: {
          "task.id": taskId,
          ...(task?.kind === undefined ? {} : { "task.kind": task.kind }),
          ...(task?.projectId == null ? {} : { "project.id": task.projectId }),
          hourLocal,
        },
      });
      continue;
    }

    // run.status_changed
    const source = runOutcomeSource(readString(row.payload, "to") ?? "");
    if (source === null) continue;

    const runId = readString(row.payload, "runId");
    const run = runId === null ? undefined : runContexts.get(runId);
    if (run === undefined) continue;

    const task = taskContexts.get(run.taskId);
    const harness = harnessSlug(run.harnessKey);
    // Monstro derrotado é vitória **que fechou** um `BUG`: um Run que terminou
    // bem mas devolveu `blocked` deixou a Task viva, e o Monstro também.
    const monster =
      source === "run.succeeded" && task?.kind === "BUG" && task.status === "COMPLETED";

    events.push({
      source,
      at: at.toISOString(),
      runId: run.id,
      taskId: run.taskId,
      fields: {
        "task.id": run.taskId,
        ...(task?.kind === undefined ? {} : { "task.kind": task.kind }),
        ...(task?.projectId == null ? {} : { "project.id": task.projectId }),
        "run.executionMode": run.executionMode,
        "run.harness": harness,
        "run.resumedFrom": run.resumedFromRunId === null ? "ABSENT" : "PRESENT",
        "run.workflowVersionId": run.workflowVersionId === null ? "ABSENT" : "PRESENT",
        "agent.id": run.loadoutSnapshot.agent.id,
        hourLocal,
      },
      metrics: { "run.durationMs": durationOf(run) },
    });

    heroes.push({
      agentId: run.loadoutSnapshot.agent.id,
      loadoutId: run.loadoutId,
      outcome: {
        outcome: heroOutcome(source),
        harness,
        executionMode: run.executionMode,
        monster,
      },
    });
  }

  const ultima = rows[rows.length - 1];
  return {
    events,
    heroes,
    rows: rows.length,
    cursor:
      ultima === undefined
        ? null
        : { positionAt: new Date(ultima.created_at), positionId: ultima.id },
  };
}

async function drainRunEvents(db: DatabaseExecutor, ctx: DrainContext): Promise<Batch> {
  const cursor = await readCursor(db, { userId: ctx.userId, source: "run_event" });
  const depois = afterCursor(cursor, "e");

  const rows = (
    await db.execute<{ id: string; created_at: Date; run_id: string; payload: unknown }>(
      sql`select e.id, e.created_at, e.run_id, e.payload
          from run_event e
          where e.user_id = ${ctx.userId}
            and e.type = 'Usage'
            and e.created_at <= ${ctx.cutoff}::timestamptz
            ${depois === undefined ? sql`` : sql`and ${depois}`}
          order by e.created_at, e.id
          limit ${ctx.batchSize}`,
    )
  ).rows;

  if (rows.length === 0) return EMPTY_BATCH;

  const runIds = [...new Set(rows.map((row) => row.run_id))];
  const runContexts = await loadRunContexts(db, { userId: ctx.userId, runIds });

  const heroes: HeroDelta[] = [];

  for (const row of rows) {
    const run = runContexts.get(row.run_id);
    if (run === undefined) continue;

    const tokens = totalTokens(row.payload);
    if (tokens === 0) continue;

    heroes.push({ agentId: run.loadoutSnapshot.agent.id, loadoutId: run.loadoutId, tokens });
  }

  const ultima = rows[rows.length - 1];
  return {
    events: [],
    heroes,
    rows: rows.length,
    cursor:
      ultima === undefined
        ? null
        : { positionAt: new Date(ultima.created_at), positionId: ultima.id },
  };
}

/** Soma os quatro campos de `UsageSummary`. Um campo ausente vale zero. */
function totalTokens(payload: unknown): number {
  if (typeof payload !== "object" || payload === null) return 0;
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return 0;

  const campos = [
    "inputTokens",
    "outputTokens",
    "cacheReadInputTokens",
    "cacheCreationInputTokens",
  ] as const;

  let total = 0;
  for (const campo of campos) {
    const valor = (usage as Record<string, unknown>)[campo];
    if (typeof valor === "number" && Number.isFinite(valor) && valor > 0) total += valor;
  }
  return Math.floor(total);
}

async function drainDashboardEvents(db: DatabaseExecutor, ctx: DrainContext): Promise<Batch> {
  const cursor = await readCursor(db, { userId: ctx.userId, source: "dashboard_event" });
  const desde = cursor?.positionId === null ? null : Number(cursor?.positionId ?? Number.NaN);
  const depois = Number.isSafeInteger(desde) ? (desde as number) : null;

  const rows = (
    await db.execute<{ sequence: string; created_at: Date; type: string; payload: unknown }>(
      sql`select d.sequence, d.created_at, d.type, d.payload
          from dashboard_event d
          where d.user_id = ${ctx.userId}
            and d.created_at <= ${ctx.cutoff}::timestamptz
            and d.type in (${sql.join(
              DASHBOARD_TYPES.map((type) => sql`${type}`),
              sql`, `,
            )})
            ${depois === null ? sql`` : sql`and d.sequence > ${depois}`}
          order by d.sequence
          limit ${ctx.batchSize}`,
    )
  ).rows;

  if (rows.length === 0) return EMPTY_BATCH;

  const events: ProjectionEvent[] = [];

  for (const row of rows) {
    // O tipo do evento **é** a fonte da condição: os três nomes são os mesmos
    // do vocabulário fechado, e é por isso que nada precisa ser traduzido aqui.
    const at = new Date(row.created_at);
    events.push({
      source: row.type as ProjectionEvent["source"],
      at: at.toISOString(),
      runId: readString(row.payload, "runId"),
      taskId: readString(row.payload, "taskId"),
      fields: { hourLocal: ctx.timeZoneHour(at) },
    });
  }

  const ultima = rows[rows.length - 1];
  return {
    events,
    heroes: [],
    rows: rows.length,
    cursor: ultima === undefined ? null : { positionAt: null, positionId: String(ultima.sequence) },
  };
}

// --------------------------------------------------------------------------
// Aplicação do lote
// --------------------------------------------------------------------------

interface UnlockRecord {
  readonly definition: AchievementDefinitionRow;
  readonly tier: number;
  readonly at: Date;
  readonly runId: string | null;
  readonly taskId: string | null;
}

interface ApplyResult {
  readonly unlocked: number;
}

function heroKey(scope: HeroScope, scopeId: string): string {
  return `${scope}:${scopeId}`;
}

async function loadHeroStates(
  db: DatabaseExecutor,
  input: { userId: string; keys: readonly [HeroScope, string][] },
): Promise<Map<string, HeroStatsState>> {
  const estados = new Map<string, HeroStatsState>();
  if (input.keys.length === 0) return estados;

  const ids = [...new Set(input.keys.map(([, scopeId]) => scopeId))];

  const rows = await db
    .select()
    .from(heroStats)
    .where(and(eq(heroStats.userId, input.userId), inArray(heroStats.scopeId, ids)));

  for (const row of rows) {
    estados.set(heroKey(row.scope, row.scopeId), {
      xp: row.xp,
      level: row.level,
      expeditions: row.expeditions,
      victories: row.victories,
      defeats: row.defeats,
      monstersSlain: row.monstersSlain,
      dockerVictories: row.dockerVictories,
      tokens: row.tokens,
      harnessCounts: row.harnessCounts,
    });
  }

  return estados;
}

/**
 * Dobra o lote sobre as definições e grava tudo numa transação.
 *
 * A ordem importa e é sempre a mesma: os fatos são avaliados na ordem em que
 * foram gravados, e as definições na ordem da chave natural. É o que faz a
 * reconstrução produzir exatamente os mesmos desbloqueios.
 */
async function applyBatch(
  tx: DatabaseExecutor,
  input: {
    userId: string;
    batch: Batch;
    logger?: EventsLogger | undefined;
  },
): Promise<ApplyResult> {
  const { userId, batch } = input;

  const linhas = await listAchievementDefinitionRows(tx, { userId });
  const progressoRows = await listAchievementProgressRows(tx, { userId });
  const progressoPorId = new Map(progressoRows.map((row) => [row.definitionId, row]));

  // A condição gravada é revalidada uma vez por lote, e não por fato: uma linha
  // com predicado ou campo desconhecido — de uma versão futura do catálogo, ou
  // de uma edição manual — sai do caminho com log e **nunca desbloqueia nada**.
  // É o mesmo fail-closed do carregador do catálogo, aplicado do lado do banco.
  const definicoes: { row: AchievementDefinitionRow; condition: Condition }[] = [];

  for (const row of linhas) {
    const parsed = parseCondition(row.condition);
    if (!parsed.ok) {
      input.logger?.warn?.(
        { definitionId: row.id, key: row.naturalKey, error: parsed.error },
        "achievement_definition_invalid",
      );
      continue;
    }
    definicoes.push({ row, condition: parsed.value });
  }

  const estados = new Map<string, PureProgress>();
  const alterados = new Set<string>();
  const desbloqueios: UnlockRecord[] = [];

  for (const { row } of definicoes) {
    estados.set(row.id, toPureProgress(progressoPorId.get(row.id)));
  }

  for (const event of batch.events) {
    const at = new Date(event.at);

    for (const { row, condition } of definicoes) {
      // A definição só conta o que aconteceu depois de ela passar a existir.
      // Sem isto, uma instância de template criada hoje premiaria o passado —
      // e a reconstrução, que instancia tudo de uma vez, divergiria do que o
      // projetor ao vivo produziu.
      if (row.effectiveFrom !== null && at < row.effectiveFrom) continue;

      const antes = estados.get(row.id) ?? toPureProgress(undefined);
      const resultado = applyEvent(condition, antes, event);
      if (!resultado.changed) continue;

      estados.set(row.id, resultado.progress);
      alterados.add(row.id);

      for (const tier of resultado.unlocked) {
        desbloqueios.push({ definition: row, tier, at, runId: event.runId, taskId: event.taskId });
      }
    }
  }

  // ------------------------------------------------------------- progresso
  for (const definitionId of alterados) {
    const estado = estados.get(definitionId);
    if (estado === undefined) continue;

    await tx
      .insert(achievementProgress)
      .values({
        definitionId,
        userId,
        counter: estado.counter,
        bestValue: estado.best,
        currentStreak: estado.streak,
        bestStreak: estado.bestStreak,
        state: { seen: [...estado.seen] },
      })
      .onConflictDoUpdate({
        target: [achievementProgress.definitionId, achievementProgress.userId],
        set: {
          counter: estado.counter,
          bestValue: estado.best,
          currentStreak: estado.streak,
          bestStreak: estado.bestStreak,
          state: { seen: [...estado.seen] },
          updatedAt: new Date(),
        },
      });
  }

  // ---------------------------------------------------------- desbloqueios
  const linhasInseridas: { id: string; record: UnlockRecord }[] = [];

  for (const desbloqueio of desbloqueios) {
    const linhas = await tx
      .insert(achievementUnlocks)
      .values({
        id: newId(),
        definitionId: desbloqueio.definition.id,
        userId,
        tier: desbloqueio.tier,
        runId: desbloqueio.runId,
        taskId: desbloqueio.taskId,
        unlockedAt: desbloqueio.at,
      })
      // A unicidade `(definition_id, user_id, tier)` **é** a idempotência: um
      // reprocessamento não desbloqueia duas vezes, e o `returning` vazio diz
      // que a linha já existia — o que também evita um segundo toast.
      .onConflictDoNothing({
        target: [
          achievementUnlocks.definitionId,
          achievementUnlocks.userId,
          achievementUnlocks.tier,
        ],
      })
      .returning({ id: achievementUnlocks.id });

    const linha = linhas[0];
    if (linha === undefined) continue;

    linhasInseridas.push({ id: linha.id, record: desbloqueio });
  }

  if (linhasInseridas.length > 0) {
    const labels = await resolveScopeLabels(tx, {
      userId,
      rows: linhasInseridas.map((entry) => entry.record.definition),
    });

    for (const { id, record } of linhasInseridas) {
      const definicao = record.definition;
      const nome = formatDefinitionName(definicao, labels);
      const rotulos = definicao.tiers;
      const escala = definicao.tierRarities;

      await appendDashboardEvent(tx, {
        userId,
        type: "achievement.unlocked",
        payload: {
          unlockId: id,
          definitionId: definicao.id,
          key: definicao.catalogKey ?? definicao.templateKey,
          origin: definicao.origin,
          name: nome,
          icon: definicao.icon,
          rarity: escala?.[record.tier - 1] ?? definicao.rarity,
          flavor: definicao.flavor,
          tier: record.tier,
          tierLabel:
            rotulos === null || rotulos.length <= 1 ? null : (rotulos[record.tier - 1] ?? null),
          runId: record.runId,
          taskId: record.taskId,
          unlockedAt: record.at.toISOString(),
        },
      });
    }
  }

  // ------------------------------------------------------ estatísticas
  const chaves: [HeroScope, string][] = [];
  for (const delta of batch.heroes) {
    if (delta.agentId !== null) chaves.push(["AGENT", delta.agentId]);
    chaves.push(["LOADOUT", delta.loadoutId]);
  }

  const heroEstados = await loadHeroStates(tx, { userId, keys: chaves });
  const heroAlterados = new Set<string>();

  const aplicar = (scope: HeroScope, scopeId: string, delta: HeroDelta): void => {
    const chave = heroKey(scope, scopeId);
    const atual = heroEstados.get(chave) ?? EMPTY_HERO_STATS;
    const proximo =
      delta.outcome !== undefined
        ? applyRunOutcome(atual, delta.outcome)
        : applyUsage(atual, delta.tokens ?? 0);

    if (proximo === atual) return;
    heroEstados.set(chave, proximo);
    heroAlterados.add(`${scope} ${scopeId}`);
  };

  for (const delta of batch.heroes) {
    if (delta.agentId !== null) aplicar("AGENT", delta.agentId, delta);
    aplicar("LOADOUT", delta.loadoutId, delta);
  }

  for (const chave of heroAlterados) {
    const [scope, scopeId] = chave.split(" ") as [HeroScope, string];
    const estado = heroEstados.get(heroKey(scope, scopeId));
    if (estado === undefined) continue;

    const guilda = topHarness(estado.harnessCounts);
    const values = {
      id: newId(),
      userId,
      scope,
      scopeId,
      xp: estado.xp,
      level: estado.level,
      expeditions: estado.expeditions,
      victories: estado.victories,
      defeats: estado.defeats,
      monstersSlain: estado.monstersSlain,
      dockerVictories: estado.dockerVictories,
      tokens: estado.tokens,
      harnessCounts: estado.harnessCounts as Record<string, number>,
      topHarness: guilda,
    };

    const { id: _id, userId: _userId, scope: _scope, scopeId: _scopeId, ...atualizacao } = values;

    await tx
      .insert(heroStats)
      .values(values)
      .onConflictDoUpdate({
        target: [heroStats.userId, heroStats.scope, heroStats.scopeId],
        set: { ...atualizacao, updatedAt: new Date() },
      });

    await appendDashboardEvent(tx, {
      userId,
      type: "hero_stats.updated",
      payload: {
        scope,
        scopeId,
        xp: estado.xp,
        level: estado.level,
        expeditions: estado.expeditions,
        victories: estado.victories,
        defeats: estado.defeats,
        monstersSlain: estado.monstersSlain,
        topHarness: guilda,
      },
    });
  }

  return { unlocked: linhasInseridas.length };
}

// --------------------------------------------------------------------------
// Passe completo
// --------------------------------------------------------------------------

export interface ProjectAchievementsOptions {
  userId: string;
  /** O catálogo já validado. Uma entrada torta nunca chega aqui. */
  definitions: readonly AchievementDefinition[];
  templates: readonly AchievementTemplate[];
  catalogVersion?: string;
  /** Atraso de segurança sobre `created_at`. Zero só em teste e no `rebuild`. */
  lagMs?: number;
  batchSize?: number;
  logger?: EventsLogger;
  now?: () => Date;
  /**
   * Quando sincronizar o catálogo e instanciar os templates.
   *
   * `always` faz a sincronização de saída, antes de olhar as fontes: é o que o
   * boot do Worker e o `rebuild` querem, porque os dois precisam das definições
   * existindo mesmo que não haja um único fato para processar.
   *
   * `lazy` adia a sincronização para o primeiro lote **com fatos**, dentro da
   * transação dele. É o que o laço quer: um Worker parado bate em três consultas
   * indexadas por tique e não escreve nada, em vez de reescrever as quinze
   * linhas do catálogo a cada segundo. A entidade que instancia um template já
   * está gravada quando o fato dela aparece na fila, então adiar não perde nada.
   */
  sync?: "always" | "lazy";
}

export interface AchievementProjectionReport {
  readonly ok: boolean;
  readonly processed: number;
  readonly unlocked: number;
  readonly error: string | null;
}

const SOURCES = ["activity", "run_event", "dashboard_event"] as const;

function drainerFor(source: AchievementSource) {
  switch (source) {
    case "activity":
      return drainActivity;
    case "run_event":
      return drainRunEvents;
    case "dashboard_event":
      return drainDashboardEvents;
  }
}

/**
 * Um passe do projetor. **Nunca lança.**
 *
 * Sincroniza o catálogo, instancia os templates das entidades que já existem e
 * drena as três fontes até esvaziar. Cada lote é uma transação: progresso,
 * desbloqueios, estatísticas, eventos de dashboard e o avanço do cursor saem
 * juntos ou não saem. Uma falha deixa o cursor onde estava, e o passe seguinte
 * tenta o mesmo lote de novo.
 */
export async function projectAchievements(
  db: Database,
  options: ProjectAchievementsOptions,
): Promise<AchievementProjectionReport> {
  const lagMs = options.lagMs ?? PROJECTOR_LAG_MS;
  const batchSize = options.batchSize ?? PROJECTOR_BATCH_SIZE;
  const now = options.now ?? (() => new Date());
  const logger = options.logger;

  let processed = 0;
  let unlocked = 0;

  // A sincronização acontece no máximo uma vez por passe. Com `lazy` ela é
  // adiada para dentro da transação do primeiro lote com fatos; se essa
  // transação falhar, o passe inteiro aborta e o passe seguinte sincroniza de
  // novo, então a marca nunca sobrevive a um rollback.
  let sincronizado = false;

  const sincronizar = async (tx: DatabaseExecutor): Promise<void> => {
    if (sincronizado) return;

    await syncCatalogDefinitions(tx, {
      userId: options.userId,
      definitions: options.definitions,
      ...(options.catalogVersion === undefined ? {} : { catalogVersion: options.catalogVersion }),
    });
    await syncTemplateInstances(tx, {
      userId: options.userId,
      templates: options.templates,
      ...(logger === undefined ? {} : { logger }),
    });

    sincronizado = true;
  };

  try {
    if ((options.sync ?? "always") === "always") {
      await db.transaction(sincronizar);
    }

    const ctx: DrainContext = {
      userId: options.userId,
      cutoff: new Date(now().getTime() - lagMs),
      batchSize,
      // O fuso é o do processo que projeta, e está documentado em `EventFields`.
      timeZoneHour: (at) => at.getHours(),
    };

    for (const source of SOURCES) {
      const drenar = drainerFor(source);

      for (;;) {
        const resultado = await db.transaction(async (tx) => {
          const batch = await drenar(tx, ctx);
          if (batch.rows === 0 || batch.cursor === null) return { rows: 0, unlocked: 0 };

          // Antes de aplicar, e não antes de drenar: o que instancia um template
          // é o estado atual, e o fato que a entidade produziu já está no lote.
          await sincronizar(tx);

          const aplicado = await applyBatch(tx, {
            userId: options.userId,
            batch,
            ...(logger === undefined ? {} : { logger }),
          });

          await writeCursor(tx, {
            userId: options.userId,
            source,
            positionAt: batch.cursor.positionAt,
            positionId: batch.cursor.positionId,
          });

          return { rows: batch.rows, unlocked: aplicado.unlocked };
        });

        processed += resultado.rows;
        unlocked += resultado.unlocked;

        if (resultado.rows < batchSize) break;
      }
    }

    if (unlocked > 0) {
      logger?.info?.({ processed, unlocked }, "achievement_projector_unlocked");
    }

    return { ok: true, processed, unlocked, error: null };
  } catch (error) {
    // O contrato é não lançar: uma Conquista é cosmética e não pode alcançar a
    // execução de um Run. O cursor não avançou, então nada foi perdido.
    const message = error instanceof Error ? error.message : String(error);
    logger?.error?.({ err: error, processed, unlocked }, "achievement_projector_failed");
    return { ok: false, processed, unlocked, error: message };
  }
}

/**
 * Zera progresso, desbloqueios, estatísticas e cursores, e reprojeta do início.
 *
 * As definições **não** são apagadas: elas guardam o `effective_from` derivado
 * dos dados duráveis, e apagá-las só para recriá-las com o mesmo valor seria
 * cerimônia. As instâncias de template são recalculadas do estado atual no
 * mesmo passe, então uma reconstrução também conserta uma instância que faltava.
 *
 * Roda sem atraso de segurança por padrão: quem reconstrói é um operador, e o
 * que ele quer é o estado completo do que já está commitado.
 */
export async function rebuildAchievements(
  db: Database,
  options: ProjectAchievementsOptions,
): Promise<AchievementProjectionReport> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(achievementUnlocks).where(eq(achievementUnlocks.userId, options.userId));
      await tx.delete(achievementProgress).where(eq(achievementProgress.userId, options.userId));
      await tx.delete(heroStats).where(eq(heroStats.userId, options.userId));
      await tx.delete(achievementCursors).where(eq(achievementCursors.userId, options.userId));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.logger?.error?.({ err: error }, "achievement_rebuild_truncate_failed");
    return { ok: false, processed: 0, unlocked: 0, error: message };
  }

  // `always` mesmo que o chamador peça `lazy`: uma reconstrução apagou o
  // progresso e precisa das definições de volta ainda que não exista um único
  // fato para reprocessar.
  return await projectAchievements(db, { ...options, lagMs: options.lagMs ?? 0, sync: "always" });
}

/** Quantas definições existem hoje. Usada pelo comando de reconstrução no log. */
export async function countAchievementDefinitions(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(achievementDefinitions)
    .where(eq(achievementDefinitions.userId, input.userId));

  return row?.total ?? 0;
}
