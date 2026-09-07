/**
 * Experiência e nível (planejamento v0.4, Fase 2.5A).
 *
 * Cosméticos. Nenhuma funcionalidade depende de nível. Só funções puras e
 * constantes: o projetor que soma XP mora no Worker, na Fase 2.5B, não aqui.
 */

/** Experiência por Expedição vitoriosa. */
export const XP_PER_VICTORY = 100;

/** Bônus por Monstro derrotado: Run vitorioso que conclui uma Task `BUG`. */
export const XP_BONUS_MONSTER = 50;

/** Bônus pela primeira vitória em Masmorra selada, isto é, o primeiro Run `DOCKER`. */
export const XP_BONUS_FIRST_DOCKER = 150;

/**
 * Passo da curva de nível: `xpForLevel(n) = XP_LEVEL_STEP * n * (n - 1)`.
 *
 * Curva triangular, então cada nível custa `2 * XP_LEVEL_STEP * n` a mais que o
 * anterior: 0, 100, 300, 600, 1000, 1500...
 */
export const XP_LEVEL_STEP = 50;

/** As constantes de XP em um só objeto, para log e para a tela de Hall. */
export const XP_RULES = {
  perVictory: XP_PER_VICTORY,
  bonusMonster: XP_BONUS_MONSTER,
  bonusFirstDocker: XP_BONUS_FIRST_DOCKER,
  levelStep: XP_LEVEL_STEP,
} as const;

/**
 * Experiência acumulada necessária para estar no nível `level`.
 *
 * O nível 1 começa em zero. Entrada fora de faixa é normalizada em vez de
 * lançar: essa camada nunca pode quebrar quem a chama.
 */
export function xpForLevel(level: number): number {
  const n = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  return XP_LEVEL_STEP * n * (n - 1);
}

/** Nível correspondente a uma experiência acumulada. Inversa de `xpForLevel`. */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  const total = Math.floor(xp);

  // n <= (1 + sqrt(1 + 4 * total / XP_LEVEL_STEP)) / 2, ajustado por segurança
  // contra o arredondamento da raiz.
  let level = Math.floor((1 + Math.sqrt(1 + (4 * total) / XP_LEVEL_STEP)) / 2);
  if (!Number.isFinite(level) || level < 1) level = 1;

  while (xpForLevel(level + 1) <= total) level += 1;
  while (level > 1 && xpForLevel(level) > total) level -= 1;
  return level;
}

/** Quanto falta, em experiência, para o próximo nível. Alimenta a barra do Hall. */
export function xpToNextLevel(xp: number): number {
  const total = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  return xpForLevel(levelForXp(total) + 1) - total;
}
