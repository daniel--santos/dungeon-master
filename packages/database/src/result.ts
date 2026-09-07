/**
 * Resultado de uma escrita que pode ser recusada por regra de domínio.
 *
 * Regra de negócio quebrada não é exceção: é uma resposta prevista, e a API
 * precisa dela para escolher o status HTTP e escrever o `detail` do problem
 * details. Um `throw` atravessando a transação obrigaria a API a decidir o que
 * fazer olhando o texto da mensagem.
 *
 * "Não existe" continua sendo `null` no retorno, e não uma falha: é o 404, que
 * não depende de regra nenhuma.
 */
export type Result<Value, Failure> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly failure: Failure };

export function ok<Value>(value: Value): { ok: true; value: Value } {
  return { ok: true, value };
}

export function failed<Failure>(failure: Failure): { ok: false; failure: Failure } {
  return { ok: false, failure };
}

/** Uma página de resultados, sem os parâmetros que a pediram. */
export interface PageResult<Item> {
  readonly items: Item[];
  /** Total de linhas que casam com o filtro, ignorando a paginação. */
  readonly total: number;
}

export interface PageInput {
  /** Começa em 1. */
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Escapa os curingas do `LIKE`.
 *
 * Sem isso um `%` digitado na busca casaria com qualquer coisa, e um `_` com
 * qualquer caractere — a busca por título devolveria resultados que ninguém
 * pediu.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
