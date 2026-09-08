import { escapeXmlTags } from "@dungeon-master/context";

/**
 * A sanitização do que o Distiller persiste.
 *
 * `escapeXmlTags`, a função copiada do TencentDB Agent Memory, mora em
 * `@dungeon-master/context` (planejamento v0.4, seção 13.3): é lá que o texto
 * escrito por modelo volta a um prompt, e a lista de fronteiras que ela
 * escapa é a das seções do bloco de contexto. Este pacote a aplica na
 * entrada — todo item do Grimório já nasce escapado — e o montador a aplica
 * de novo na saída; uma fonte só, dois momentos.
 */

export interface SanitizeOptions {
  /** Teto de caracteres. O excedente é cortado, e o corte é marcado com `…`. */
  readonly maxLength?: number;
}

// Os caracteres de controle, menos `\t` (0x09), `\n` (0x0A) e `\r` (0x0D).
// eslint-disable-next-line no-control-regex -- os controles são o alvo.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * O que todo texto escrito por modelo passa antes de persistir.
 *
 * Três coisas, nesta ordem: caracteres de controle somem (menos quebra de
 * linha e tabulação, que são texto), as tags de fronteira são escapadas, e o
 * resultado é aparado e limitado ao teto. Nunca lança e nunca devolve `null`:
 * um texto que vira vazio é o chamador quem decide se vale uma linha.
 */
export function sanitizeLlmText(text: string, options: SanitizeOptions = {}): string {
  const escapado = escapeXmlTags(text.replace(CONTROL_CHARACTERS, ""))
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const max = options.maxLength;
  if (max === undefined || escapado.length <= max) return escapado;
  return `${escapado.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
