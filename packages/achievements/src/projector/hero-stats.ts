import type { ExecutionMode } from "../condition.js";
import {
  levelForXp,
  XP_BONUS_FIRST_DOCKER,
  XP_BONUS_MONSTER,
  XP_PER_VICTORY,
} from "../xp.js";

/**
 * As estatísticas de Herói, como fold puro (planejamento v0.4, Fase 2.5A).
 *
 * Cosméticas por definição: nenhuma funcionalidade depende de nível. Ficam aqui,
 * junto do projetor, porque são atualizadas no **mesmo passo** dele — separá-las
 * criaria uma segunda leitura dos mesmos eventos, e as duas divergiriam na
 * primeira falha entre elas.
 */

/** O estado acumulado de um Herói ou de um Equipamento. */
export interface HeroStatsState {
  readonly xp: number;
  readonly level: number;
  /** Expedições terminadas: vitórias, derrotas e desistências. */
  readonly expeditions: number;
  readonly victories: number;
  readonly defeats: number;
  /** Monstros derrotados: Runs vitoriosos que concluíram uma Task `BUG`. */
  readonly monstersSlain: number;
  /** Vitórias em Masmorra selada. O bônus de XP só sai na primeira. */
  readonly dockerVictories: number;
  /** Tokens somados dos eventos `Usage` das Expedições. */
  readonly tokens: number;
  /** Quantas Expedições por Guilda. É daqui que sai a mais usada. */
  readonly harnessCounts: Readonly<Record<string, number>>;
}

export const EMPTY_HERO_STATS: HeroStatsState = {
  xp: 0,
  level: 1,
  expeditions: 0,
  victories: 0,
  defeats: 0,
  monstersSlain: 0,
  dockerVictories: 0,
  tokens: 0,
  harnessCounts: {},
};

/**
 * Como uma Expedição terminou.
 *
 * `ABANDONED` é o cancelamento: não é vitória e não é derrota, mas é uma
 * Expedição que aconteceu. Contá-la como derrota inflaria o número de fracassos
 * de quem simplesmente mudou de ideia.
 */
export type RunOutcome = "VICTORY" | "DEFEAT" | "ABANDONED";

export interface RunOutcomeInput {
  readonly outcome: RunOutcome;
  /** Chave da Guilda que executou. Entra na contagem por harness. */
  readonly harness: string;
  readonly executionMode: ExecutionMode;
  /** A Task que este Run concluiu era um `BUG`? Vale o bônus de Monstro. */
  readonly monster: boolean;
}

/** Soma uma Expedição terminada ao estado. */
export function applyRunOutcome(state: HeroStatsState, input: RunOutcomeInput): HeroStatsState {
  const harnessCounts = {
    ...state.harnessCounts,
    [input.harness]: (state.harnessCounts[input.harness] ?? 0) + 1,
  };

  if (input.outcome !== "VICTORY") {
    return {
      ...state,
      expeditions: state.expeditions + 1,
      defeats: input.outcome === "DEFEAT" ? state.defeats + 1 : state.defeats,
      harnessCounts,
    };
  }

  const primeiraSelada = input.executionMode === "DOCKER" && state.dockerVictories === 0;

  const xp =
    state.xp +
    XP_PER_VICTORY +
    (input.monster ? XP_BONUS_MONSTER : 0) +
    (primeiraSelada ? XP_BONUS_FIRST_DOCKER : 0);

  return {
    ...state,
    xp,
    level: levelForXp(xp),
    expeditions: state.expeditions + 1,
    victories: state.victories + 1,
    monstersSlain: input.monster ? state.monstersSlain + 1 : state.monstersSlain,
    dockerVictories:
      input.executionMode === "DOCKER" ? state.dockerVictories + 1 : state.dockerVictories,
    harnessCounts,
  };
}

/** Soma os tokens de um evento `Usage`. Não mexe em XP: consumo não é feito. */
export function applyUsage(state: HeroStatsState, tokens: number): HeroStatsState {
  if (!Number.isFinite(tokens) || tokens <= 0) return state;
  return { ...state, tokens: state.tokens + Math.floor(tokens) };
}

/**
 * A Guilda mais usada.
 *
 * O empate é desfeito pela ordem alfabética, e não pela ordem de inserção do
 * objeto: a reconstrução precisa produzir exatamente o mesmo nome, e a ordem de
 * chaves de um `jsonb` relido do PostgreSQL não é a da escrita.
 */
export function topHarness(counts: Readonly<Record<string, number>>): string | null {
  let melhor: string | null = null;
  let maior = 0;

  for (const chave of Object.keys(counts).sort()) {
    const valor = counts[chave] ?? 0;
    if (valor > maior) {
      maior = valor;
      melhor = chave;
    }
  }

  return melhor;
}
