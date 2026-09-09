import type {
  ArtifactSource,
  ContextStore,
  KnowledgeItemSource,
  ProjectSummarySource,
  RankedKnowledgeItemSource,
  TaskContextSource,
  TaskLineageSource,
} from "@dungeon-master/context";
import {
  type RunContext,
  type RunResult,
  TaskExecutionArtifactSchema,
} from "@dungeon-master/contracts";
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";

import type { DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { KNOWLEDGE_FTS_CONFIG, knowledgeItems } from "./schema/knowledge-item.js";
import { runs } from "./schema/run.js";
import { type RunContextRow, runContexts } from "./schema/run-context.js";
import { taskDependencies, tasks, type TaskRow } from "./schema/task.js";

/**
 * O lado do banco do Context Engine (planejamento v0.4, Fase 7): o registro
 * do contexto de cada Run e a implementação da porta `ContextStore` de
 * `@dungeon-master/context`.
 *
 * O montador não conhece o banco; o que ele pede está em `ports.ts` e é aqui
 * que cada pedido vira uma consulta. A relevância é do PostgreSQL —
 * `ts_rank` sobre o `tsvector` gerado de título e conteúdo, dicionário
 * `simple` — e o desempate por data e id é o que torna a resposta
 * determinística para o mesmo Grimório.
 */

export function toRunContext(row: RunContextRow): RunContext {
  return {
    runId: row.runId,
    taskId: row.taskId,
    projectId: row.projectId,
    status: row.status,
    text: row.text,
    query: row.query,
    sections: row.sections,
    excluded: row.excluded,
    budget: row.budget,
    usage: row.usage,
    policy: row.policy,
    inheritedFromRunId: row.inheritedFromRunId,
    error: row.error,
    assembledAt: row.assembledAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getRunContext(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<RunContext | null> {
  const [row] = await db
    .select()
    .from(runContexts)
    .where(and(eq(runContexts.userId, input.userId), eq(runContexts.runId, input.runId)));

  return row === undefined ? null : toRunContext(row);
}

export interface SaveRunContextInput {
  userId: string;
  context: RunContext;
}

/**
 * Grava o contexto de um Run — uma vez.
 *
 * `ON CONFLICT (run_id) DO NOTHING`: se já existe uma linha para o Run, ela
 * vence e é devolvida com `created: false`. É a regra "estável ao longo do
 * Run" escrita onde ninguém a contorna — dois claims do mesmo Run (uma
 * reconciliação em corrida com o Worker antigo, por exemplo) terminam com um
 * texto só.
 */
export async function saveRunContext(
  db: DatabaseExecutor,
  input: SaveRunContextInput,
): Promise<{ context: RunContext; created: boolean }> {
  const { context } = input;
  const [row] = await db
    .insert(runContexts)
    .values({
      id: newId(),
      userId: input.userId,
      runId: context.runId,
      taskId: context.taskId,
      projectId: context.projectId,
      status: context.status,
      text: context.text,
      query: context.query,
      sections: context.sections,
      excluded: context.excluded,
      budget: context.budget,
      usage: context.usage,
      policy: context.policy,
      inheritedFromRunId: context.inheritedFromRunId,
      error: context.error,
      assembledAt: new Date(context.assembledAt),
    })
    .onConflictDoNothing({ target: runContexts.runId })
    .returning();

  if (row !== undefined) return { context: toRunContext(row), created: true };

  const existente = await getRunContext(db, { userId: input.userId, runId: context.runId });
  if (existente === null) {
    throw new Error(`O run_context do Run ${context.runId} não foi gravado nem encontrado.`);
  }
  return { context: existente, created: false };
}

// --------------------------------------------------------------------------
// A porta `ContextStore`
// --------------------------------------------------------------------------

/** Quantos Runs anteriores entram na busca por artefatos, antes do teto por artefato. */
const PRIOR_RUNS_LIMIT = 25;

export function createDatabaseContextStore(
  db: DatabaseExecutor,
  input: { userId: string },
): ContextStore {
  const { userId } = input;

  const toKnowledgeSource = (row: {
    id: string;
    type: KnowledgeItemSource["type"];
    title: string;
    content: string;
    createdAt: Date;
  }): KnowledgeItemSource => ({
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  });

  /** O `summary` do resultado do último Run `SUCCEEDED` da Task, ou nulo. */
  const latestResultSummary = async (taskId: string): Promise<string | null> => {
    const [row] = await db
      .select({ result: runs.result })
      .from(runs)
      .where(and(eq(runs.userId, userId), eq(runs.taskId, taskId), eq(runs.status, "SUCCEEDED")))
      .orderBy(sql`${runs.finishedAt} desc nulls last`, desc(runs.id))
      .limit(1);
    const summary = row?.result?.summary;
    return typeof summary === "string" && summary.trim().length > 0 ? summary : null;
  };

  const toTaskSource = async (row: TaskRow): Promise<TaskContextSource> => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    kind: row.kind,
    latestResultSummary: await latestResultSummary(row.id),
  });

  return {
    async loadProjectSummary({ projectId }): Promise<ProjectSummarySource | null> {
      const [row] = await db
        .select({
          id: knowledgeItems.id,
          title: knowledgeItems.title,
          content: knowledgeItems.content,
          version: knowledgeItems.version,
        })
        .from(knowledgeItems)
        .where(
          and(
            eq(knowledgeItems.userId, userId),
            eq(knowledgeItems.projectId, projectId),
            eq(knowledgeItems.type, "SUMMARY"),
            eq(knowledgeItems.status, "ACTIVE"),
          ),
        )
        .orderBy(desc(knowledgeItems.createdAt), desc(knowledgeItems.id))
        .limit(1);
      return row ?? null;
    },

    async listRecentDecisions({ projectId, limit }): Promise<KnowledgeItemSource[]> {
      if (limit <= 0) return [];
      const rows = await db
        .select()
        .from(knowledgeItems)
        .where(
          and(
            eq(knowledgeItems.userId, userId),
            eq(knowledgeItems.projectId, projectId),
            eq(knowledgeItems.type, "DECISION"),
            eq(knowledgeItems.status, "ACTIVE"),
          ),
        )
        .orderBy(desc(knowledgeItems.createdAt), desc(knowledgeItems.id))
        .limit(limit);
      return rows.map(toKnowledgeSource);
    },

    async searchKnowledgeItems({ projectId, query, limit }): Promise<RankedKnowledgeItemSource[]> {
      if (limit <= 0) return [];
      const consulta = sql`to_tsquery(${KNOWLEDGE_FTS_CONFIG}, ${query})`;
      const rank = sql<number>`ts_rank(${knowledgeItems.search}, ${consulta})`;
      const rows = await db
        .select({
          id: knowledgeItems.id,
          type: knowledgeItems.type,
          title: knowledgeItems.title,
          content: knowledgeItems.content,
          createdAt: knowledgeItems.createdAt,
          score: rank,
        })
        .from(knowledgeItems)
        .where(
          and(
            eq(knowledgeItems.userId, userId),
            eq(knowledgeItems.projectId, projectId),
            eq(knowledgeItems.status, "ACTIVE"),
            notInArray(knowledgeItems.type, ["SUMMARY", "DECISION"]),
            sql`${knowledgeItems.search} @@ ${consulta}`,
          ),
        )
        .orderBy(sql`${rank} desc`, desc(knowledgeItems.createdAt), desc(knowledgeItems.id))
        .limit(limit);
      return rows.map((row) => ({ ...toKnowledgeSource(row), score: Number(row.score) }));
    },

    /**
     * post-mortem #19 (2026-09-08): a mãe e as dependências eram resolvidas só
     * por `user_id`. Uma aresta entre Campanhas — que a rota
     * `PUT /tasks/{a}/dependencies/{b}` aceitava criar, e que continua no banco
     * de quem já a criou — trazia título, descrição e resumo do último Run de
     * uma Task de outro Project para dentro do bloco `<context>`. Não é
     * vazamento entre usuários (o sistema é single-user): é a promessa da
     * Fase 7, "só o contexto relevante da Campanha", furada por construção. O
     * `projectId` da própria Task é o escopo, e ele fecha os dois lados.
     */
    async loadTaskLineage({ taskId }): Promise<TaskLineageSource> {
      const [task] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
      if (task === undefined) return { parent: null, dependencies: [] };

      const mesmoProject =
        task.projectId === null ? isNull(tasks.projectId) : eq(tasks.projectId, task.projectId);

      let parent: TaskContextSource | null = null;
      if (task.parentTaskId !== null) {
        const [mae] = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, task.parentTaskId), eq(tasks.userId, userId), mesmoProject));
        if (mae !== undefined) parent = await toTaskSource(mae);
      }

      const linhas = await db
        .select({ task: tasks })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
        .where(
          and(
            eq(taskDependencies.userId, userId),
            eq(taskDependencies.taskId, task.id),
            mesmoProject,
          ),
        )
        .orderBy(asc(tasks.createdAt), asc(tasks.id));

      // Em série, e não em `Promise.all`: dentro de uma transação as consultas
      // partilham a conexão, e o `pg` não aceita duas ao mesmo tempo nela.
      const dependencies: TaskContextSource[] = [];
      for (const linha of linhas) dependencies.push(await toTaskSource(linha.task));

      return { parent, dependencies };
    },

    async listPriorArtifacts({ taskIds, excludeRunId, limit }): Promise<ArtifactSource[]> {
      if (limit <= 0 || taskIds.length === 0) return [];
      const rows = await db
        .select({ id: runs.id, taskId: runs.taskId, result: runs.result })
        .from(runs)
        .where(
          and(
            eq(runs.userId, userId),
            inArray(runs.taskId, [...taskIds]),
            eq(runs.status, "SUCCEEDED"),
            ne(runs.id, excludeRunId),
          ),
        )
        .orderBy(sql`${runs.finishedAt} desc nulls last`, desc(runs.id))
        .limit(PRIOR_RUNS_LIMIT);

      const artifacts: ArtifactSource[] = [];
      for (const row of rows) {
        for (const { position, artifact } of artifactsOf(row.result)) {
          if (artifacts.length >= limit) return artifacts;
          artifacts.push({
            runId: row.id,
            taskId: row.taskId,
            position,
            path: artifact.path,
            kind: artifact.kind ?? null,
            summary: artifact.summary ?? null,
          });
        }
      }
      return artifacts;
    },
  };
}

interface PositionedArtifact {
  /** A posição no `artifacts[]` do resultado, contando os itens pulados. */
  position: number;
  artifact: { path: string; kind?: string; summary?: string };
}

/**
 * Os artefatos de um resultado, validados um a um, cada um com a posição no
 * array original.
 *
 * `RunResult` é um objeto aberto: o que chega em `artifacts` foi validado pelo
 * runtime quando o Run terminou, mas um resultado agregado de Workflow ou um
 * escrito por versão anterior pode trazer um item torto. Ele é pulado, e a
 * posição dos demais continua sendo a do array — é ela que forma o id
 * `<runId>:<posição>` do item, e um id que mudasse conforme o vizinho torto
 * apontaria para artefatos diferentes em dois registros do mesmo Run.
 */
function artifactsOf(result: RunResult | null): PositionedArtifact[] {
  const bruto = result?.["artifacts"];
  if (!Array.isArray(bruto)) return [];
  const validos: PositionedArtifact[] = [];
  bruto.forEach((candidato, position) => {
    const parsed = TaskExecutionArtifactSchema.safeParse(candidato);
    if (parsed.success && parsed.data.path.trim().length > 0) {
      validos.push({ position, artifact: parsed.data });
    }
  });
  return validos;
}
