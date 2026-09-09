import type {
  KnowledgeItemStatus,
  KnowledgeItemType,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from "@dungeon-master/contracts";

import type {
  KnowledgeToolItem,
  KnowledgeToolStore,
  KnowledgeToolSummary,
  KnowledgeToolTask,
  KnowledgeToolTaskRef,
} from "./store.js";

/**
 * O store em memória: a mesma porta, sem banco.
 *
 * Existe para os testes de unidade das ferramentas e do servidor. A busca é
 * por palavras, sem FTS — o que se prova aqui é escopo, limite e formato; o
 * ranking do PostgreSQL é provado no teste de integração, com o banco de
 * verdade.
 */

export interface MemoryKnowledgeItem {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string;
  readonly type: KnowledgeItemType;
  readonly status: KnowledgeItemStatus;
  readonly title: string;
  readonly content: string;
  readonly version?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface MemoryTask {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly kind?: TaskKind;
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly parentTaskId?: string | null;
  /** Ids das Tasks das quais esta depende. */
  readonly dependsOn?: readonly string[];
}

export interface InMemoryKnowledgeToolStoreOptions {
  readonly userId: string;
  readonly projectId: string;
  readonly items?: readonly MemoryKnowledgeItem[];
  readonly tasks?: readonly MemoryTask[];
  /** `false` simula um Project apagado: `getSummary` devolve `null`. */
  readonly projectExists?: boolean;
}

const EPOCH = "2026-09-08T00:00:00.000Z";

function toItem(item: MemoryKnowledgeItem): KnowledgeToolItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    content: item.content,
    version: item.version ?? 1,
    createdAt: item.createdAt ?? EPOCH,
    updatedAt: item.updatedAt ?? item.createdAt ?? EPOCH,
  };
}

function toRef(task: MemoryTask): KnowledgeToolTaskRef {
  return { id: task.id, title: task.title, status: task.status ?? "READY" };
}

export function createInMemoryKnowledgeToolStore(
  options: InMemoryKnowledgeToolStoreOptions,
): KnowledgeToolStore {
  const { userId, projectId } = options;
  const items = options.items ?? [];
  const tasks = options.tasks ?? [];
  const exists = options.projectExists ?? true;

  const doProject = (item: MemoryKnowledgeItem): boolean =>
    item.userId === userId && item.projectId === projectId;
  const ativos = (): MemoryKnowledgeItem[] =>
    items.filter((item) => doProject(item) && item.status === "ACTIVE");
  const byCreation = (a: KnowledgeToolItem, b: KnowledgeToolItem): number =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

  return {
    async searchItems({ query, limit }) {
      const palavras = query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((palavra) => palavra.length > 0);
      const pontuados = ativos()
        .filter((item) => item.type !== "SUMMARY")
        .map((item) => {
          const texto = `${item.title} ${item.content}`.toLowerCase();
          const pontos = palavras.filter((palavra) => texto.includes(palavra)).length;
          return { item: toItem(item), pontos };
        })
        .filter((entrada) => entrada.pontos > 0)
        .sort((a, b) => b.pontos - a.pontos || byCreation(b.item, a.item));
      return pontuados.slice(0, limit).map((entrada) => entrada.item);
    },

    async getItem(knowledgeItemId) {
      // O resumo tem porta própria, como no store de banco.
      const item = ativos().find(
        (candidate) => candidate.id === knowledgeItemId && candidate.type !== "SUMMARY",
      );
      return item === undefined ? null : toItem(item);
    },

    async getSummary(): Promise<KnowledgeToolSummary | null> {
      if (!exists) return null;
      const resumo = ativos().find((item) => item.type === "SUMMARY");
      const paginas = ativos().filter((item) => item.type !== "SUMMARY");
      const marco = resumo === undefined ? null : toItem(resumo).updatedAt;
      const novas =
        marco === null
          ? paginas.length
          : paginas.filter((item) => toItem(item).createdAt > marco).length;
      return {
        item: resumo === undefined ? null : toItem(resumo),
        activeItemCount: paginas.length,
        promotedSinceSummary: novas,
      };
    },

    // As `limit` mais recentes, apresentadas da mais antiga para a mais
    // recente — a mesma conta do store de banco (post-mortem #20 lá). O dublê
    // ordenava ascendente antes do teto, então as duas implementações
    // concordavam no defeito e o teste de unidade não pegava nada.
    async listDecisions(limit) {
      if (limit <= 0) return [];
      return ativos()
        .filter((item) => item.type === "DECISION")
        .map(toItem)
        .sort((a, b) => byCreation(b, a))
        .slice(0, limit)
        .reverse();
    },

    async getTask(taskId): Promise<KnowledgeToolTask | null> {
      const task = tasks.find(
        (candidate) =>
          candidate.id === taskId &&
          candidate.userId === userId &&
          candidate.projectId === projectId,
      );
      if (task === undefined) return null;

      // A linhagem para na fronteira do Project, como o store de banco (veja o
      // post-mortem #19 em `packages/database/src/run-context.ts`): uma aresta
      // entre Campanhas gravada por uma versão anterior não traz o título de
      // uma Task de outra Campanha para dentro do `get_task_context`.
      const daCampanha = (t: MemoryTask): boolean =>
        t.userId === userId && t.projectId === projectId;
      const porId = new Map(tasks.filter(daCampanha).map((t) => [t.id, t]));
      const parent = task.parentTaskId == null ? undefined : porId.get(task.parentTaskId);
      const dependencies = (task.dependsOn ?? [])
        .map((id) => porId.get(id))
        .filter((t): t is MemoryTask => t !== undefined)
        .map(toRef);
      const dependents = tasks
        .filter((t) => daCampanha(t) && (t.dependsOn ?? []).includes(task.id))
        .map(toRef);

      return {
        id: task.id,
        title: task.title,
        description: task.description ?? null,
        kind: task.kind ?? "FEATURE",
        status: task.status ?? "READY",
        priority: task.priority ?? "MEDIUM",
        parent: parent === undefined ? null : toRef(parent),
        dependencies,
        dependents,
      };
    },
  };
}
