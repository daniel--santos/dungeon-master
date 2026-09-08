import { sanitizeForContext } from "../sanitize.js";

/** Teto do título no registro e no texto. Um título maior é uma frase. */
export const TITLE_MAX_LENGTH = 200;

/** O título, sanitizado, numa linha e com teto. */
export function cleanTitle(title: string): string {
  const limpo = sanitizeForContext(title).replace(/\s+/g, " ");
  return limpo.length <= TITLE_MAX_LENGTH ? limpo : `${limpo.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

/** Só a data, em UTC: o instante inteiro mudaria o texto sem mudar o sentido. */
export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Uma linha de atributo XML. Os valores aqui são ids, enums e datas: nunca texto livre. */
export function attrs(pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs.map(([name, value]) => ` ${name}="${value}"`).join("");
}
