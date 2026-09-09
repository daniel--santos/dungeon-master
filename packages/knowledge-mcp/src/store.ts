import type {
  KnowledgeItemType,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from "@dungeon-master/contracts";

/**
 * A porta de leitura das ferramentas do Grimório.
 *
 * As cinco ferramentas do servidor só leem, e leem por aqui. A implementação
 * de banco (`store-database.ts`) recebe `userId` e `projectId` na construção
 * e **não** aceita nenhum dos dois por chamada: um id de outro Project que
 * chegue como argumento de ferramenta encontra o escopo já fechado e recebe
 * "não encontrado", nunca o item. A implementação em memória serve aos testes
 * de unidade e faz a mesma promessa.
 *
 * A promessa vale também para o id que chega **de dentro**: mãe, dependência
 * e dependente de `getTask` são filtradas pelo mesmo `projectId`, porque uma
 * aresta entre Campanhas gravada antes da correção do post-mortem #19 traria
 * o título de uma Task de outro Project por um caminho que não passa por
 * argumento nenhum.
 */

/** Uma página do Grimório como as ferramentas a enxergam. Só o que o agente precisa. */
export interface KnowledgeToolItem {
  readonly id: string;
  readonly type: KnowledgeItemType;
  readonly title: string;
  readonly content: string;
  readonly version: number;
  /** Em UTC (ISO 8601). */
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeToolSummary {
  /** O `SUMMARY` corrente, ou nulo enquanto o Distiller não consolidou nada. */
  readonly item: KnowledgeToolItem | null;
  readonly activeItemCount: number;
  readonly promotedSinceSummary: number;
}

/** Uma Task ligada à consultada: mãe, dependência ou dependente. */
export interface KnowledgeToolTaskRef {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
}

export interface KnowledgeToolTask {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly kind: TaskKind;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly parent: KnowledgeToolTaskRef | null;
  /** As Tasks que precisam terminar antes desta. */
  readonly dependencies: readonly KnowledgeToolTaskRef[];
  /** As Tasks que esperam por esta. */
  readonly dependents: readonly KnowledgeToolTaskRef[];
}

export interface KnowledgeToolStore {
  /** Páginas `ACTIVE` do Project, sem o resumo, por relevância textual. */
  searchItems(input: {
    readonly query: string;
    readonly limit: number;
  }): Promise<readonly KnowledgeToolItem[]>;
  /** Uma página `ACTIVE` do Project. Outro Project ou outro estado é `null`. */
  getItem(knowledgeItemId: string): Promise<KnowledgeToolItem | null>;
  /** O resumo corrente do Project. `null` quando o Project não existe. */
  getSummary(): Promise<KnowledgeToolSummary | null>;
  /** As decisões `ACTIVE` do Project, da mais antiga para a mais nova. */
  listDecisions(limit: number): Promise<readonly KnowledgeToolItem[]>;
  /** Uma Task do Project, com mãe e dependências. Outro Project é `null`. */
  getTask(taskId: string): Promise<KnowledgeToolTask | null>;
}
