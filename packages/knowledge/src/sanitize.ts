// Adapted from TencentDB Agent Memory — MemoryCore/src/utils/sanitize.ts@3efcd31 (`escapeXmlTags`)
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: a lista de tags escapadas deixou de ser a das seções de memória
// pessoal (`user-persona`, `relevant-memories`, ...) e passou a ser a das
// fronteiras que este projeto usa em prompt — `system`, `assistant`, `user`,
// `result`, `candidate`, `knowledge`, `project-summary`, `run-log`,
// `instructions` — e o resto do arquivo de origem (limpeza de metadados de
// gateway, filtros L0/L1, detecção de injeção) não veio: o que este pacote
// precisa é só a anti-injeção sobre texto escrito por modelo. Entrou
// `sanitizeLlmText`, que é nosso, por cima da função copiada.

/**
 * As tags cujo fechamento um texto escrito por modelo não pode conter.
 *
 * Quando um item do Grimório for reinjetado num prompt (Fase 7), ele vai
 * dentro de uma seção delimitada por XML; um `</knowledge>` no meio do texto
 * fecharia a seção antes da hora e o resto viraria instrução. As tags aqui
 * são as fronteiras que os nossos prompts usam, mais as clássicas `system`,
 * `assistant` e `user`, que todo harness trata como especiais.
 */
const BOUNDARY_TAGS = [
  "system",
  "assistant",
  "user",
  "result",
  "candidate",
  "candidates",
  "knowledge",
  "knowledge-item",
  "project-summary",
  "run-log",
  "instructions",
  "context",
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
