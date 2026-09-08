/**
 * A consulta de relevância: as palavras do texto, em OR, para o
 * `to_tsquery('simple', ...)` do PostgreSQL.
 *
 * `plainto_tsquery` faria AND, e uma Task de vinte palavras nunca casaria
 * com uma página de dez; a relevância quer "parecido", não "igual". O
 * `ts_rank` ordena pelo quanto cada página casa. As palavras são
 * normalizadas para minúsculas, deduplicadas, e ficam as doze mais longas —
 * a pergunta é sobre os termos raros, e os curtos são artigos e preposições.
 *
 * É a mesma consulta do recall de duplicatas do Distiller
 * (`packages/database/src/knowledge-distiller.ts`), que passou a importar
 * daqui: uma definição só de "o que é parecido com este texto".
 */
export const FTS_QUERY_MAX_TERMS = 12;
export const FTS_QUERY_MIN_TERM_LENGTH = 3;

export function buildFtsQuery(text: string): string | null {
  const palavras = [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((palavra) => palavra.length >= FTS_QUERY_MIN_TERM_LENGTH),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, FTS_QUERY_MAX_TERMS);

  return palavras.length === 0 ? null : palavras.join(" | ");
}
