/**
 * `@dungeon-master/runs` — o domínio de execução que não é máquina de estados.
 *
 * A máquina de Run e o acoplamento com Task moram em `@dungeon-master/domain`,
 * que é puro no sentido mais estrito: nada de tempo, nada de agendamento. Aqui
 * ficam as peças de execução que precisam de relógio e de fila em memória, e
 * que ainda assim não conhecem banco, HTTP nem processo: o teto de concorrência
 * e a ordenação por chave de recurso.
 *
 * O pacote não importa `@dungeon-master/database` nem `@dungeon-master/platform`
 * de propósito: quem executa é o worker, e ele injeta o que for preciso.
 */

export * from "./capacity-lock.js";
export * from "./logger.js";

export const RUNS_PACKAGE = "@dungeon-master/runs" as const;
