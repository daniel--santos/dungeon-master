import type {
  ExecutionMode,
  HarnessKey,
  RunCreatedBy,
  RunStatus,
  TaskKind,
} from "@dungeon-master/contracts";
import { GATE_DECIDER_USER } from "@dungeon-master/contracts";
import type { EventsLogger } from "@dungeon-master/events";
import {
  costOfRun,
  NATIVE_TOOL_SERVER,
  priceAt,
  rollupDaily,
  toolServerOf,
  UNKNOWN_TOKENS,
  utcDay,
  type PriceWindow,
  type PricedRun,
  type RunMetricFacts,
  type TokenCounts,
} from "@dungeon-master/metrics";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { metricCursors, metricDaily, runMetrics, type MetricSource } from "./schema/metrics.js";

/**
 * O projetor de métricas (planejamento v0.4, Fase 10A).
 *
 * Consome por cursor **uma** fonte durável — o desfecho de `run` — e grava uma
 * linha em `run_metric` por Expedição terminal, mais o rollup de
 * `metric_daily` dos dias que o lote tocou. O avanço do cursor sai na mesma
 * transação do lote: um lote que falha não avança, e o passe seguinte refaz o
 * mesmo trabalho.
 *
 * ## Por que a fonte é `run.finished_at`, e não o `run_event` terminal
 *
 * `applyRunStatus` escreve `finished_at` em **toda** transição terminal, por
 * qualquer caminho — inclusive o cancelamento de um Run que ainda estava na
 * fila e nunca produziu evento de execução nenhum. E `SUCCEEDED`, `FAILED`,
 * `TIMED_OUT` e `CANCELLED` não têm saída na máquina de estados, o que dá
 * exatamente uma linha por Run: contar por ali é exatamente-uma-vez sem marca
 * extra. O `run_event` entra depois, como detalhe do Run já selecionado —
 * `Usage`, `ToolCall` e as aprovações.
 *
 * É a mesma escolha que o projetor de Conquistas fez ao preferir `activity` a
 * `run_event`, pelo mesmo motivo, com uma vantagem: a linha do Run já traz
 * todos os campos que a métrica copia, sem uma segunda leitura.
 *
 * ## A marca d'água
 *
 * `finished_at` é o relógio da aplicação no **início** da transação que fecha o
 * Run, e o commit vem depois: duas transações concorrentes podem ficar
 * visíveis fora de ordem. Por isso o projetor só lê Runs mais velhos que
 * {@link METRIC_PROJECTOR_LAG_MS}. Segurar um fato por um segundo é latência;
 * pular um fato é perda.
 *
 * ## Contrato: nunca lança
 *
 * Nenhuma falha daqui pode alcançar a execução de um Run. Um erro é logado, a
 * transação do lote é desfeita e o cursor fica onde estava.
 */

/** Atraso de segurança sobre `finished_at`, para não pular um commit fora de ordem. */
export const METRIC_PROJECTOR_LAG_MS = 1_000;

/** Runs por lote. Um lote é uma transação. */
export const METRIC_PROJECTOR_BATCH_SIZE = 200;

const SOURCE: MetricSource = "run";

// --------------------------------------------------------------------------
// Cursor
// --------------------------------------------------------------------------

/**
 * Onde o lote parou.
 *
 * `positionAt` é **texto**, e não `Date`, pelo mesmo motivo do cursor das
 * Conquistas: `timestamptz` tem precisão de microssegundo e o `Date` do
 * JavaScript só chega a milissegundo. Passar o instante por um `Date` truncaria
 * o valor e faria a última linha do lote voltar a casar com
 * `(finished_at, id) > (cursor)` no passe seguinte — o cursor ficaria parado,
 * reprocessando o mesmo Run para sempre.
 */
interface BatchCursor {
  readonly positionAt: string;
  readonly positionId: string;
}

async function readCursor(db: DatabaseExecutor, userId: string): Promise<BatchCursor | null> {
  const { rows } = await db.execute<{ position_at: string | null; position_id: string | null }>(
    sql`select c.position_at::text as position_at, c.position_id
        from metric_cursor c
        where c.user_id = ${userId}::uuid and c.source = ${SOURCE}::metric_source`,
  );

  const row = rows[0];
  if (row === undefined || row.position_id === null || row.position_at === null) return null;
  return { positionAt: row.position_at, positionId: row.position_id };
}

