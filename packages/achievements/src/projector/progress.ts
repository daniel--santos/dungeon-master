import type { Condition } from "../condition.js";

import {
  dimensionValue,
  isContrarySource,
  matchesFilter,
  metricValue,
  type ProjectionEvent,
} from "./event.js";

/**
 * O estado de progresso de uma Conquista e a avaliação de um fato sobre ele
 * (planejamento v0.4, Fase 2.5B).
 *
 * Tudo aqui é função pura: entra o estado e um fato, sai o estado novo e a
 * lista de tiers que **acabaram** de ser alcançados. Quem grava é o adaptador de
 * banco; quem decide é este arquivo, e ele roda inteiro em teste sem
 * infraestrutura.
 *
 * A avaliação é um *fold*: o estado depois de N fatos não depende de quando eles
 * foram processados, só da ordem em que chegaram. É essa propriedade que faz
 * `dm achievements rebuild` reproduzir exatamente os mesmos desbloqueios.
 */

/** O progresso de uma Conquista para um usuário. */
export interface AchievementProgress {
  /** Quantos fatos casaram. É o numerador de um `count` e o 0/1 de um `first`. */
  readonly counter: number;
  /** Melhor marca de um `record`. `null` enquanto nenhuma marca válida apareceu. */
  readonly best: number | null;
  /** Sequência atual de um `streak`. Zera no primeiro fato contrário. */
  readonly streak: number;
  /** Maior sequência já alcançada. Só para exibição; não desbloqueia nada. */
  readonly bestStreak: number;
  /** Valores já vistos de um `set`, sem repetição e em ordem de chegada. */
  readonly seen: readonly string[];
}

/** O progresso de quem ainda não fez nada. */
export const EMPTY_PROGRESS: AchievementProgress = {
  counter: 0,
  best: null,
  streak: 0,
  bestStreak: 0,
  seen: [],
};

/** O que a avaliação de um fato produziu. */
export interface EvaluationOutcome {
  readonly progress: AchievementProgress;
  /** O estado mudou? Falso dispensa a escrita. */
  readonly changed: boolean;
  /** Tiers (a partir de 1) alcançados **por este fato**. Vazio no caso comum. */
  readonly unlocked: readonly number[];
}

function unchanged(progress: AchievementProgress): EvaluationOutcome {
  return { progress, changed: false, unlocked: [] };
}

/**
 * Os limiares de cada tier da condição, na ordem.
 *
 * Só `count` tem mais de um. Os outros quatro têm um alvo só, e devolvê-lo com
 * a mesma forma poupa um `switch` em cada chamador — inclusive na API, que usa
 * isto para desenhar a barra de progresso.
 */
export function achievementTargets(condition: Condition): readonly number[] {
  switch (condition.predicate) {
    case "count":
      return condition.thresholds;
    case "streak":
      return [condition.length];
    case "set":
      return [condition.values.length];
    case "first":
    case "record":
      return [1];
  }
}

/**
 * Quanto do alvo já foi feito.
 *
 * Para `record` é 0 ou 1: uma marca ou existe ou não existe, e "quanto falta
 * para o recorde" não é uma pergunta com resposta.
 */
export function achievementValue(condition: Condition, progress: AchievementProgress): number {
  switch (condition.predicate) {
    case "count":
      return progress.counter;
    case "streak":
      return progress.streak;
    case "set":
      return progress.seen.length;
    case "first":
      return progress.counter > 0 ? 1 : 0;
    case "record":
      return progress.best === null ? 0 : 1;
  }
}

/** Quantos tiers a condição tem. Um, exceto num `count` com vários limiares. */
export function achievementTierCount(condition: Condition): number {
  return achievementTargets(condition).length;
}

/**
 * Quantos tiers o progresso já satisfaz.
 *
 * A diferença entre este número antes e depois de um fato é exatamente o que
 * precisa ser desbloqueado — o que torna a operação idempotente por construção:
 * reprocessar o mesmo fato sobre o estado já atualizado devolve zero tiers
 * novos, sem consultar a tabela de desbloqueios.
 */
