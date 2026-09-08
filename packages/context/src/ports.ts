import type {
  ArtifactSource,
  KnowledgeItemSource,
  ProjectSummarySource,
  RankedKnowledgeItemSource,
  TaskLineageSource,
} from "./types.js";

/**
 * O contrato pelo qual a infraestrutura entra no montador.
 *
 * `@dungeon-master/context` decide **o que** entra no bloco, em que ordem e
 * dentro de qual orçamento; quem lê as tabelas é quem implementa esta porta
 * — o Worker, com os repositórios reais e o FTS do PostgreSQL, ou a memória
 * dos testes. É a mesma disciplina de `@dungeon-master/knowledge`
 * (planejamento v0.4, seção 5): o pacote não importa banco, e o ESLint
 * garante.
 *
 * A relevância é determinística e mora do lado de quem lê: a porta recebe a
 * consulta FTS já montada (`buildFtsQuery`) e devolve os itens com o
 * `ts_rank`, desempatados por data e id. Nenhuma porta chama modelo.
 *
 * Toda porta pode lançar. O montador captura e devolve um `RunContext`
 * `FAILED`: o Run segue sem contexto, nunca com contexto parcial silencioso.
 */
export interface ContextStore {
  /** O `SUMMARY` corrente e `ACTIVE` do Project, ou nulo. */
  loadProjectSummary(input: { readonly projectId: string }): Promise<ProjectSummarySource | null>;
  /** As `DECISION` `ACTIVE` mais recentes, da mais nova para a mais antiga. */
  listRecentDecisions(input: {
    readonly projectId: string;
    readonly limit: number;
  }): Promise<KnowledgeItemSource[]>;
  /**
   * As páginas `ACTIVE` (nem `SUMMARY` nem `DECISION`) que casam com a
   * consulta, por `ts_rank` decrescente, depois data e id decrescentes.
   */
  searchKnowledgeItems(input: {
    readonly projectId: string;
    readonly query: string;
    readonly limit: number;
  }): Promise<RankedKnowledgeItemSource[]>;
  /** A Task mãe e as dependências, com o último resultado de cada uma. */
  loadTaskLineage(input: { readonly taskId: string }): Promise<TaskLineageSource>;
  /**
   * Os artefatos dos Runs `SUCCEEDED` das Tasks dadas, do Run mais recente
   * para o mais antigo e na posição em que foram declarados, até o teto. O
   * Run corrente fica de fora.
   */
  listPriorArtifacts(input: {
    readonly taskIds: readonly string[];
    readonly excludeRunId: string;
    readonly limit: number;
  }): Promise<ArtifactSource[]>;
}
