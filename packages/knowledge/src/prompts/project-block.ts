import type { ProjectContext } from "../types.js";
import { sanitizeLlmText } from "../sanitize.js";

/**
 * O bloco `## Project` dos dois prompts do Escriba, num lugar só.
 *
 * post-mortem #21 (2026-09-08): os dois prompts montavam este bloco cada um
 * por si, e os dois interpolavam título e descrição **crus** — enquanto todo o
 * resto do mesmo prompt (candidatos, transcritos, itens do pool, resumo
 * anterior) passava por `escapeXmlTags`. Um `</candidates>` na descrição da
 * Campanha fechava a seção antes da hora e o resto do texto do usuário virava
 * instrução para o modelo do lote. Texto do usuário é texto não confiável
 * (CLAUDE.md, seção 9), sem a exceção não declarada que existia aqui. Um
 * bloco só, uma sanitização só: duas cópias foi o que deixou a regra valer
 * três linhas abaixo e não aqui.
 */

/** Teto do título da Campanha no prompt. Acima disto é uma frase, não um título. */
export const PROJECT_TITLE_MAX_LENGTH = 200;

/** Teto da descrição da Campanha no prompt. */
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2_000;

export function formatProjectBlock(project: ProjectContext): string {
  const titulo = sanitizeLlmText(project.title, { maxLength: PROJECT_TITLE_MAX_LENGTH });
  const descricao =
    project.description === null
      ? ""
      : sanitizeLlmText(project.description, { maxLength: PROJECT_DESCRIPTION_MAX_LENGTH });

  return [
    `## Project`,
    `Título: ${titulo}`,
    ...(descricao.length === 0 ? [] : [`Descrição: ${descricao}`]),
  ].join("\n");
}
