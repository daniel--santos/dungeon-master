import { z } from "zod";

/**
 * Paginação por página, igual em toda listagem da API.
 *
 * `page` e `pageSize` são declarados como texto, e não como número coagido,
 * pelo mesmo motivo do cursor do stream: na URL eles **são** texto, e
 * `z.coerce.number()` faria a spec anunciar um tipo que a query string não tem.
 * A conversão acontece no handler, que também aplica o teto de `pageSize`.
 */

/** Quantos itens uma página traz quando o cliente não pede nada. */
export const DEFAULT_PAGE_SIZE = 25;

/** Teto de itens por página. Um `pageSize` acima disso é reduzido, não recusado. */
export const MAX_PAGE_SIZE = 100;

/** Parâmetros de busca comuns a toda listagem paginada. */
export const PageQuerySchema = z.object({
  page: z
    .string()
    .regex(/^[1-9]\d{0,5}$/, "A página é um inteiro positivo em base decimal.")
    .optional()
    .describe("Página desejada, começando em 1. Padrão: 1."),
  pageSize: z
    .string()
    .regex(/^[1-9]\d{0,3}$/, "O tamanho de página é um inteiro positivo em base decimal.")
    .optional()
    .describe(
      `Itens por página. Padrão: ${String(DEFAULT_PAGE_SIZE)}. ` +
        `Valores acima de ${String(MAX_PAGE_SIZE)} são reduzidos ao teto.`,
    ),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

/**
 * Envelope de uma página de resultados.
 *
 * `total` é a contagem sem paginação, para a tela conseguir desenhar o
 * paginador sem uma segunda requisição. Cada listagem chama esta fábrica com um
 * `id` próprio, porque o gerador de OpenAPI nomeia os schemas por esse `id`.
 */
export function paginatedSchema<Item extends z.ZodType>(
  item: Item,
  id: string,
  description: string,
) {
  return z
    .object({
      items: z.array(item).describe("Os itens desta página, na ordem da listagem."),
      page: z.number().int().positive().describe("Página devolvida."),
      pageSize: z.number().int().positive().describe("Itens por página efetivamente usados."),
      total: z.number().int().nonnegative().describe("Total de itens que casam com o filtro."),
    })
    .meta({ id, description });
}
