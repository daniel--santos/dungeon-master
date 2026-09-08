// Adapted from TencentDB Agent Memory — MemoryCore/src/utils/sanitize.ts@3efcd31 (`escapeXmlTags`)
// and MemoryCore/src/core/scene/scene-navigation.ts@3efcd31 (`stripSceneNavigation`)
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: `escapeXmlTags` veio primeiro para `packages/knowledge` (Fase 6) e
// agora mora aqui, que é o destino do manifesto (planejamento v0.4, 13.3); o
// pacote de conhecimento importa daqui. A lista de tags escapadas deixou de
// ser a das seções de memória pessoal (`user-persona`, `relevant-memories`,
// ...) e passou a ser a das fronteiras que este projeto usa em prompt: as
// clássicas `system`, `assistant` e `user`, as do resultado e dos candidatos,
// e as seções do bloco de contexto da Fase 7 (`context`, `project-summary`,
// `decisions`, `knowledge`, `related-tasks`, `artifacts`, `skills` e os itens
// delas). `stripSceneNavigation` virou `stripInjectedContext`: o marcador
// deixou de ser o cabeçalho da navegação de cenas do `persona.md` e passou a
// ser o cabeçalho fixo do nosso bloco de contexto — o que ele evita é o mesmo
// laço de realimentação, um texto escrito por modelo que ecoou o bloco que
// recebeu e o devolveria ao prompt seguinte. O algoritmo (primeira ocorrência
// do cabeçalho, corte dali até o fim, `trimEnd`) é o do original. O resto do
// arquivo de origem (limpeza de metadados de gateway, filtros L0/L1, detecção
// de injeção, JSON) não veio. `sanitizeForContext` é nosso, por cima das duas.

/**
 * As tags cujo fechamento um texto escrito por modelo não pode conter.
 *
 * Todo item reinjetado num prompt vai dentro de uma seção delimitada por XML;
 * um `</knowledge>` no meio do texto fecharia a seção antes da hora e o resto
 * viraria instrução. As tags aqui são as fronteiras que os nossos prompts
 * usam — as do bloco de contexto, as do resultado e dos candidatos — mais as
 * clássicas `system`, `assistant` e `user`, que todo harness trata como
 * especiais.
 */
export const BOUNDARY_TAGS = [
  "system",
  "assistant",
  "user",
  "result",
  "candidate",
  "candidates",
  "instructions",
  "run-log",
  "context",
  "project-summary",
  "decisions",
  "decision",
  "knowledge",
  "knowledge-item",
  "related-tasks",
  "task",
  "artifacts",
  "artifact",
  "skills",
  "skill",
] as const;

const BOUNDARY_TAG_PATTERN = new RegExp(`<\\/?(?:${BOUNDARY_TAGS.join("|")})(?:\\s[^>]*)?>`, "gi");

/**
 * Escapa as tags XML que coincidem com as fronteiras dos nossos prompts.
 *
 * Só `<` e `>` das tags conhecidas viram `&lt;` e `&gt;`; o resto do texto
 * fica intacto, inclusive código com generics ou comparações. É deliberado:
 * escapar todo `<` deixaria ilegível um item que fala de `Array<string>`.
 */
export function escapeXmlTags(text: string): string {
  return text.replace(BOUNDARY_TAG_PATTERN, (match) =>
    match.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
}

/**
 * O cabeçalho fixo do bloco de contexto (`render.ts` começa o bloco com ele).
 *
 * É também o marcador que `stripInjectedContext` procura: um texto escrito por
 * modelo que contenha este cabeçalho é um texto que ecoou o bloco que recebeu.
 */
export const CONTEXT_BLOCK_HEADER = "## Contexto do projeto (recuperado automaticamente)";

/**
 * Remove, de um texto escrito por modelo, o eco do nosso próprio bloco de
 * contexto: do cabeçalho fixo até o fim.
 *
 * Sem isto, um resumo do Grimório que citasse o bloco inteiro de um Run
 * anterior seria reinjetado com o bloco dentro, e cada geração aninharia mais
 * um — o laço de realimentação que o original evita com a navegação de cenas.
 */
export function stripInjectedContext(text: string): string {
  const idx = text.indexOf(CONTEXT_BLOCK_HEADER);
  if (idx === -1) return text;
  return text.slice(0, idx).trimEnd();
}

// Os caracteres de controle, menos `\t` (0x09), `\n` (0x0A) e `\r` (0x0D).
// eslint-disable-next-line no-control-regex -- os controles são o alvo.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * O que todo texto entra no bloco de contexto passa, sem exceção.
 *
 * Nesta ordem: o eco do próprio bloco sai, os caracteres de controle somem
 * (menos quebra de linha e tabulação, que são texto), as tags de fronteira
 * são escapadas, as quebras viram `\n` e três ou mais linhas em branco viram
 * duas, e o resultado é aparado. Nunca lança e nunca devolve `null`.
 *
 * Passa por aqui tudo o que não foi escrito por nós: páginas e resumo do
 * Grimório, títulos e descrições de Task (uma Task filha nasceu de uma
 * proposta escrita por modelo), resumos de resultado de Runs anteriores e
 * caminhos de artefato. O custo é nulo e a regra fica sem exceção.
 */
export function sanitizeForContext(text: string): string {
  return escapeXmlTags(stripInjectedContext(text).replace(CONTROL_CHARACTERS, ""))
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
