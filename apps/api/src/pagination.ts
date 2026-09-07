import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PageQuery } from "@dungeon-master/contracts";

/**
 * Converte os parâmetros de busca, que são texto, nos números da consulta.
 *
 * A conversão mora aqui e não no schema porque na URL `page` e `pageSize`
 * **são** texto: um `z.coerce.number()` faria a spec anunciar um tipo que a
 * query string não tem. O schema já garantiu que são dígitos e que são
 * positivos, então não há erro possível a tratar neste ponto.
 *
 * Um `pageSize` acima do teto é reduzido em vez de recusado: a intenção de
 * "traga bastante" é clara, e um 400 aqui só faria a tela adivinhar o limite.
 */
export interface ResolvedPage {
  readonly page: number;
  readonly pageSize: number;
}

export function resolvePage(query: PageQuery): ResolvedPage {
  const page = query.page === undefined ? 1 : Number.parseInt(query.page, 10);
  const requested =
    query.pageSize === undefined ? DEFAULT_PAGE_SIZE : Number.parseInt(query.pageSize, 10);

  return { page, pageSize: Math.min(requested, MAX_PAGE_SIZE) };
}
