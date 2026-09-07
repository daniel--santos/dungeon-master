/**
 * `@dungeon-master/runtime/testing` — o harness falso e a suíte de contrato.
 *
 * Exportado como **fonte**, e não compilado para `dist`: o módulo importa
 * `vitest`, que é dependência de desenvolvimento, e um `dist` que o importasse
 * levaria o Vitest para o caminho de produção de quem instalasse o pacote.
 */

export * from "./contract-suite.js";
export * from "./fake-harness.js";
