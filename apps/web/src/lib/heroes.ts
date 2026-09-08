import type { components } from "@dungeon-master/api-client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { heroKeys } from "@/lib/achievements";
import { fail } from "@/lib/problem";

/**
 * As estatísticas de Herói e de Equipamento (planejamento v0.4, Fase 2.5A).
 *
 * Projeção e cosmética: nenhuma funcionalidade depende de nível, e a web não
 * recalcula nada. `level` e `xpToNextLevel` chegam prontos porque a curva é
 * dado do catálogo — uma segunda fórmula aqui divergiria da primeira.
 *
 * Os nomes vêm por junção na leitura e são nulos quando a entidade foi
 * apagada: a linha de estatística sobrevive ao registro que a produziu, e
 * apagá-la junto reescreveria o passado.
 */

export type HeroStatsRecord = components["schemas"]["HeroStats"];
type HeroStatsResponse = components["schemas"]["HeroStatsResponse"];
export type TaskReopeningRecord = components["schemas"]["TaskReopening"];
type TaskReopeningList = components["schemas"]["TaskReopeningList"];
type TaskKind = components["schemas"]["TaskKind"];

export function useHeroStats(): UseQueryResult<HeroStatsResponse> {
  return useQuery({
    queryKey: heroKeys.stats,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/heroes/stats");
      if (data === undefined) fail(error, response.status, "Não foi possível ler as estatísticas");
      return data;
    },
  });
}

/** A fração da barra de experiência dentro do nível corrente. */
export function levelPercent(stats: HeroStatsRecord): number {
  const span = stats.xp + stats.xpToNextLevel;
  if (span === 0) return 0;
  return Math.min(100, Math.round((stats.xp / span) * 100));
}

export const reopeningKeys = {
  list: (kind: TaskKind | undefined) => ["task-reopenings", kind ?? "all"] as const,
};

/**
 * As Tasks já reabertas, com a contagem: o dado da coluna de nêmesis.
 *
 * Uma consulta só para a aba inteira, esparsa (só quem tem reabertura), e a
 * tabela junta por `taskId`. Vem da API porque a contagem mora no diário, que
 * a web não lê — e porque é a mesma definição que instancia a Conquista de
 * nêmesis, então a tela nunca mostra um número que a Conquista não reconhece.
 */
export function useTaskReopenings(kind?: TaskKind): UseQueryResult<TaskReopeningList> {
  return useQuery({
    queryKey: reopeningKeys.list(kind),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/task-reopenings", {
        params: { query: kind === undefined ? {} : { kind } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler as reaberturas");
      return data;
    },
  });
}
