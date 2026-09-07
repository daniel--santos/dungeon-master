import { dnd } from "./dnd.js";
import type { Glossary, GlossaryKey } from "./keys.js";
import { plain } from "./plain.js";

/**
 * Temas disponíveis. Um terceiro tema é só um terceiro arquivo com as mesmas
 * chaves, acrescentado a `GLOSSARIES` (planejamento v0.4, seção 14).
 */
export type ThemeId = "dnd" | "plain";

/** Todos os temas, em ordem de exibição no interruptor de Settings. */
export const THEME_IDS = ["dnd", "plain"] as const satisfies readonly ThemeId[];

/** O interruptor "Tema Dungeon Master" nasce ligado (seção 47.1). */
export const DEFAULT_THEME: ThemeId = "dnd";

/** Os glossários carregados, indexados por tema. */
export const GLOSSARIES: Readonly<Record<ThemeId, Glossary>> = { dnd, plain };

/** Devolve o glossário completo de um tema. */
export function getGlossary(theme: ThemeId): Glossary {
  return GLOSSARIES[theme];
}

/**
 * Resolve um label no tema ativo.
 *
 * Não interpola: para nomes parametrizados de Conquistas, componha com
 * `format`. Chave fora da união é erro de compilação, então esta função nunca
 * devolve `undefined`.
 */
export function t(theme: ThemeId, key: GlossaryKey): string {
  return GLOSSARIES[theme][key];
}

/** `true` se o valor é um tema conhecido; usado ao ler a preferência persistida. */
export function isThemeId(value: unknown): value is ThemeId {
  return value === "dnd" || value === "plain";
}
