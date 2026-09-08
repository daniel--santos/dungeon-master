/**
 * `@dungeon-master/runtime-antigravity` — o adapter do Antigravity CLI.
 *
 * Pacote separado de `runtime-sandcastle` porque o Antigravity não é um
 * provider do Sandcastle: ele é uma CLI que a gente fala direto (planejamento
 * v0.4, Fase 3B). O que os dois pacotes compartilham é a base de adapter de
 * CLI — achar o executável sem shell, cachear o preflight, montar o comando —,
 * e é por isso que este importa daquele em vez de copiar.
 *
 * O contrato medido da CLI está no `README.md`.
 */

export * from "./antigravity.js";

import type { HarnessAdapter } from "@dungeon-master/runtime";

import { antigravity } from "./antigravity.js";

/**
 * O adapter de host do Antigravity, pronto para o `HarnessRegistry`.
 *
 * Função, e não constante, pela mesma razão de `hostAdapters()`: o preflight é
 * cacheado por instância, e um singleton de módulo compartilharia esse cache
 * entre testes.
 */
export function antigravityHostAdapters(): readonly HarnessAdapter[] {
  return [antigravity()];
}
