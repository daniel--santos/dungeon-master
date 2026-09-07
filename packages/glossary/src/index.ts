/**
 * `@dungeon-master/glossary` — canônico para tema.
 *
 * Esqueleto da Fase 0. Recebe depois os dois glossários de chaves idênticas,
 * `dnd` e `plain`, com paridade garantida em tempo de tipo (planejamento v0.4,
 * seção 14). Nenhum label de entidade da UI pode existir fora daqui.
 */

/** Temas disponíveis. Um terceiro tema é só um terceiro arquivo com as mesmas chaves. */
export type GlossaryName = "dnd" | "plain";

/** O pacote ainda não exporta chaves nem labels. */
export const GLOSSARY_PACKAGE = "@dungeon-master/glossary" as const;