export function tiersReached(condition: Condition, progress: AchievementProgress): number {
  const targets = achievementTargets(condition);
  const value = achievementValue(condition, progress);

  let reached = 0;
  for (const target of targets) {
    if (value >= target) reached += 1;
    else break;
  }
  return reached;
}

function tiersBetween(before: number, after: number): number[] {
  const tiers: number[] = [];
  for (let tier = before + 1; tier <= after; tier += 1) tiers.push(tier);
  return tiers;
}

function withSeen(progress: AchievementProgress, value: string): AchievementProgress {
  if (progress.seen.includes(value)) return progress;
  return { ...progress, seen: [...progress.seen, value] };
}

/**
 * Aplica um fato ao progresso de uma condição.
 *
 * Fatos de outra fonte são ignorados, com uma exceção deliberada: um fato
 * **contrário** zera a sequência de um `streak`, e é por isso que o adaptador
 * entrega todo fato a toda condição em vez de pré-filtrar por fonte.
 */
export function applyEvent(
  condition: Condition,
  progress: AchievementProgress,
  event: ProjectionEvent,
): EvaluationOutcome {
  if (event.source !== condition.source) {
    return applyContrary(condition, progress, event);
  }

  if (!matchesFilter(condition.filter, event.fields)) return unchanged(progress);

  const before = tiersReached(condition, progress);
  const depois = advance(condition, progress, event);
  if (depois === progress) return unchanged(progress);

  const after = tiersReached(condition, depois);
  return { progress: depois, changed: true, unlocked: tiersBetween(before, after) };
}

/**
 * Um fato de outra fonte só interessa a um `streak`, e só quando é contrário.
 *
 * O filtro continua valendo: uma sequência de vitórias com a Guilda X não é
 * quebrada por uma derrota da Guilda Y — aquela derrota não é do assunto que a
 * Conquista conta.
 */
function applyContrary(
  condition: Condition,
  progress: AchievementProgress,
  event: ProjectionEvent,
): EvaluationOutcome {
  if (condition.predicate !== "streak") return unchanged(progress);
  if (!isContrarySource(condition.source, event.source)) return unchanged(progress);
  if (!matchesFilter(condition.filter, event.fields)) return unchanged(progress);
  if (progress.streak === 0) return unchanged(progress);

  // Zerar nunca desbloqueia nada, e nunca desfaz um desbloqueio: o que foi
  // conquistado fica. `bestStreak` é o que sobra da sequência perdida.
  return { progress: { ...progress, streak: 0 }, changed: true, unlocked: [] };
}

/** O avanço de cada predicado. Devolve o mesmo objeto quando nada mudou. */
function advance(
  condition: Condition,
  progress: AchievementProgress,
  event: ProjectionEvent,
): AchievementProgress {
  switch (condition.predicate) {
    case "count":
      return { ...progress, counter: progress.counter + 1 };

    case "first":
      // Depois da primeira vez não há segunda: contar as seguintes só faria a
      // barra de progresso de um alvo 1 passar de 100%.
      return progress.counter > 0 ? progress : { ...progress, counter: 1 };

    case "streak": {
      const streak = progress.streak + 1;
      return {
        ...progress,
        counter: progress.counter + 1,
        streak,
        bestStreak: Math.max(progress.bestStreak, streak),
      };
    }

    case "set": {
      const value = dimensionValue(condition.dimension, event.fields);
      // O fato não traz a dimensão, ou traz um valor fora do conjunto pedido:
      // não é progresso, é ruído.
      if (value === undefined || !condition.values.includes(value)) return progress;
      const comValor = withSeen(progress, value);
      if (comValor === progress) return progress;
      return { ...comValor, counter: comValor.seen.length };
    }

    case "record": {
      const value = metricValue(condition.metric, event.metrics);
      if (value === undefined) return progress;
      // `min` é o piso de elegibilidade, nas duas direções: sem ele, um recorde
      // de "menor duração" seria sempre o Run que morreu em três milissegundos.
      if (condition.min !== undefined && value < condition.min) return progress;

      const melhor =
        progress.best === null
          ? value
          : condition.direction === "max"
            ? Math.max(progress.best, value)
            : Math.min(progress.best, value);

      if (melhor === progress.best) return progress;
      return { ...progress, best: melhor, counter: progress.counter + 1 };
    }
  }
}
