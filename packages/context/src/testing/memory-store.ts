import type { ContextStore } from "../ports.js";
import type {
  ArtifactSource,
  KnowledgeItemSource,
  ProjectSummarySource,
  RankedKnowledgeItemSource,
  TaskContextSource,
  TaskLineageSource,
} from "../types.js";

/**
 * O store em memória: a semântica do banco sem o banco.
 *
 * O que ele reproduz é o que o montador depende: o resumo corrente por
 * Project, as decisões mais recentes, uma busca por palavras no lugar do FTS
 * (o score é a contagem de termos da consulta que a página contém, e o
 * desempate é o mesmo da consulta real: data e id decrescentes), a linhagem
 * e os artefatos de Runs anteriores. O `ts_rank` de verdade é assunto do
 * teste com PostgreSQL embutido em `@dungeon-master/database`.
 */

export interface MemoryKnowledgeItem extends KnowledgeItemSource {
  readonly projectId: string;
  readonly status: "ACTIVE" | "PENDING_REVIEW" | "REJECTED" | "ARCHIVED";
  readonly version?: number;
}

export interface MemoryTask extends TaskContextSource {
  readonly parentTaskId: string | null;
  readonly dependsOn: readonly string[];
}

export interface MemoryRun {
  readonly id: string;
  readonly taskId: string;
  readonly status: "SUCCEEDED" | "FAILED";
  /** ISO 8601; ordena os artefatos do mais recente para o mais antigo. */
  readonly finishedAt: string;
  readonly artifacts: ReadonlyArray<{
    readonly path: string;
    readonly kind?: string;
    readonly summary?: string;
  }>;
}

export interface MemoryContextStoreOptions {
  readonly items?: readonly MemoryKnowledgeItem[];
  readonly tasks?: readonly MemoryTask[];
  readonly runs?: readonly MemoryRun[];
  /** Faz a porta indicada lançar, para o caminho de falha. */
  readonly failOn?: {
    readonly loadProjectSummary?: Error;
    readonly listRecentDecisions?: Error;
    readonly searchKnowledgeItems?: Error;
    readonly loadTaskLineage?: Error;
    readonly listPriorArtifacts?: Error;
  };
}

export interface MemoryContextStore extends ContextStore {
  /** As chamadas recebidas, na ordem, para provar o que a política pediu. */
  readonly calls: string[];
}

export function createMemoryContextStore(
  options: MemoryContextStoreOptions = {},
): MemoryContextStore {
  const items = [...(options.items ?? [])];
  const tasks = new Map((options.tasks ?? []).map((task) => [task.id, task]));
  const runs = [...(options.runs ?? [])];
  const calls: string[] = [];

  const ativos = (projectId: string) =>
    items.filter((item) => item.projectId === projectId && item.status === "ACTIVE");

  const compareNewest = (a: KnowledgeItemSource, b: KnowledgeItemSource): number => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  };

  const latestSummary = (taskId: string): string | null => {
    const bemSucedidos = runs
      .filter((run) => run.taskId === taskId && run.status === "SUCCEEDED")
      .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0));
    const ultimo = bemSucedidos[0];
    return ultimo === undefined ? null : `Resultado do Run ${ultimo.id}`;
  };

  const toTaskSource = (task: MemoryTask): TaskContextSource => ({
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    kind: task.kind,
    latestResultSummary: task.latestResultSummary ?? latestSummary(task.id),
  });

  return {
    calls,

    async loadProjectSummary({ projectId }): Promise<ProjectSummarySource | null> {
      calls.push("loadProjectSummary");
      if (options.failOn?.loadProjectSummary) throw options.failOn.loadProjectSummary;
      const resumo = ativos(projectId)
        .filter((item) => item.type === "SUMMARY")
        .sort(compareNewest)[0];
      return resumo === undefined
        ? null
        : {
            id: resumo.id,
            title: resumo.title,
            content: resumo.content,
            version: resumo.version ?? 1,
          };
    },

    async listRecentDecisions({ projectId, limit }): Promise<KnowledgeItemSource[]> {
      calls.push("listRecentDecisions");
      if (options.failOn?.listRecentDecisions) throw options.failOn.listRecentDecisions;
      return ativos(projectId)
        .filter((item) => item.type === "DECISION")
        .sort(compareNewest)
        .slice(0, limit)
        .map(({ id, type, title, content, createdAt }) => ({
          id,
          type,
          title,
          content,
          createdAt,
        }));
    },

    async searchKnowledgeItems({ projectId, query, limit }): Promise<RankedKnowledgeItemSource[]> {
      calls.push("searchKnowledgeItems");
      if (options.failOn?.searchKnowledgeItems) throw options.failOn.searchKnowledgeItems;
      const termos = query.split(" | ").filter((termo) => termo.length > 0);
      const pontuados: RankedKnowledgeItemSource[] = [];
      for (const item of ativos(projectId)) {
        if (item.type === "SUMMARY" || item.type === "DECISION") continue;
        const texto = `${item.title} ${item.content}`.toLowerCase();
        const score = termos.filter((termo) => texto.includes(termo)).length;
        if (score === 0) continue;
        pontuados.push({
          id: item.id,
          type: item.type,
          title: item.title,
          content: item.content,
          createdAt: item.createdAt,
          score,
        });
      }
      return pontuados
        .sort((a, b) => (a.score !== b.score ? b.score - a.score : compareNewest(a, b)))
        .slice(0, limit);
    },

    async loadTaskLineage({ taskId }): Promise<TaskLineageSource> {
      calls.push("loadTaskLineage");
      if (options.failOn?.loadTaskLineage) throw options.failOn.loadTaskLineage;
      const task = tasks.get(taskId);
      if (task === undefined) return { parent: null, dependencies: [] };
      const parent = task.parentTaskId === null ? undefined : tasks.get(task.parentTaskId);
      const dependencies = task.dependsOn
        .map((id) => tasks.get(id))
        .filter((dependency): dependency is MemoryTask => dependency !== undefined)
        .map(toTaskSource);
      return { parent: parent === undefined ? null : toTaskSource(parent), dependencies };
    },

    async listPriorArtifacts({ taskIds, excludeRunId, limit }): Promise<ArtifactSource[]> {
      calls.push("listPriorArtifacts");
      if (options.failOn?.listPriorArtifacts) throw options.failOn.listPriorArtifacts;
      const alvo = new Set(taskIds);
      const encontrados: ArtifactSource[] = [];
      const ordenados = runs
        .filter(
          (run) => alvo.has(run.taskId) && run.status === "SUCCEEDED" && run.id !== excludeRunId,
        )
        .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0));
      for (const run of ordenados) {
        run.artifacts.forEach((artifact, position) => {
          encontrados.push({
            runId: run.id,
            taskId: run.taskId,
            position,
            path: artifact.path,
            kind: artifact.kind ?? null,
            summary: artifact.summary ?? null,
          });
        });
      }
      return encontrados.slice(0, limit);
    },
  };
}
