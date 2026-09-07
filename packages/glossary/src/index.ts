/**
 * `@dungeon-master/glossary` — canônico para tema.
 *
 * Fonte única dos labels da interface. Os dois glossários, `dnd` e `plain`,
 * têm exatamente o mesmo conjunto de chaves, garantido em tempo de tipo
 * (planejamento v0.4, seção 14 e princípio 17). Nenhum componente escreve
 * "Campanha" ou "Projeto" direto no JSX: o label vem daqui.
 *
 * O pacote é puro. Não importa nada além de si mesmo, não lê arquivo, não
 * conhece banco, HTTP nem React.
 */

export * from "./dnd.js";
export * from "./format.js";
export * from "./keys.js";
export * from "./plain.js";
export * from "./theme.js";
