import { fastEstimateTokens } from "../token-estimate.js";
import type { EntryDraft, SectionDraft } from "../types.js";
import { cleanTitle } from "./shared.js";

export const SKILLS_SECTION_TITLE = "Skills do Loadout";

/**
 * As skills do Loadout, como texto, na ordem em que o Loadout as declara.
 *
 * Na Fase 7 uma skill é só um nome (o registro versionado é assunto da Fase
 * 8); dizer ao agente quais estão disponíveis é o que dá para fazer com um
 * nome. Deduplicadas, e nunca cortadas pelo orçamento.
 */
export function buildSkillsSection(skills: readonly string[]): SectionDraft {
  const vistas = new Set<string>();
  const entries: EntryDraft[] = [];

  for (const skill of skills) {
    const nome = cleanTitle(skill);
    if (nome.length === 0 || vistas.has(nome)) continue;
    vistas.add(nome);
    const prefix = `- ${nome}`;
    entries.push({
      item: {
        id: nome,
        kind: "SKILL",
        title: nome,
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
  }

  return { kind: "SKILLS", title: SKILLS_SECTION_TITLE, tag: "skills", entries };
}