async function writeCursor(
  db: DatabaseExecutor,
  input: { userId: string } & BatchCursor,
): Promise<void> {
  await db.execute(
    sql`insert into metric_cursor (source, user_id, position_at, position_id, updated_at)
        values (
          ${SOURCE}::metric_source,
          ${input.userId}::uuid,
          ${input.positionAt}::timestamptz,
          ${input.positionId},
          now()
        )
        on conflict (source, user_id) do update
          set position_at = excluded.position_at,
              position_id = excluded.position_id,
              updated_at = now()`,
  );
}

// --------------------------------------------------------------------------
// Preços
// --------------------------------------------------------------------------

/** A chave de um Model dentro do cadastro: a chave é única **por Harness**. */
export function modelPriceKey(harnessKey: string, modelKey: string | null): string {
  return `${harnessKey}|${modelKey ?? ""}`;
}

/**
 * Todas as vigências de preço, indexadas por `(harness, chave do Model)`.
 *
 * Carregadas de uma vez: são poucas linhas — um punhado de Models, cada um com
 * o histórico dos reajustes —, e a alternativa seria uma consulta por Run.
 */
export async function loadPriceIndex(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<Map<string, PriceWindow[]>> {
  const { rows } = await db.execute<{
    harness_key: string;
    model_key: string;
    currency: string;
    input_per_million: string;
    output_per_million: string;
    cache_read_per_million: string;
    cache_write_per_million: string;
    effective_from: Date;
    effective_to: Date | null;
  }>(
    sql`select h.key as harness_key, m.key as model_key, p.currency,
               p.input_per_million, p.output_per_million,
               p.cache_read_per_million, p.cache_write_per_million,
               p.effective_from, p.effective_to
        from model_price p
        join model m on m.id = p.model_id
        join harness h on h.id = m.harness_id
        where p.user_id = ${input.userId}::uuid`,
  );

  const indice = new Map<string, PriceWindow[]>();

  for (const row of rows) {
    const chave = modelPriceKey(row.harness_key, row.model_key);
    const lista = indice.get(chave) ?? [];
    lista.push({
      currency: row.currency,
      inputPerMillion: Number(row.input_per_million),
      outputPerMillion: Number(row.output_per_million),
      cacheReadPerMillion: Number(row.cache_read_per_million),
      cacheWritePerMillion: Number(row.cache_write_per_million),
      effectiveFrom: new Date(row.effective_from).getTime(),
      effectiveTo: row.effective_to === null ? null : new Date(row.effective_to).getTime(),
    });
    indice.set(chave, lista);
  }

  return indice;
}

// --------------------------------------------------------------------------
// Detalhes de um Run: tokens, ferramentas, contexto, passos, gates, filhos
// --------------------------------------------------------------------------

interface RunDetails {
  readonly tokens: TokenCounts;
  readonly toolCallsByServer: Record<string, number>;
  readonly toolCalls: number;
  readonly stepsByType: Record<string, number>;
  readonly gatesGrantedUser: number;
  readonly gatesGrantedPolicy: number;
  readonly childrenDelegated: number;
  readonly context: {
    readonly tokens: number | null;
    readonly items: number | null;
    readonly sections: number | null;
    readonly truncations: number | null;
  };
}

const EMPTY_DETAILS: RunDetails = {
  tokens: UNKNOWN_TOKENS,
  toolCallsByServer: {},
  toolCalls: 0,
  stepsByType: {},
  gatesGrantedUser: 0,
  gatesGrantedPolicy: 0,
  childrenDelegated: 0,
  context: { tokens: null, items: null, sections: null, truncations: null },
};

function readNumber(source: unknown, key: string): number | null {
  if (typeof source !== "object" || source === null) return null;
  const valor = (source as Record<string, unknown>)[key];
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function somaTokens(tokens: TokenCounts): number {
  return (
    (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0)
  );
}

function somarPares(a: TokenCounts, b: TokenCounts): TokenCounts {
  const soma = (x: number | null, y: number | null): number | null =>
    x === null && y === null ? null : (x ?? 0) + (y ?? 0);
  return {
    input: soma(a.input, b.input),
    output: soma(a.output, b.output),
    cacheRead: soma(a.cacheRead, b.cacheRead),
    cacheWrite: soma(a.cacheWrite, b.cacheWrite),
  };
}

function usageDoPayload(payload: unknown): TokenCounts | null {
  if (typeof payload !== "object" || payload === null) return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;

  const tokens: TokenCounts = {
    input: readNumber(usage, "inputTokens"),
    output: readNumber(usage, "outputTokens"),
    cacheRead: readNumber(usage, "cacheReadInputTokens"),
    cacheWrite: readNumber(usage, "cacheCreationInputTokens"),
  };

  const algum =
    tokens.input !== null ||
    tokens.output !== null ||
    tokens.cacheRead !== null ||
    tokens.cacheWrite !== null;

  return algum ? tokens : null;
}

/**
 * Os tokens de um Run, a partir da sequência de eventos `Usage`.
 *
 * **`Usage` é um acumulado, não um incremento.** É o que o próprio
 * `agent-runtime.ts` assume ao fazer `usage = step.event.usage` a cada evento:
 * o último vale. Somar todos daria um número várias vezes maior que o real.
 *
 * Um Run com Workflow, porém, tem mais de uma tentativa de agente, e o
 * acumulado **reinicia** a cada uma. Por isso a regra é: acompanhe o acumulado
 * enquanto ele cresce e, quando ele cair, deposite o último valor da tentativa
 * anterior e comece a contar de novo. No caso comum — uma tentativa só — isso é
 * exatamente "o último `Usage` vale"; no caso do Workflow, é a soma das
 * tentativas, que é o que foi de fato consumido.
 */
export function foldUsageEvents(payloads: readonly unknown[]): TokenCounts {
  let depositado: TokenCounts | null = null;
  let atual: TokenCounts | null = null;

  for (const payload of payloads) {
    const tokens = usageDoPayload(payload);
    if (tokens === null) continue;

    if (atual !== null && somaTokens(tokens) < somaTokens(atual)) {
      depositado = depositado === null ? atual : somarPares(depositado, atual);
    }
    atual = tokens;
  }

  if (atual === null) return depositado ?? UNKNOWN_TOKENS;
  return depositado === null ? atual : somarPares(depositado, atual);
}

/**
 * Lê, de uma vez para o lote inteiro, tudo o que não está na linha do Run.
 *
 * Uma consulta por assunto e não uma por Run: um lote de duzentos Runs viraria
 * mil idas ao banco, e o projetor roda a cada tique.
 */
async function loadRunDetails(
  db: DatabaseExecutor,
  input: { userId: string; runIds: readonly string[] },
): Promise<Map<string, RunDetails>> {
  const detalhes = new Map<string, RunDetails>();
  if (input.runIds.length === 0) return detalhes;

  const ids = [...input.runIds];
  const parcial = new Map<
    string,
    {
      usage: unknown[];
      tools: Record<string, number>;
      toolCalls: number;
      steps: Record<string, number>;
      gatesUser: number;
      gatesPolicy: number;
      children: number;
      context: RunDetails["context"];
    }
  >();

  for (const id of ids) {
    parcial.set(id, {
      usage: [],
      tools: {},
      toolCalls: 0,
      steps: {},
      gatesUser: 0,
      gatesPolicy: 0,
      children: 0,
      context: { tokens: null, items: null, sections: null, truncations: null },
    });
  }

  // ------------------------------------------------------------- eventos
  const eventos = (
    await db.execute<{ run_id: string; type: string; payload: unknown }>(
      sql`select e.run_id, e.type, e.payload
          from run_event e
          where e.user_id = ${input.userId}::uuid
            and e.run_id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
            and e.type in ('Usage', 'ToolCall', 'ApprovalGranted')
          order by e.run_id, e.sequence`,
    )
  ).rows;

  for (const evento of eventos) {
    const alvo = parcial.get(evento.run_id);
    if (alvo === undefined) continue;

    if (evento.type === "Usage") {
      alvo.usage.push(evento.payload);
      continue;
    }

    if (evento.type === "ToolCall") {
      const payload = evento.payload as { name?: unknown };
      const nome = typeof payload?.name === "string" ? payload.name : NATIVE_TOOL_SERVER;
      const servidor = toolServerOf(nome);
      alvo.tools[servidor] = (alvo.tools[servidor] ?? 0) + 1;
      alvo.toolCalls += 1;
      continue;
    }

    // ApprovalGranted: `grantedBy` é `USER` ou `POLICY:<id>` (workflow-event.ts).
    const payload = evento.payload as { grantedBy?: unknown };
    const quem = typeof payload?.grantedBy === "string" ? payload.grantedBy : "";
    if (quem === GATE_DECIDER_USER) alvo.gatesUser += 1;
    else if (quem !== "") alvo.gatesPolicy += 1;
  }

  // --------------------------------------------------------------- passos
  const passos = (
    await db.execute<{ run_id: string; type: string; total: number }>(
      sql`select s.run_id, s.type::text as type, count(*)::int as total
          from run_step s
          where s.user_id = ${input.userId}::uuid
            and s.run_id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
          group by s.run_id, s.type`,
    )
  ).rows;

  for (const passo of passos) {
    const alvo = parcial.get(passo.run_id);
    if (alvo === undefined) continue;
    alvo.steps[passo.type] = passo.total;
  }

  // -------------------------------------------------------------- filhos
  const filhos = (
    await db.execute<{ parent_run_id: string; total: number }>(
      sql`select r.parent_run_id, count(*)::int as total
          from run r
          where r.user_id = ${input.userId}::uuid
            and r.parent_run_id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
          group by r.parent_run_id`,
    )
  ).rows;

  for (const filho of filhos) {
    const alvo = parcial.get(filho.parent_run_id);
    if (alvo === undefined) continue;
    alvo.children = filho.total;
  }

  // ------------------------------------------------------------ contexto
  const contextos = (
    await db.execute<{
      run_id: string;
      estimated_tokens: number | null;
      item_count: number | null;
      sections: number | null;
      truncations: number | null;
    }>(
      sql`select c.run_id,
                 (c.usage ->> 'estimatedTokens')::int as estimated_tokens,
                 (c.usage ->> 'itemCount')::int as item_count,
                 jsonb_array_length(c.sections) as sections,
                 (select count(*)::int from jsonb_array_elements(c.sections) s
                   where (s ->> 'truncated')::boolean) as truncations
          from run_context c
          where c.user_id = ${input.userId}::uuid
            and c.run_id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`,
    )
  ).rows;

  for (const contexto of contextos) {
    const alvo = parcial.get(contexto.run_id);
    if (alvo === undefined) continue;
    alvo.context = {
      tokens: contexto.estimated_tokens,
      items: contexto.item_count,
      sections: contexto.sections,
      truncations: contexto.truncations,
    };
  }

  for (const [runId, dados] of parcial) {
    detalhes.set(runId, {
      tokens: foldUsageEvents(dados.usage),
      toolCallsByServer: dados.tools,
      toolCalls: dados.toolCalls,
      stepsByType: dados.steps,
      gatesGrantedUser: dados.gatesUser,
      gatesGrantedPolicy: dados.gatesPolicy,
      childrenDelegated: dados.children,
      context: dados.context,
    });
  }

  return detalhes;
}

// --------------------------------------------------------------------------
// Drain
// --------------------------------------------------------------------------

type TerminalRunRow = {
  readonly id: string;
  readonly position_at: string;
  readonly finished_at: Date;
  readonly created_at: Date;
  readonly started_at: Date | null;
  readonly task_id: string;
  readonly project_id: string | null;
  readonly task_kind: TaskKind;
  readonly status: RunStatus;
  readonly harness_key: HarnessKey;
  readonly model_key: string | null;
  readonly provider_id: string | null;
  readonly loadout_id: string;
  readonly loadout_version: number;
  readonly execution_mode: ExecutionMode;
  readonly created_by: RunCreatedBy;
  readonly parent_run_id: string | null;
};

async function drainTerminalRuns(
  db: DatabaseExecutor,
  ctx: { userId: string; cutoff: Date; batchSize: number },
): Promise<TerminalRunRow[]> {
  const cursor = await readCursor(db, ctx.userId);
  const depois =
    cursor === null
      ? sql``
      : sql`and (r.finished_at, r.id) > (${cursor.positionAt}::timestamptz, ${cursor.positionId}::uuid)`;

  // O Provider vem por junção com o Model do **cadastro atual**, casando pela
  // chave que o Run guardou dentro do Harness dele. É o melhor vínculo possível:
  // o Run copia `model_key` justamente para sobreviver a uma troca no Loadout, e
  // um Model apagado deixa `provider_id` nulo em vez de derrubar a projeção.
  return (
    await db.execute<TerminalRunRow>(
      sql`select r.id, r.finished_at::text as position_at, r.finished_at, r.created_at,
                 r.started_at, r.task_id, t.project_id, t.kind as task_kind, r.status,
                 r.harness_key, r.model_key, m.provider_id, r.loadout_id, r.loadout_version,
                 r.execution_mode, r.created_by, r.parent_run_id
          from run r
          join task t on t.id = r.task_id
          left join harness h on h.user_id = r.user_id and h.key = r.harness_key
          left join model m on m.harness_id = h.id and m.key = r.model_key
          where r.user_id = ${ctx.userId}::uuid
            and r.finished_at is not null
            and r.finished_at <= ${ctx.cutoff}::timestamptz
            ${depois}
          order by r.finished_at, r.id
          limit ${ctx.batchSize}`,
    )
  ).rows;
}

// --------------------------------------------------------------------------
// Escrita
// --------------------------------------------------------------------------

function diferenca(fim: Date, inicio: Date | null): number | null {
  if (inicio === null) return null;
  const ms = fim.getTime() - inicio.getTime();
  return ms >= 0 ? ms : null;
}

async function upsertRunMetrics(
  tx: DatabaseExecutor,
  input: {
    userId: string;
    rows: readonly TerminalRunRow[];
    details: ReadonlyMap<string, RunDetails>;
  },
): Promise<Set<string>> {
  const dias = new Set<string>();

  for (const row of input.rows) {
    const detalhe = input.details.get(row.id) ?? EMPTY_DETAILS;
    const finishedAt = new Date(row.finished_at);
    const startedAt = row.started_at === null ? null : new Date(row.started_at);
    const day = utcDay(finishedAt);
    dias.add(day);

    const tokensConhecidos =
      detalhe.tokens.input !== null ||
      detalhe.tokens.output !== null ||
      detalhe.tokens.cacheRead !== null ||
      detalhe.tokens.cacheWrite !== null;

    const values = {
      runId: row.id,
      userId: input.userId,
      projectId: row.project_id,
      taskId: row.task_id,
      taskKind: row.task_kind,
      harnessKey: row.harness_key,
      modelKey: row.model_key,
      providerId: row.provider_id,
      loadoutId: row.loadout_id,
      loadoutVersion: row.loadout_version,
      executionMode: row.execution_mode,
      createdBy: row.created_by,
      parentRunId: row.parent_run_id,
      status: row.status,
      startedAt,
      finishedAt,
      durationMs: diferenca(finishedAt, startedAt),
      queueMs: startedAt === null ? null : diferenca(startedAt, new Date(row.created_at)),
      inputTokens: detalhe.tokens.input,
      outputTokens: detalhe.tokens.output,
      cacheReadTokens: detalhe.tokens.cacheRead,
      cacheWriteTokens: detalhe.tokens.cacheWrite,
      tokensKnown: tokensConhecidos,
      contextTokens: detalhe.context.tokens,
      contextItems: detalhe.context.items,
      contextSections: detalhe.context.sections,
      contextTruncations: detalhe.context.truncations,
      toolCallsByServer: detalhe.toolCallsByServer,
      toolCalls: detalhe.toolCalls,
      stepsByType: detalhe.stepsByType,
      gatesGrantedUser: detalhe.gatesGrantedUser,
      gatesGrantedPolicy: detalhe.gatesGrantedPolicy,
      childrenDelegated: detalhe.childrenDelegated,
      day,
      projectedAt: new Date(),
    };

    const { runId: _runId, ...atualizacao } = values;

    // A chave primária **é** a idempotência: reprocessar o mesmo Run reescreve
    // a linha com os mesmos valores em vez de duplicá-la.
    await tx.insert(runMetrics).values(values).onConflictDoUpdate({
      target: runMetrics.runId,
      set: atualizacao,
    });
  }

  return dias;
}

/**
 * Refaz `metric_daily` dos dias pedidos, a partir de `run_metric`.
 *
 * Apaga e reinsere, em vez de somar por cima: é a única forma de o rollup
 * acompanhar um preço cadastrado depois, e é o que faz `rebuild` reproduzir
 * linha por linha a projeção ao vivo. Um dia tem dezenas a centenas de Runs.
 */
export async function recomputeMetricDaily(
  tx: DatabaseExecutor,
  input: { userId: string; days: readonly string[]; prices?: Map<string, PriceWindow[]> },
): Promise<number> {
  if (input.days.length === 0) return 0;

  const precos = input.prices ?? (await loadPriceIndex(tx, { userId: input.userId }));
  const dias = [...input.days];

  const rows = await tx
    .select()
    .from(runMetrics)
    .where(and(eq(runMetrics.userId, input.userId), inArray(runMetrics.day, dias)));

  const priced: PricedRun[] = rows.map((row) => {
    const tokens: TokenCounts = {
      input: row.inputTokens,
      output: row.outputTokens,
      cacheRead: row.cacheReadTokens,
      cacheWrite: row.cacheWriteTokens,
    };
    const facts: RunMetricFacts = {
      runId: row.runId,
      projectId: row.projectId,
      taskKind: row.taskKind,
      harnessKey: row.harnessKey,
      modelKey: row.modelKey,
      providerId: row.providerId,
      loadoutId: row.loadoutId,
      executionMode: row.executionMode,
      createdBy: row.createdBy,
      status: row.status,
      day: row.day,
      durationMs: row.durationMs,
      tokens,
      toolCalls: row.toolCalls,
    };
    const vigencias = precos.get(modelPriceKey(row.harnessKey, row.modelKey)) ?? [];
    const price = priceAt(vigencias, row.finishedAt.getTime());
    return { facts, cost: costOfRun({ tokens, price }) };
  });

  await tx
    .delete(metricDaily)
    .where(and(eq(metricDaily.userId, input.userId), inArray(metricDaily.day, dias)));

  const baldes = rollupDaily(priced);

  for (const balde of baldes) {
    await tx.insert(metricDaily).values({
      userId: input.userId,
      day: balde.day,
      dimension: balde.dimension,
      dimensionKey: balde.dimensionKey,
      runsTotal: balde.measures.runsTotal,
      runsSucceeded: balde.measures.runsSucceeded,
      runsFailed: balde.measures.runsFailed,
      runsTimedOut: balde.measures.runsTimedOut,
      runsCancelled: balde.measures.runsCancelled,
      inputTokens: balde.measures.inputTokens,
      outputTokens: balde.measures.outputTokens,
      cacheReadTokens: balde.measures.cacheReadTokens,
      cacheWriteTokens: balde.measures.cacheWriteTokens,
      tokensKnownRuns: balde.measures.tokensKnownRuns,
      durationMsTotal: balde.measures.durationMsTotal,
      durationMsMax: balde.measures.durationMsMax,
      durationRuns: balde.measures.durationRuns,
      toolCalls: balde.measures.toolCalls,
      costByCurrency: balde.measures.costByCurrency as Record<string, number>,
      pricedRuns: balde.measures.pricedRuns,
      unpricedRuns: balde.measures.unpricedRuns,
      updatedAt: new Date(),
    });
  }

  return baldes.length;
}

/**
 * Refaz o rollup dos dias em que um Model apareceu.
 *
 * É o que um preço novo dispara: sem isto, `metric_daily` continuaria mostrando
 * `NOT_MEASURED` para Runs que acabaram de ganhar preço, e só uma reconstrução
 * completa corrigiria.
 */
export async function recomputeMetricDailyForModel(
  db: Database,
  input: { userId: string; harnessKey: string; modelKey: string },
): Promise<number> {
  const { rows } = await db.execute<{ day: string }>(
    sql`select distinct m.day::text as day
        from run_metric m
        where m.user_id = ${input.userId}::uuid
          and m.harness_key = ${input.harnessKey}::harness_key
          and m.model_key = ${input.modelKey}`,
  );

  const dias = rows.map((row) => row.day);
  if (dias.length === 0) return 0;

  return await db.transaction(
    async (tx) => await recomputeMetricDaily(tx, { userId: input.userId, days: dias }),
  );
}

// --------------------------------------------------------------------------
// Passe completo
// --------------------------------------------------------------------------

export interface ProjectMetricsOptions {
  userId: string;
  /** Atraso de segurança sobre `finished_at`. Zero só em teste e no `rebuild`. */
  lagMs?: number;
  batchSize?: number;
  logger?: EventsLogger;
  now?: () => Date;
}

export interface MetricProjectionReport {
  readonly ok: boolean;
  /** Runs terminais projetados neste passe. */
  readonly runs: number;
  /** Linhas de `metric_daily` reescritas. */
  readonly buckets: number;
  readonly error: string | null;
}

/**
 * Um passe do projetor. **Nunca lança.**
 *
 * Drena os Runs terminais até esvaziar. Cada lote é uma transação:
 * `run_metric`, o rollup dos dias tocados e o avanço do cursor saem juntos ou
 * não saem.
 */
export async function projectMetrics(
  db: Database,
  options: ProjectMetricsOptions,
): Promise<MetricProjectionReport> {
  const lagMs = options.lagMs ?? METRIC_PROJECTOR_LAG_MS;
  const batchSize = options.batchSize ?? METRIC_PROJECTOR_BATCH_SIZE;
  const now = options.now ?? (() => new Date());

  let runs = 0;
  let buckets = 0;

  try {
    const cutoff = new Date(now().getTime() - lagMs);

    for (;;) {
      const resultado = await db.transaction(async (tx) => {
        const rows = await drainTerminalRuns(tx, { userId: options.userId, cutoff, batchSize });
        if (rows.length === 0) return { runs: 0, buckets: 0 };

        const details = await loadRunDetails(tx, {
          userId: options.userId,
          runIds: rows.map((row) => row.id),
        });

        const dias = await upsertRunMetrics(tx, { userId: options.userId, rows, details });
        const escritos = await recomputeMetricDaily(tx, {
          userId: options.userId,
          days: [...dias],
        });

        const ultima = rows[rows.length - 1];
        if (ultima !== undefined) {
          await writeCursor(tx, {
            userId: options.userId,
            positionAt: ultima.position_at,
            positionId: ultima.id,
          });
        }

        return { runs: rows.length, buckets: escritos };
      });

      runs += resultado.runs;
      buckets += resultado.buckets;

      if (resultado.runs < batchSize) break;
    }

    if (runs > 0) {
      options.logger?.info?.({ runs, buckets }, "metric_projector_projected");
    }

    return { ok: true, runs, buckets, error: null };
  } catch (error) {
    // O contrato é não lançar: métrica é leitura, e não pode alcançar a fila.
    // O cursor não avançou, então nada foi perdido.
    const message = error instanceof Error ? error.message : String(error);
    options.logger?.error?.({ err: error, runs, buckets }, "metric_projector_failed");
    return { ok: false, runs, buckets, error: message };
  }
}

/**
 * Anuncia que as métricas mudaram.
 *
 * Um evento por **lote**, e não por Run: a tela de métricas é um agregado, e
 * dez Expedições terminando juntas mudam os mesmos tiles uma vez só. O
 * intervalo mínimo entre dois anúncios (`METRICS_UPDATED_THROTTLE_MS`) é
 * decidido por quem chama — o laço do Worker —, porque é ele que sabe quanto
 * tempo passou desde o anterior; repetir essa contagem aqui obrigaria o pacote
 * de banco a guardar estado de processo.
 */
export async function emitMetricsUpdated(
  db: DatabaseExecutor,
  input: { userId: string; runs: number; buckets: number },
): Promise<void> {
  await appendDashboardEvent(db, {
    userId: input.userId,
    type: "metrics.updated",
    payload: { runs: input.runs, buckets: input.buckets },
  });
}

/**
 * Zera `run_metric`, `metric_daily` e o cursor, e reprojeta do início.
 *
 * `model_price` **não** é apagado: é cadastro digitado pelo usuário, e não
 * projeção. Apagá-lo aqui transformaria uma reconstrução de leitura numa perda
 * de dado que ninguém tem como recuperar.
 *
 * Roda sem atraso de segurança por padrão: quem reconstrói é um operador, e o
 * que ele quer é o estado completo do que já está commitado.
 */
export async function rebuildMetrics(
  db: Database,
  options: ProjectMetricsOptions,
): Promise<MetricProjectionReport> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(metricDaily).where(eq(metricDaily.userId, options.userId));
      await tx.delete(runMetrics).where(eq(runMetrics.userId, options.userId));
      await tx.delete(metricCursors).where(eq(metricCursors.userId, options.userId));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.logger?.error?.({ err: error }, "metric_rebuild_truncate_failed");
    return { ok: false, runs: 0, buckets: 0, error: message };
  }

  return await projectMetrics(db, { ...options, lagMs: options.lagMs ?? 0 });
}
