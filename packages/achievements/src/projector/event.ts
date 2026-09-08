import {
  type Condition,
  type ConditionDimension,
  type ConditionFilter,
  type ConditionSource,
  type ExecutionMode,
  type Presence,
  type TaskKind,
} from "../condition.js";

/**
 * O fato normalizado que o projetor avalia (planejamento v0.4, Fase 2.5B).
 *
 * O projetor é puro: ele não sabe o que é `run_event`, `activity` ou
 * `dashboard_event`. Quem lê o banco traduz cada linha para um
 * {@link ProjectionEvent} e entrega aqui; o que este módulo conhece é o
 * vocabulário fechado de condições e mais nada.
 */

/**
 * Os campos que um filtro conhece, já extraídos do fato.
 *
 * As chaves são exatamente as de {@link ConditionFilter}: um campo que o filtro
 * declara e que o fato não traz nunca casa, o que é o comportamento
 * fail-closed que a Fase 2.5A pede.
 */
export interface EventFields {
  readonly "task.kind"?: TaskKind | undefined;
  readonly "task.id"?: string | undefined;
  readonly "run.executionMode"?: ExecutionMode | undefined;
  readonly "run.harness"?: string | undefined;
  readonly "run.resumedFrom"?: Presence | undefined;
  readonly "run.workflowVersionId"?: Presence | undefined;
  readonly "project.id"?: string | undefined;
  readonly "agent.id"?: string | undefined;
  /**
   * Hora do fato, de 0 a 23, **no fuso do processo que projeta**.
   *
   * O nome do campo já diz "local", e é local mesmo: quem calcula é o adaptador
   * de banco, com `Date#getHours()`, no fuso em que o Worker está rodando. Um
   * `hourLocal` em UTC premiaria a vigília noturna de outra pessoa; um
   * `hourLocal` no fuso do usuário exigiria guardar o fuso do usuário, que a
   * Fase 2.5 não tem. Trocar o fuso do processo muda quem desbloqueia
   * "Vigília Noturna", e uma reconstrução depois da troca usa o fuso novo.
   */
  readonly hourLocal?: number | undefined;
}

/** As métricas numéricas que o predicado `record` sabe comparar. */
export interface EventMetrics {
  readonly "run.durationMs"?: number | undefined;
}

/** Um fato já normalizado, pronto para ser avaliado contra as condições. */
export interface ProjectionEvent {
  /** Em qual das fontes conhecidas o fato se encaixa. */
  readonly source: ConditionSource;
  /**
   * Instante do fato, em UTC (ISO 8601).
   *
   * Vira o `unlocked_at` do desbloqueio. Usar o instante do fato, e não o
   * relógio de quem projeta, é o que faz `rebuild` reproduzir os **mesmos**
   * desbloqueios, com as mesmas datas.
   */
  readonly at: string;
  /** Run de origem, quando o fato veio de um. Vai para o desbloqueio. */
  readonly runId: string | null;
  /** Task de origem, quando o fato veio de uma. Vai para o desbloqueio. */
  readonly taskId: string | null;
  readonly fields: EventFields;
  readonly metrics?: EventMetrics | undefined;
}

/**
 * Os três desfechos de um Run, que são contrários entre si.
 *
 * Uma sequência de vitórias é interrompida por uma derrota ou por uma
 * desistência; ela não é interrompida por uma Task concluída. Sem esta noção de
 * família, `streak` precisaria de uma lista de "eventos que zeram" por
 * condição, que é linguagem de expressão pela porta dos fundos.
 */
export const RUN_OUTCOME_SOURCES = [
  "run.succeeded",
  "run.failed",
  "run.cancelled",
] as const satisfies readonly ConditionSource[];

/** Os dois desfechos de uma aprovação, contrários entre si. */
export const APPROVAL_SOURCES = [
  "approval.granted",
  "approval.rejected",
] as const satisfies readonly ConditionSource[];

const FAMILIES: readonly (readonly ConditionSource[])[] = [RUN_OUTCOME_SOURCES, APPROVAL_SOURCES];

/**
 * O fato é o contrário do que a sequência conta?
 *
 * Contrário é "da mesma família, mas não é ele": `run.failed` e `run.cancelled`
 * zeram uma sequência de `run.succeeded`. Uma fonte sem família — `task.completed`,
 * `project.created` — não tem contrário, e uma sequência sobre ela nunca zera.
 */
export function isContrarySource(counted: ConditionSource, observed: ConditionSource): boolean {
  if (counted === observed) return false;
  return FAMILIES.some((family) => family.includes(counted) && family.includes(observed));
}

/** A hora está dentro da faixa fechada? */
function hourMatches(range: { from: number; to: number }, hour: number | undefined): boolean {
  if (hour === undefined) return false;
  return hour >= range.from && hour <= range.to;
}

/**
 * O fato casa com o filtro da condição?
 *
 * Todo campo declarado precisa bater. Filtro ausente casa com tudo; campo
 * declarado que o fato não traz **não** casa — é o mesmo fail-closed do
 * carregador do catálogo, e é o que impede uma condição escopada a um Project
 * de contar um fato que não tem Project nenhum.
 */
export function matchesFilter(filter: ConditionFilter | undefined, fields: EventFields): boolean {
  if (filter === undefined) return true;

  for (const [key, expected] of Object.entries(filter)) {
    if (expected === undefined) continue;

    if (key === "hourLocal") {
      if (!hourMatches(expected as { from: number; to: number }, fields.hourLocal)) return false;
      continue;
    }

    const actual = fields[key as Exclude<keyof EventFields, "hourLocal">];
    if (actual !== expected) return false;
  }

  return true;
}

/** O valor da dimensão que o predicado `set` percorre, quando o fato o traz. */
export function dimensionValue(
  dimension: ConditionDimension,
  fields: EventFields,
): string | undefined {
  return fields[dimension];
}

/** A métrica que o predicado `record` compara, quando o fato a traz. */
export function metricValue(
  metric: "run.durationMs",
  metrics: EventMetrics | undefined,
): number | undefined {
  return metrics?.[metric];
}

/** A fonte que a condição observa. Existe para não repetir o `switch` por predicado. */
export function conditionSource(condition: Condition): ConditionSource {
  return condition.source;
}
