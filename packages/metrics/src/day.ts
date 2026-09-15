/**
 * O dia civil das métricas é sempre **UTC**.
 *
 * O fuso do processo não entra aqui de propósito. A projeção roda no Worker e a
 * leitura na API — dois processos que podem estar em fusos diferentes, e que
 * num futuro remoto podem nem estar na mesma máquina. Se o `day` de uma linha
 * dependesse do relógio local de quem projetou, uma reconstrução feita noutro
 * fuso moveria Runs de dia e as séries mudariam sozinhas.
 *
 * É diferente do `hourLocal` das Conquistas, que é deliberadamente local: lá a
 * pergunta é "o usuário estava acordado?", e aqui é "quanto foi gasto no dia 3".
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` do instante, em UTC. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** O dia como `Date` à meia-noite UTC. */
export function dayToDate(day: string): Date {
  assertDay(day);
  return new Date(`${day}T00:00:00.000Z`);
}

/** O instante exclusivo em que o dia acaba: meia-noite UTC do dia seguinte. */
export function dayEnd(day: string): Date {
  return new Date(dayToDate(day).getTime() + MS_PER_DAY);
}

/** O dia deslocado por `delta` dias. Negativo anda para trás. */
export function addDays(day: string, delta: number): string {
  return utcDay(new Date(dayToDate(day).getTime() + delta * MS_PER_DAY));
}

/** O mês civil UTC do dia, `YYYY-MM`. */
export function monthOf(day: string): string {
  assertDay(day);
  return day.slice(0, 7);
}

/** O primeiro e o último dia do mês civil de `day`. */
export function monthBounds(day: string): { readonly first: string; readonly last: string } {
  const date = dayToDate(day);
  const first = `${monthOf(day)}-01`;
  const proximo = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { first, last: utcDay(new Date(proximo.getTime() - MS_PER_DAY)) };
}

/**
 * Os dias da janela, do mais antigo ao mais recente, **inclusive nos dois
 * extremos**.
 *
 * `7d` são sete dias contando hoje, e não sete dias antes de hoje: é o que o
 * usuário lê num rótulo "últimos 7 dias", e a diferença de um dia numa série
 * curta é visível.
 */
export function daysEndingAt(endDay: string, days: number): string[] {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`A janela precisa de um número inteiro positivo de dias; recebi ${days}.`);
  }
  const resultado: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) resultado.push(addDays(endDay, -i));
  return resultado;
}

function assertDay(day: string): void {
  if (!DAY_PATTERN.test(day)) {
    throw new Error(`Dia inválido: ${JSON.stringify(day)}. O formato é YYYY-MM-DD.`);
  }
}
