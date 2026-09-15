import type {
  ExecutionMode,
  HarnessKey,
  RunCreatedBy,
  RunStatus,
  TaskKind,
} from "@dungeon-master/contracts";

/**
 * Os tokens de uma Expedição, **como o harness os reportou**.
 *
 * Cada campo é `number | null`, e `null` quer dizer "não reportado". Nunca
 * zero: um Run do Claude Code sem `Usage` e um Run que de fato consumiu zero
 * tokens de cache são fatos diferentes, e achatar os dois em `0` faz a média de
 * tokens por Run mentir para baixo para sempre — sem nenhum aviso na tela.
 *
 * É a mesma disciplina do custo: {@link TokenCounts} desconhecido produz
 * `NOT_MEASURED`, e não `R$ 0,00`.
 */
export interface TokenCounts {
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
}

export const UNKNOWN_TOKENS: TokenCounts = {
  input: null,
  output: null,
  cacheRead: null,
  cacheWrite: null,
};

/** A soma dos quatro campos. `null` quando nenhum deles foi reportado. */
export function totalTokens(tokens: TokenCounts): number | null {
  const campos = [tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite];
  if (campos.every((valor) => valor === null)) return null;
  return campos.reduce<number>((soma, valor) => soma + (valor ?? 0), 0);
}

/** Um campo ausente vale zero **na soma**, mas não torna o conjunto conhecido. */
export function knownTokens(tokens: TokenCounts): boolean {
  return totalTokens(tokens) !== null;
}

/**
 * Uma Expedição terminal reduzida ao que as métricas somam.
 *
 * Só campos escalares: nada aqui referencia linha de banco, e é isso que deixa
 * o rollup e o custo serem testados sem PostgreSQL. Quem preenche é o projetor
 * em `@dungeon-master/database`.
 */
export interface RunMetricFacts {
  readonly runId: string;
  readonly projectId: string | null;
  readonly taskKind: TaskKind;
  readonly harnessKey: HarnessKey;
  /** A chave copiada no Run: sobrevive ao Model apagado ou trocado no Loadout. */
  readonly modelKey: string | null;
  readonly providerId: string | null;
  readonly loadoutId: string;
  readonly executionMode: ExecutionMode;
  readonly createdBy: RunCreatedBy;
  readonly status: RunStatus;
  /** Data UTC do desfecho, `YYYY-MM-DD`. */
  readonly day: string;
  readonly durationMs: number | null;
  readonly tokens: TokenCounts;
  readonly toolCalls: number;
}
