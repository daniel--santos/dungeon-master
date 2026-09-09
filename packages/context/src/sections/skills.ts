import { fastEstimateTokens } from "../token-estimate.js";
import type { EntryDraft, SectionDraft, SkillSource } from "../types.js";
import { cleanTitle } from "./shared.js";

export const SKILLS_SECTION_TITLE = "Habilidades do Loadout";

/** O cabeçalho da seção no prompt, fora do bloco `<context>`. */
export const SKILLS_HEADING = "# Habilidades";

/**
 * O preâmbulo das Habilidades: uma vez, antes da primeira.
 *
 * Diz ao agente que o que segue **é** instrução — o contrário do que o
 * preâmbulo do `<context>` diz sobre o bloco dele —, e que cada uma está
 * delimitada. O texto é fixo, sem contagem nem data, pelo mesmo motivo do
 * bloco: o mesmo prefixo em todos os passos preserva o cache de prompt.
 */
export const SKILLS_PREAMBLE = [
  "As habilidades abaixo fazem parte do equipamento deste agente e foram escritas pelo",
  "usuário: siga-as como instruções de trabalho, junto com as do papel. Cada uma vem na",
  "versão congelada para esta execução, delimitada por <skill …> … </skill>; o que está",
  "entre as tags é o texto integral dela.",
].join("\n");

/** A moldura da seção: o que custa mesmo sem nenhuma Habilidade dentro. */
export function skillsFrame(): { readonly open: string; readonly close: string } {
  return { open: `${SKILLS_HEADING}\n\n${SKILLS_PREAMBLE}\n\n`, close: "" };
}

/** O valor de um atributo: sanitizado como título, e sem aspas soltas. */
function attrValue(text: string): string {
  return cleanTitle(text).replace(/"/g, "&quot;");
}

/**
 * Neutraliza um `</skill>` escrito dentro de uma Habilidade.
 *
 * É a única transformação que o conteúdo sofre. Ele é texto do usuário, e não
 * de modelo: não passa por `sanitizeForContext`, que escaparia o markdown que
 * o usuário escreveu de propósito. Só o fechamento da própria tag não pode
 * sobreviver, senão o que vem depois dele sai da delimitação.
 */
function fenceContent(content: string): string {
  return content.replace(/<\/(skill)(\s*)>/giu, "<\\/$1$2>");
}

/**
 * As Habilidades do Loadout, na ordem em que o Loadout as declara (Fase 8B).
 *
 * Cada Habilidade com conteúdo vira um bloco `<skill name version pinned>` com
 * o texto integral da versão efetiva; uma sem conteúdo — a Skill vazia que a
 * migração `0015` criou a partir de um nome, ou um Run anterior à Fase 8, que
 * só tem os nomes — vira a linha de antes, com o nome. Deduplicadas pelo nome.
 *
 * Um trecho **não** é cortado ao meio: uma instrução pela metade pode dizer o
 * contrário do que dizia inteira. Ou a Habilidade entra inteira, ou fica de
 * fora com o motivo no registro. A ordem do Loadout é a prioridade.
 */
export function buildSkillsSection(skills: readonly SkillSource[]): SectionDraft {
  const vistas = new Set<string>();
  const entries: EntryDraft[] = [];

  for (const skill of skills) {
    const nome = cleanTitle(skill.name);
    if (nome.length === 0 || vistas.has(nome)) continue;
    vistas.add(nome);

    const conteudo = skill.content?.trim() ?? "";
    const versao = skill.version;
    const rotulo =
      versao === undefined ? nome : `${nome} v${String(versao)}${skill.pinned ? " (pinada)" : ""}`;

    if (conteudo.length === 0) {
      const prefix = `- ${rotulo}`;
      entries.push({
        item: {
          id: skill.skillId ?? nome,
          kind: "SKILL",
          title: rotulo,
          reason: "LOADOUT_SKILL",
          score: null,
          tokens: fastEstimateTokens(prefix),
          truncated: false,
        },
        prefix,
        content: "",
        suffix: "",
        truncatable: false,
      });
      continue;
    }

    const prefix =
      `<skill name="${attrValue(skill.name)}"` +
      (versao === undefined ? "" : ` version="${String(versao)}"`) +
      ` pinned="${skill.pinned === true ? "true" : "false"}">\n`;
    const suffix = "\n</skill>";
    const content = fenceContent(conteudo);
    entries.push({
      item: {
        id: skill.skillId ?? nome,
        kind: "SKILL",
        title: rotulo,
        reason: "LOADOUT_SKILL",
        score: null,
        tokens: fastEstimateTokens(`${prefix}${content}${suffix}`),
        truncated: false,
      },
      prefix,
      content,
      suffix,
      truncatable: false,
    });
  }

  return { kind: "SKILLS", title: SKILLS_SECTION_TITLE, tag: null, entries };
}
