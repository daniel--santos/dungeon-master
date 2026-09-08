import { buildFtsQuery } from "@dungeon-master/context";
import type { KnowledgeItemProvenance, UsageSummary } from "@dungeon-master/contracts";
import type { EventsLogger } from "@dungeon-master/events";
import type {
  ApplyDecisionsInput,
  ApplyDecisionsResult,
  DistillCandidate,
  ExistingKnowledgeItem,
  KnowledgeStore,
  LockedProjectStore,
  LockOutcome,
  NotableFacts,
  NotableRun,
  ProjectContext,
  RunTranscript,
  SummaryTriggerFacts,
  UpsertSummaryInput,
} from "@dungeon-master/knowledge";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { harnessSlug } from "./achievement.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import {
  createDistillationRun,
  finishDistillationRun,
  latestDistillationRun,
} from "./distillation.js";
import { createForgedAchievement } from "./forged-achievement.js";
import { newId } from "./ids.js";
import { summaryUpdatedAt } from "./knowledge-item.js";
import { findProjectRow } from "./project.js";
import { achievementDefinitions } from "./schema/achievement.js";
import { knowledgeCandidates } from "./schema/knowledge-candidate.js";
import {
  KNOWLEDGE_FTS_CONFIG,
  type KnowledgeItemRow,
  knowledgeItems,
} from "./schema/knowledge-item.js";
import { runs } from "./schema/run.js";
import { tasks } from "./schema/task.js";
import { TASK_REOPENING_ACTIVITY } from "./task.js";

/**
 * O lado do banco do Distiller: a implementação das portas de
 * `@dungeon-master/knowledge` (planejamento v0.4, Fase 6).
 *
 * Tudo o que o lote escreve passa por `withProjectLock`, que abre a
 * transação e tenta o `pg_advisory_xact_lock` derivado do Project; o
 * `DistillationRun` é criado e terminado **fora** dela, pelo pool, para
 * sobreviver ao rollback de um lote que falhou (documento técnico, seção
 * 20.1). O Worker só faz a fiação: `createDatabaseKnowledgeStore` já é a
 * porta pronta.
 */

// --------------------------------------------------------------------------
// O lock
// --------------------------------------------------------------------------

/**
 * Tenta o advisory lock transacional do Project. `false` quando outro lote
 * está com ele: o chamador desiste sem esperar, e o Project é tentado de
 * novo no próximo tique.
 *
 * `hashtext` reduz o uuid a um inteiro de 32 bits; o prefixo separa este
 * lock de qualquer outro que venha a usar o mesmo id com outro sentido.
 */
