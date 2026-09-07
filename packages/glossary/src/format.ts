/**
 * Interpolação de placeholders em labels e nomes de Conquistas.
 *
 * Os nomes instanciados a partir de um template trazem marcadores como
 * `{project}` ou `{agent}` (planejamento v0.4, Fase 2.5A, "Templates v1"). Não
 * há linguagem de expressão aqui, pela mesma razão dos Workflows: substituição
 * literal de nome por valor, nada mais.
 */

/** Valores aceitos em um placeholder. */
export type FormatParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{([A-Za-z0-9_.]+)\}/g;

/**
 * Troca cada `{nome}` pelo valor correspondente em `params`.
 *
 * Placeholder sem valor fica no texto como está, em vez de virar `undefined`
 * na tela: a camada de Conquistas é cosmética e nunca deve quebrar a UI.
 */
export function format(template: string, params?: FormatParams): string {
  if (params === undefined) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Os nomes de placeholder presentes em um texto, sem repetição e na ordem de aparição. */
export function placeholdersOf(template: string): string[] {
  const found: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined && !found.includes(name)) found.push(name);
  }
  return found;
}
