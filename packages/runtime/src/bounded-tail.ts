// Adapted from Sandcastle — src/boundedTail.ts@e99f832
// Copyright (c) 2026 Matt Pocock. Licensed under the MIT License.
// Changes: comentários traduzidos para o português e ampliados com o motivo
// nosso (a cauda é o texto de onde o bloco `<result>` é extraído); nenhuma
// mudança de comportamento. O arquivo não tinha import de `effect` para
// remover. O teste que acompanha a origem veio junto, em `bounded-tail.test.ts`.

/**
 * Cauda rolante e limitada de saída em stream.
 *
 * Quando um adapter lê a saída linha a linha, ele só acumula o texto para duas
 * coisas: extrair o bloco `<result>` no fim e mostrar o rabo do `stderr` numa
 * falha. Guardar o stream inteiro é desnecessário e, passando do teto de
 * string do V8 (~512 MB), fatal: um `chunks.join()` ingênuo lança
 * `RangeError: Invalid string length` e derruba a orquestração inteira no meio
 * de um Run longo.
 */

/**
 * Teto padrão de caracteres retidos.
 *
 * 64 KiB fica bem acima de qualquer bloco de resultado estruturado e bem
 * abaixo do teto de string do V8.
 */
export const MAX_TAIL_CHARS = 64 * 1024;

/**
 * Cauda de tamanho fixo, limitada pelo total de caracteres.
 *
 * `push` acrescenta; quando o comprimento juntado passaria de `maxChars`, os
 * itens mais antigos saem pela frente. Um item sozinho maior que `maxChars` é
 * truncado à própria cauda, então um blob sem quebra de linha não estoura em um
 * push só. `toString` junta o que sobrou, e o resultado tem no máximo
 * `maxChars`.
 *
 * O contador de comprimento é privado para que quem chama não consiga
 * dessincronizá-lo.
 */
export class BoundedTail {
  private readonly items: string[] = [];
  private totalChars = 0;
  private readonly maxChars: number;
  private readonly separator: string;

  /**
   * @param maxChars Comprimento máximo da cauda juntada. Padrão: {@link MAX_TAIL_CHARS}.
   * @param separator Texto colocado entre itens por {@link toString}. Precisa
   *   casar com o modo como quem chama juntaria os pedaços (`"\n"` para stream
   *   de linhas, `""` para stream de blocos).
   */
  constructor(maxChars: number = MAX_TAIL_CHARS, separator = "") {
    this.maxChars = maxChars;
    this.separator = separator;
  }

  /** Acrescenta um item, descartando os mais antigos para caber no teto. */
  push(item: string): void {
    const bounded = item.length > this.maxChars ? item.slice(item.length - this.maxChars) : item;
    this.totalChars += bounded.length + (this.items.length > 0 ? this.separator.length : 0);
    this.items.push(bounded);
    while (this.totalChars > this.maxChars && this.items.length > 1) {
      const dropped = this.items.shift();
      /* c8 ignore next */
      if (dropped === undefined) break;
      this.totalChars -= dropped.length + this.separator.length;
    }
  }

  /** Junta a cauda retida numa string só (comprimento ≤ `maxChars`). */
  toString(): string {
    return this.items.join(this.separator);
  }
}