export async function tryKnowledgeProjectLock(
  db: DatabaseExecutor,
  projectId: string,
): Promise<boolean> {
  const { rows } = await db.execute<{ acquired: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtext(${`knowledge:${projectId}`})) as acquired`,
  );
  return rows[0]?.acquired === true;
}

// --------------------------------------------------------------------------
// Leituras do lote
// --------------------------------------------------------------------------

export async function listPendingKnowledgeCandidates(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string; limit: number },
): Promise<DistillCandidate[]> {
  const rows = await db
    .select()
    .from(knowledgeCandidates)
    .where(
      and(
        eq(knowledgeCandidates.userId, input.userId),
        eq(knowledgeCandidates.projectId, input.projectId),
        eq(knowledgeCandidates.status, "PENDING"),
      ),
    )
    .orderBy(asc(knowledgeCandidates.createdAt), asc(knowledgeCandidates.id))
    .limit(input.limit);

  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    taskId: row.taskId,
    title: row.title,
    content: row.content,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Quantos eventos de texto entram no trecho de um Run. A cauda é cortada depois, pelo Distiller. */
const TRANSCRIPT_EVENT_LIMIT = 200;

/**
 * O L0 de cada Run: o resumo do resultado e o texto do agente, na ordem.
 *
 * Só `TextDelta`: chamadas de ferramenta e diagnósticos são ruído para quem
 * julga um candidato, e o filtro de ruído do Distiller cuida do que a CLI
 * injeta dentro do texto. Os últimos eventos, e não os primeiros: o fim é
 * onde o agente resume.
 */
export async function loadRunTranscripts(
  db: DatabaseExecutor,
  input: { userId: string; runIds: readonly string[] },
): Promise<RunTranscript[]> {
  if (input.runIds.length === 0) return [];

  const cabecalhos = await db
    .select({ id: runs.id, result: runs.result, taskTitle: tasks.title })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(and(eq(runs.userId, input.userId), inArray(runs.id, [...input.runIds])));

  const transcripts: RunTranscript[] = [];

  for (const cabecalho of cabecalhos) {
    const { rows } = await db.execute<{ text: string | null }>(
      sql`select e.payload ->> 'text' as text
          from run_event e
          where e.user_id = ${input.userId}
            and e.run_id = ${cabecalho.id}
            and e.type = 'TextDelta'
          order by e.sequence desc
          limit ${TRANSCRIPT_EVENT_LIMIT}`,
    );
    const texto = rows
      .map((row) => row.text ?? "")
      .reverse()
      .join("");

    const summary = cabecalho.result?.summary;
    transcripts.push({
      runId: cabecalho.id,
      taskTitle: cabecalho.taskTitle,
      summary: typeof summary === "string" ? summary : null,
      transcript: texto,
    });
  }

  return transcripts;
}

// A consulta de recall — as palavras do candidato, em OR, as doze mais longas
// — é `buildFtsQuery` de `@dungeon-master/context`: a mesma definição de "o
// que é parecido com este texto" que o montador de contexto usa (Fase 7).

function toExistingItem(row: KnowledgeItemRow): ExistingKnowledgeItem {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Os itens parecidos com um texto, por FTS, para o julgamento de duplicata.
 *
 * Só itens que estão ou podem vir a estar no Grimório (`ACTIVE` e
 * `PENDING_REVIEW`), nunca o `SUMMARY`. Um erro do FTS — uma consulta que o
 * parser recusa, por exemplo — vira lista vazia: o funil é fail-open.
 */
export async function recallSimilarKnowledgeItems(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string; text: string; limit: number },
): Promise<ExistingKnowledgeItem[]> {
  const consulta = buildFtsQuery(input.text);
  if (consulta === null) return [];

  // Num savepoint: um erro do PostgreSQL dentro da transação do lote a
  // abortaria inteira, e o `catch` do JavaScript não a traria de volta. O
  // savepoint desfaz só a consulta, e o lote segue com o pool vazio.
  try {
    return await db.transaction(async (sp) => {
      const rows = await sp
        .select()
        .from(knowledgeItems)
        .where(
          and(
            eq(knowledgeItems.userId, input.userId),
            eq(knowledgeItems.projectId, input.projectId),
            ne(knowledgeItems.type, "SUMMARY"),
            inArray(knowledgeItems.status, ["ACTIVE", "PENDING_REVIEW"]),
            sql`${knowledgeItems.search} @@ to_tsquery(${KNOWLEDGE_FTS_CONFIG}, ${consulta})`,
          ),
        )
        .orderBy(
          sql`ts_rank(${knowledgeItems.search}, to_tsquery(${KNOWLEDGE_FTS_CONFIG}, ${consulta})) desc`,
          desc(knowledgeItems.createdAt),
        )
        .limit(input.limit);

      return rows.map(toExistingItem);
    });
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------
// As decisões
// --------------------------------------------------------------------------

function provenanceBase(input: {
  candidateId: string | null;
  runId: string | null;
  taskId: string | null;
  distillationRunId: string;
  harnessSessionId: string | null;
  usage: UsageSummary | null;
}): KnowledgeItemProvenance {
  return {
    candidateId: input.candidateId,
    runId: input.runId,
    taskId: input.taskId,
    distillationRunId: input.distillationRunId,
    harnessSessionId: input.harnessSessionId,
    usage: input.usage,
    mergedCandidateIds: [],
    coveredItemIds: [],
  };
}

/**
 * Grava as decisões de um lote: os itens novos, as mesclas e o destino de
 * cada candidato, mais `knowledge.distilled` e — para cada item que nasce
 * `ACTIVE` — `knowledge_item.promoted`, o fato do projetor de Conquistas.
 *
 * Um candidato que já não está `PENDING` é pulado: outro lote o decidiu
 * antes (o que o lock impede, mas o `WHERE` não custa nada). Uma mescla cujo
 * alvo sumiu vira promoção: duplicar antes de perder.
 */
export async function applyKnowledgeDecisions(
  db: DatabaseExecutor,
  input: ApplyDecisionsInput & { userId: string; projectId: string },
): Promise<ApplyDecisionsResult> {
  const agora = new Date();
  const status = input.humanReview ? ("PENDING_REVIEW" as const) : ("ACTIVE" as const);
  const itemPorCandidato = new Map<string, string>();
  const createdItemIds: string[] = [];
  let promoted = 0;
  let rejected = 0;
  let merged = 0;

  const candidateIds = input.decisions.map((decision) => decision.candidateId);
  const linhas =
    candidateIds.length === 0
      ? []
      : await db
          .select()
          .from(knowledgeCandidates)
          .where(
            and(
              eq(knowledgeCandidates.userId, input.userId),
              eq(knowledgeCandidates.projectId, input.projectId),
              inArray(knowledgeCandidates.id, candidateIds),
              eq(knowledgeCandidates.status, "PENDING"),
            ),
          );
  const porId = new Map(linhas.map((row) => [row.id, row]));

  const promover = async (
    candidate: (typeof linhas)[number],
    item: { type: KnowledgeItemRow["type"]; title: string; content: string },
    reason: string,
  ): Promise<void> => {
    const id = newId();
    await db.insert(knowledgeItems).values({
      id,
      userId: input.userId,
      projectId: input.projectId,
      type: item.type,
      status,
      title: item.title,
      content: item.content,
      provenance: provenanceBase({
        candidateId: candidate.id,
        runId: candidate.runId,
        taskId: candidate.taskId,
        distillationRunId: input.distillationRunId,
        harnessSessionId: input.provenance.harnessSessionId,
        usage: input.provenance.usage,
      }),
      version: 1,
    });

    await db
      .update(knowledgeCandidates)
      .set({
        status: "PROMOTED",
        decision: "PROMOTE",
        reason,
        knowledgeItemId: id,
        distillationRunId: input.distillationRunId,
        processedAt: agora,
      })
      .where(eq(knowledgeCandidates.id, candidate.id));

    if (status === "ACTIVE") {
      await appendDashboardEvent(db, {
        userId: input.userId,
        type: "knowledge_item.promoted",
        payload: {
          knowledgeItemId: id,
          projectId: input.projectId,
          type: item.type,
          runId: candidate.runId,
          taskId: candidate.taskId,
        },
      });
    }

    itemPorCandidato.set(candidate.id, id);
    createdItemIds.push(id);
    promoted += 1;
  };

  for (const decision of input.decisions) {
    const candidate = porId.get(decision.candidateId);
    if (candidate === undefined) continue;

    const reason = `${decision.reason} [${decision.decidedBy === "RULE" ? "regra" : "modelo"}]`;

    if (decision.decision === "REJECT") {
      await db
        .update(knowledgeCandidates)
        .set({
          status: "REJECTED",
          decision: "REJECT",
          reason,
          distillationRunId: input.distillationRunId,
          processedAt: agora,
        })
        .where(eq(knowledgeCandidates.id, candidate.id));
      rejected += 1;
      continue;
    }

    if (decision.decision === "MERGE") {
      const alvoId =
        decision.mergeIntoItemId ??
        (decision.mergeIntoCandidateId === undefined
          ? undefined
          : itemPorCandidato.get(decision.mergeIntoCandidateId));

      const [alvo] =
        alvoId === undefined
          ? []
          : await db
              .select()
              .from(knowledgeItems)
              .where(
                and(
                  eq(knowledgeItems.id, alvoId),
                  eq(knowledgeItems.userId, input.userId),
                  eq(knowledgeItems.projectId, input.projectId),
                ),
              )
              .for("update");

      if (alvo === undefined) {
        await promover(
          candidate,
          decision.item ?? { type: "FACT", title: candidate.title, content: candidate.content },
          `${reason} (alvo da mescla não existe; promovido)`,
        );
        continue;
      }

      await db
        .update(knowledgeItems)
        .set({
          provenance: {
            ...alvo.provenance,
            mergedCandidateIds: [...alvo.provenance.mergedCandidateIds, candidate.id],
          },
        })
        .where(eq(knowledgeItems.id, alvo.id));

      await db
        .update(knowledgeCandidates)
        .set({
          status: "MERGED",
          decision: "MERGE",
          reason,
          knowledgeItemId: alvo.id,
          distillationRunId: input.distillationRunId,
          processedAt: agora,
        })
        .where(eq(knowledgeCandidates.id, candidate.id));
      merged += 1;
      continue;
    }

    await promover(
      candidate,
      decision.item ?? { type: "FACT", title: candidate.title, content: candidate.content },
      reason,
    );
  }

  if (promoted + rejected + merged > 0) {
    await appendDashboardEvent(db, {
      userId: input.userId,
      type: "knowledge.distilled",
      payload: {
        projectId: input.projectId,
        distillationRunId: input.distillationRunId,
        promoted,
        rejected,
        merged,
        pendingReview: status === "PENDING_REVIEW" ? promoted : 0,
        knowledgeItemIds: createdItemIds,
      },
    });
  }

  return { promoted, rejected, merged, createdItemIds };
}

// --------------------------------------------------------------------------
// O resumo
// --------------------------------------------------------------------------

async function findSummaryRow(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<KnowledgeItemRow | null> {
  const [row] = await db
    .select()
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.userId, input.userId),
        eq(knowledgeItems.projectId, input.projectId),
        eq(knowledgeItems.type, "SUMMARY"),
        ne(knowledgeItems.status, "ARCHIVED"),
      ),
    )
    .orderBy(desc(knowledgeItems.createdAt))
    .limit(1);

  return row ?? null;
}

function activeItemsWhere(input: { userId: string; projectId: string }) {
  return and(
    eq(knowledgeItems.userId, input.userId),
    eq(knowledgeItems.projectId, input.projectId),
    ne(knowledgeItems.type, "SUMMARY"),
    eq(knowledgeItems.status, "ACTIVE"),
  );
}

/** Os fatos que o gatilho de regeneração olha. */
export async function readSummaryTriggerFacts(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<SummaryTriggerFacts> {
  const summary = await findSummaryRow(db, input);

  const [ativos] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(knowledgeItems)
    .where(activeItemsWhere(input));
  const activeItemCount = ativos?.total ?? 0;

  if (summary === null) {
    return {
      requested: false,
      hasSummary: false,
      summaryHasContent: false,
      activeItemCount,
      promotedSinceSummary: activeItemCount,
      coveredItemsChanged: 0,
    };
  }

  const [novos] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(knowledgeItems)
    .where(
      and(
        activeItemsWhere(input),
        sql`coalesce(${knowledgeItems.reviewedAt}, ${knowledgeItems.createdAt}) > ${summaryUpdatedAt(summary.id)}`,
      ),
    );

  const cobertos = summary.provenance.coveredItemIds;
  const [mudados] =
    cobertos.length === 0
      ? [{ total: 0 }]
      : await db
          .select({ total: sql<number>`count(*)::int` })
          .from(knowledgeItems)
          .where(
            and(
              eq(knowledgeItems.userId, input.userId),
              inArray(knowledgeItems.id, [...cobertos]),
              sql`(${knowledgeItems.status} <> 'ACTIVE' or ${knowledgeItems.updatedAt} > ${summaryUpdatedAt(summary.id)})`,
            ),
          );

  return {
    requested: false,
    hasSummary: true,
    summaryHasContent: summary.content.trim().length > 0,
    activeItemCount,
    promotedSinceSummary: novos?.total ?? 0,
    coveredItemsChanged: mudados?.total ?? 0,
  };
}

export async function findCurrentSummary(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<ExistingKnowledgeItem | null> {
  const row = await findSummaryRow(db, input);
  return row === null ? null : toExistingItem(row);
}

export async function listActiveItemsForSummary(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string; limit: number },
): Promise<ExistingKnowledgeItem[]> {
  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(activeItemsWhere(input))
    .orderBy(asc(knowledgeItems.createdAt), asc(knowledgeItems.id))
    .limit(input.limit);

  return rows.map(toExistingItem);
}

/**
 * Regenera o resumo corrente ou cria o primeiro.
 *
 * Atualiza a linha em vez de inserir outra: o `SUMMARY` corrente é um por
 * Project, e a regra vive aqui e não num índice único parcial (ver o schema).
 * A `version` sobe a cada regeneração; o resumo nasce `ACTIVE` sempre — ele
 * não passa pela revisão porque é a consolidação de itens que já passaram.
 */
export async function upsertProjectSummary(
  db: DatabaseExecutor,
  input: UpsertSummaryInput & { userId: string; projectId: string },
): Promise<{ id: string }> {
  const atual = await findSummaryRow(db, input);
  const provenance: KnowledgeItemProvenance = {
    candidateId: null,
    runId: null,
    taskId: null,
    distillationRunId: input.distillationRunId,
    harnessSessionId: input.provenance.harnessSessionId,
    usage: input.provenance.usage,
    mergedCandidateIds: [],
    coveredItemIds: [...input.coveredItemIds],
  };

  if (atual !== null) {
    await db
      .update(knowledgeItems)
      .set({
        title: input.title,
        content: input.content,
        provenance,
        version: sql`${knowledgeItems.version} + 1`,
      })
      .where(eq(knowledgeItems.id, atual.id));
    return { id: atual.id };
  }

  const id = newId();
  await db.insert(knowledgeItems).values({
    id,
    userId: input.userId,
    projectId: input.projectId,
    type: "SUMMARY",
    status: "ACTIVE",
    title: input.title,
    content: input.content,
    provenance,
    version: 1,
  });
  return { id };
}

// --------------------------------------------------------------------------
// Os fatos da forja
// --------------------------------------------------------------------------

const TERMINAL = ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"] as const;
const NOTABLE_RUN_LIMIT = 100;

type NotableRunRow = {
  run_id: string;
  task_id: string;
  task_title: string;
  task_kind: NotableRun["taskKind"];
  task_status: string;
  reopenings: number;
  status: NotableRun["status"];
  harness_key: string;
  harness_name: string | null;
  duration_ms: number | null;
  finished_at: Date;
};

/**
 * O que a forja olha: os Runs terminados desde o lote anterior (ou os do
 * lote, o que vier a mais), a sequência de vitórias do Project, as primeiras
 * vitórias de Guilda, o recorde anterior e quantas Expedições passaram desde
 * a última forjada.
 *
 * Tudo derivado dos dados duráveis, como o projetor faz: `runsSinceLastForge`
 * conta Runs terminados depois do `created_at` da última definição `FORGED`
 * do usuário, em qualquer estado de revisão — descartar uma forjada não abre
 * espaço para outra na hora.
 */
export async function readNotableFacts(
  db: DatabaseExecutor,
  input: {
    userId: string;
    projectId: string;
    projectTitle: string;
    batchRunIds: readonly string[];
    sinceAt: Date | null;
  },
): Promise<NotableFacts> {
  const { rows } = await db.execute<NotableRunRow>(
    sql`select r.id as run_id, t.id as task_id, t.title as task_title, t.kind as task_kind,
               t.status as task_status, r.status, r.harness_key, h.name as harness_name,
               (extract(epoch from (r.finished_at - r.started_at)) * 1000)::bigint as duration_ms,
               r.finished_at,
               (select count(*)::int from activity a
                 where a.task_id = t.id and a.user_id = ${input.userId} and ${TASK_REOPENING_ACTIVITY}) as reopenings
        from run r
        join task t on t.id = r.task_id
        left join harness h on h.user_id = r.user_id and h.key = r.harness_key
        where r.user_id = ${input.userId}
          and t.project_id = ${input.projectId}
          and r.status in ('SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED')
          and r.finished_at is not null
          and (
            ${input.sinceAt === null ? sql`true` : sql`r.finished_at > ${input.sinceAt}`}
            ${
              input.batchRunIds.length === 0
                ? sql``
                : sql`or r.id in (${sql.join(
                    input.batchRunIds.map((id) => sql`${id}`),
                    sql`, `,
                  )})`
            }
          )
        order by r.finished_at asc, r.id asc
        limit ${NOTABLE_RUN_LIMIT}`,
  );

  const notableRuns: NotableRun[] = rows.map((row) => ({
    runId: row.run_id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    taskKind: row.task_kind,
    taskStatus: row.task_status,
    reopenings: Number(row.reopenings),
    status: row.status,
    harnessKey: row.harness_key,
    harnessSlug: harnessSlug(row.harness_key as Parameters<typeof harnessSlug>[0]),
    harnessName: row.harness_name ?? row.harness_key,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    finishedAt: new Date(row.finished_at).toISOString(),
  }));

  const runIds = notableRuns.map((run) => run.runId);

  // A sequência: os Runs terminados do Project, do mais recente para o mais
  // antigo, até a primeira derrota.
  const sequencia = await db
    .select({ status: runs.status })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(
      and(
        eq(runs.userId, input.userId),
        eq(tasks.projectId, input.projectId),
        inArray(runs.status, [...TERMINAL]),
      ),
    )
    .orderBy(desc(runs.finishedAt), desc(runs.id))
    .limit(1_000);

  let victoryStreak = 0;
  for (const linha of sequencia) {
    if (linha.status !== "SUCCEEDED") break;
    victoryStreak += 1;
  }

  // As primeiras vitórias de Guilda: entre as vitórias do lote, as que não
  // têm nenhuma vitória anterior do usuário com a mesma Guilda.
  const firstVictoryRunIds: string[] = [];
  for (const run of notableRuns) {
    if (run.status !== "SUCCEEDED") continue;
    const [anterior] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.userId, input.userId),
          eq(runs.status, "SUCCEEDED"),
          sql`${runs.harnessKey} = ${run.harnessKey}::harness_key`,
          sql`${runs.finishedAt} < ${new Date(run.finishedAt)}`,
        ),
      )
      .limit(1);
    if (anterior === undefined) firstVictoryRunIds.push(run.runId);
  }

  // O recorde anterior: as vitórias do Project fora do lote.
  const [anteriores] = await db
    .select({
      best: sql<
        number | null
      >`max(extract(epoch from (${runs.finishedAt} - ${runs.startedAt})) * 1000)`,
      total: sql<number>`count(*)::int`,
    })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(
      and(
        eq(runs.userId, input.userId),
        eq(tasks.projectId, input.projectId),
        eq(runs.status, "SUCCEEDED"),
        runIds.length === 0
          ? sql`true`
          : sql`${runs.id} not in (${sql.join(
              runIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
      ),
    );

  // O rate limit: Expedições terminadas desde a última forjada.
  const [ultimaForjada] = await db
    .select({ createdAt: achievementDefinitions.createdAt })
    .from(achievementDefinitions)
    .where(
      and(
        eq(achievementDefinitions.userId, input.userId),
        eq(achievementDefinitions.origin, "FORGED"),
      ),
    )
    .orderBy(desc(achievementDefinitions.createdAt))
    .limit(1);

  let runsSinceLastForge: number | null = null;
  if (ultimaForjada !== undefined) {
    const [desde] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(runs)
      .where(
        and(
          eq(runs.userId, input.userId),
          inArray(runs.status, [...TERMINAL]),
          sql`${runs.finishedAt} > ${ultimaForjada.createdAt}`,
        ),
      );
    runsSinceLastForge = desde?.total ?? 0;
  }

  return {
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    runs: notableRuns,
    victoryStreak,
    firstVictoryRunIds,
    previousBestDurationMs:
      anteriores?.best === null || anteriores?.best === undefined ? null : Number(anteriores.best),
    previousSuccessCount: anteriores?.total ?? 0,
    runsSinceLastForge,
  };
}

// --------------------------------------------------------------------------
// A porta pronta
// --------------------------------------------------------------------------

export interface DatabaseKnowledgeStoreOptions {
  readonly db: Database;
  readonly userId: string;
  readonly logger?: EventsLogger | undefined;
}

/**
 * A implementação de `KnowledgeStore` sobre o banco.
 *
 * Um `LockedProjectStore` por transação, fechado sobre o Project e o
 * executor da transação; o `DistillationRun` pelo pool. O `harnessSlug` e
 * o `harnessName` vão nos fatos da forja porque o pacote de conhecimento não
 * conhece o vocabulário das Conquistas nem o cadastro de Harness.
 */
export function createDatabaseKnowledgeStore(
  options: DatabaseKnowledgeStoreOptions,
): KnowledgeStore {
  const { db, userId } = options;

  const lockedStoreFor = (tx: DatabaseExecutor, projectId: string): LockedProjectStore => {
    let project: ProjectContext | null | undefined;
    const batchRunIds = new Set<string>();

    return {
      loadProject: async () => {
        if (project !== undefined) return project;
        const row = await findProjectRow(tx, { userId, projectId });
        project =
          row === null ? null : { id: row.id, title: row.title, description: row.description };
        return project;
      },

      listPendingCandidates: async (limit) => {
        const candidates = await listPendingKnowledgeCandidates(tx, { userId, projectId, limit });
        for (const candidate of candidates) batchRunIds.add(candidate.runId);
        return candidates;
      },

      loadRunTranscripts: (runIds) => loadRunTranscripts(tx, { userId, runIds }),

      recallSimilarItems: (text, limit) =>
        recallSimilarKnowledgeItems(tx, { userId, projectId, text, limit }),

      applyDecisions: (input) => applyKnowledgeDecisions(tx, { ...input, userId, projectId }),

      summaryFacts: () => readSummaryTriggerFacts(tx, { userId, projectId }),

      currentSummary: () => findCurrentSummary(tx, { userId, projectId }),

      listItemsForSummary: (limit) => listActiveItemsForSummary(tx, { userId, projectId, limit }),

      upsertSummary: (input) => upsertProjectSummary(tx, { ...input, userId, projectId }),

      notableFacts: async () => {
        const anterior = await latestDistillationRun(tx, { userId, projectId, finishedOnly: true });
        const atual = await findProjectRow(tx, { userId, projectId });
        return readNotableFacts(tx, {
          userId,
          projectId,
          projectTitle: atual?.title ?? projectId,
          batchRunIds: [...batchRunIds],
          sinceAt: anterior?.startedAt ?? null,
        });
      },

      createForgedAchievement: (input) => createForgedAchievement(tx, { userId, input }),
    };
  };

  return {
    createDistillationRun: (input) =>
      createDistillationRun(db, {
        userId,
        projectId: input.projectId,
        trigger: input.trigger,
        loadoutId: input.loadoutId,
      }),

    finishDistillationRun: (input) => finishDistillationRun(db, { userId, ...input }),

    withProjectLock: async <T>(
      projectId: string,
      fn: (locked: LockedProjectStore) => Promise<T>,
    ): Promise<LockOutcome<T>> =>
      await db.transaction(async (tx) => {
        const acquired = await tryKnowledgeProjectLock(tx, projectId);
        if (!acquired) {
          options.logger?.debug?.({ projectId }, "knowledge_project_locked");
          return { acquired: false as const };
        }
        const value = await fn(lockedStoreFor(tx, projectId));
        return { acquired: true as const, value };
      }),
  };
}
