import type { Condition, ConditionFilter } from "../condition.js";
import {
  type AchievementDefinition,
  AchievementDefinitionSchema,
  type AchievementTemplate,
  type TemplatePlaceholder,
  TEMPLATE_PLACEHOLDERS,
} from "../definition.js";

/**
 * Instanciação de template (planejamento v0.4, Fase 2.5A e 2.5B).
 *
 * O template não carrega placeholder dentro da condição: ele diz, em
 * `scopeFrom`, **por qual campo do filtro** a condição é escopada, e a
 * aplicação preenche o id real. Com isso o projetor não precisa de nenhuma
 * lógica de escopo — o escopo vira um filtro comum, avaliado pelo mesmo
 * `matchesFilter` de todo mundo.
 *
 * O nome fica com o placeholder na definição gravada, e é formatado na leitura,
 * pela API, com o nome atual da entidade. Gravar o nome já formatado deixaria a
 * Conquista chamando a Campanha pelo nome antigo depois de uma renomeação.
 */

/** Uma instância pronta para virar linha de `achievement_definition`. */
export interface TemplateInstance {
  readonly templateKey: string;
  readonly scopeId: string;
  /** A definição com a condição já escopada. O nome mantém o placeholder. */
  readonly definition: AchievementDefinition;
}

/** Por que uma instanciação foi recusada. Fail-closed: nada é gravado. */
export interface TemplateInstanceRejection {
  readonly templateKey: string;
  readonly scopeId: string;
  readonly error: string;
}

export type InstantiateResult =
  | { readonly ok: true; readonly value: TemplateInstance }
  | { readonly ok: false; readonly rejection: TemplateInstanceRejection };

function scopedCondition(condition: Condition, field: string, scopeId: string): Condition {
  const filter = { ...(condition.filter ?? {}), [field]: scopeId } as ConditionFilter;
  return { ...condition, filter } as Condition;
}

/**
 * Instancia um template para uma entidade concreta.
 *
 * O resultado passa de novo pelo `AchievementDefinitionSchema`: se o `scopeId`
 * não for do formato que o campo do filtro exige — um uuid para `project.id`,
 * um slug para `run.harness` —, a instância é recusada e o chamador loga, em vez
 * de gravar uma definição que nunca casaria com nada.
 */
export function instantiateTemplate(
  template: AchievementTemplate,
  scopeId: string,
): InstantiateResult {
  const recusa = (error: string): InstantiateResult => ({
    ok: false,
    rejection: { templateKey: template.key, scopeId, error },
  });

  if (scopeId === "") return recusa("O escopo da instância veio vazio.");

  const candidata = {
    ...template,
    condition: scopedCondition(template.condition, template.scopeFrom, scopeId),
  };

  // `instantiatedBy` e `scopeFrom` são do template, não da definição: o schema
  // é estrito e recusaria os dois campos a mais.
  const { instantiatedBy: _instantiatedBy, scopeFrom: _scopeFrom, ...definicao } = candidata;

  const parsed = AchievementDefinitionSchema.safeParse(definicao);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const onde = issue === undefined ? "" : `${issue.path.join(".")}: `;
    return recusa(`${onde}${issue?.message ?? "instância inválida"}`);
  }

  return { ok: true, value: { templateKey: template.key, scopeId, definition: parsed.data } };
}

const PLACEHOLDER = /\{([A-Za-z0-9_.]+)\}/g;

/**
 * Troca os placeholders conhecidos pelo nome atual da entidade.
 *
 * Um placeholder sem valor fica como está, em vez de virar texto vazio: um nome
 * "Guardião de " esconderia o problema, e "Guardião de {project}" o mostra.
 */
export function formatTemplateText(
  text: string,
  values: Partial<Record<TemplatePlaceholder, string>>,
): string {
  return text.replace(PLACEHOLDER, (match, name: string) => {
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name)) return match;
    const value = values[name as TemplatePlaceholder];
    return value === undefined || value === "" ? match : value;
  });
}

/** O placeholder que um template de cada escopo preenche. */
export function placeholderForScope(scope: string): TemplatePlaceholder | null {
  switch (scope) {
    case "PROJECT":
      return "project";
    case "HARNESS":
      return "harness";
    case "AGENT":
      return "agent";
    case "TASK":
      return "task";
    default:
      return null;
  }
}
