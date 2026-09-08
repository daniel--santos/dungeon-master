// Adapted from TencentDB Agent Memory — MemoryProxy/src/common/user-query-extractor.ts@3efcd31
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: `extractUserQueryText` virou `filterHarnessNoise`, aplicado ao texto
// que um Run gravou em `run_event` antes de ele entrar no prompt do Distiller
// — e não à mensagem do usuário de um proxy de chat. As três camadas do
// original ficaram (descarte da mensagem inteira quando ela é um prompt
// interno da CLI; remoção dos wrappers XML que o harness injeta; filtro linha
// a linha dos ecos de ferramenta e do frontmatter de MEMORY.md), com a lista
// de wrappers ampliada com `local-command-stdout`, `command-name`,
// `command-message` e `function_results`, que aparecem no stream do Claude
// Code. O bloco `<user_query>` do CodeBuddy e o marcador de sessão do DSH não
// vieram: não existem aqui. Mensagens em português.

/**
 * Prompts internos que a CLI põe no fluxo como se fossem conversa.
 *
 * Uma mensagem que casa com um destes padrões no **começo** não é texto do
 * agente sobre a Task: é um modo de sugestão, um recap de sessão, um recibo
 * de pergunta respondida ou um log reproduzido com carimbo. A mensagem inteira
 * é descartada, e é por isso que os padrões são ancorados — texto real sobre
 * a Task nunca começa assim.
 */
const HARNESS_INTERNAL_PROMPT_PATTERNS: readonly RegExp[] = [
  /^\s*\[(?:SUGGESTION|TITLE|SUMMARY|COMPACT|COMPACTION|ANALYSIS|EVAL|RECAP|MEMORY|SIDECHAIN)\s+MODE[:\s]/i,
  /^\s*The user stepped away and is coming back\.\s*Recap/i,
  /^\s*Your questions have been answered:\s*"/i,
  /^\s*\d+\s*\{"parentUuid"|^\s*\{"parentUuid":\s*"[^"]+","isSidechain"/,
  /^\s*\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\]]*\]\[(?:user|assistant|system)\]/,
];

/** A mensagem inteira é um prompt interno da CLI? */
export function isHarnessInternalPrompt(text: string): boolean {
  const aparado = text.trim();
  if (aparado.length === 0) return false;
  return HARNESS_INTERNAL_PROMPT_PATTERNS.some((pattern) => pattern.test(aparado));
}

/**
 * Wrappers XML que o harness injeta no fluxo e que não são texto do agente.
 *
 * Cada um vira uma expressão `<tag ...>...</tag>` que some inteira, inclusive
 * o conteúdo: o que está dentro é lembrete do sistema, metadado de sessão,
 * saída de ferramenta reproduzida ou um placeholder de arquivo grande.
 */
const WRAPPER_TAGS = [
  "system-reminder",
  "system_reminder",
  "additional_data",
  "user_info",
  "open_and_recently_viewed_files",
  "session",
  "persisted-output",
  "persisted_output",
  "tool_use_error",
  "tool-use-error",
  "tool_result",
  "tool-result",
  "function_results",
  "local-command-stdout",
  "local-command-stderr",
  "command-name",
  "command-message",
  "command-args",
  "question_answer",
] as const;

const WRAPPER_PATTERNS: readonly RegExp[] = WRAPPER_TAGS.map(
  (tag) => new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "gi"),
);

/**
 * Linhas que são eco de ferramenta, e não prosa.
 *
 * Cada regra é avaliada por linha; casar apaga só aquela linha e deixa o
 * resto do parágrafo. O `cat -n` do `Read` é reconhecido pelo tabulador
 * depois do número, que é o formato da ferramenta e não de uma lista escrita
 * por alguém.
 */
const LINE_DROP_PATTERNS: readonly RegExp[] = [
  /^\s*The file .+ has been (?:updated|created) successfully.*$/i,
  /^\s*File created successfully at:/i,
  /^\s*\(Bash completed with no output\)\s*$/,
  /^\s{0,6}\d+\t/,
  /^\s*File .+ has been (?:updated|created)/i,
];

/**
 * O frontmatter YAML de um MEMORY.md, que a CLI reproduz quando lê memória.
 *
 * Só casa quando pelo menos uma das chaves conhecidas aparece, para não
 * confundir com um `---` de separador de Markdown.
 */
const FRONTMATTER_PATTERN =
  /(?:^|\n)---\s*\n(?:[a-z_][a-z0-9_]*:\s*.*\n)*?(?:name|description|metadata|node_type|originSessionId):[\s\S]*?\n---\s*(?:\n|$)/gi;

/**
 * O texto de um Run sem o ruído do harness.
 *
 * Devolve `""` quando a mensagem inteira era ruído; quem chama decide o que
 * fazer com o vazio (o Distiller simplesmente não anexa o contexto). Nunca
 * lança.
 */
export function filterHarnessNoise(raw: string): string {
  if (isHarnessInternalPrompt(raw)) return "";

  let text = raw;

  for (const pattern of WRAPPER_PATTERNS) {
    text = text.replace(pattern, "");
  }

  text = text
    .split("\n")
    .filter((line) => !LINE_DROP_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n");

  text = text.replace(FRONTMATTER_PATTERN, "\n");

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A cauda do texto, com teto de caracteres.
 *
 * Cauda, e não cabeça: num Run longo o fim é onde o agente resume o que
 * descobriu, e o começo é a leitura de arquivos que o candidato já digeriu.
 */
export function tailOf(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `…${text.slice(text.length - maxLength + 1)}`;
}
