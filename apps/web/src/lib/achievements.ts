import type { components } from "@dungeon-master/api-client";
import type { GlossaryKey } from "@dungeon-master/glossary";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  BookOpen,
  CircleQuestionMark,
  Container,
  Flag,
  FlagOff,
  Flame,
  FolderPlus,
  Hourglass,
  Map,
  Moon,
  RotateCcw,
  ShieldCheck,
  Skull,
  Stamp,
  Swords,
  ThumbsDown,
  Trophy,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";

import { api } from "@/lib/api";
import { fail } from "@/lib/problem";

/**
 * As Conquistas do usuário, com progresso real (planejamento v0.4, Fase 2.5D).
 *
 * Até a Fase 2.5B o Hall lia o catálogo versionado e mostrava tudo bloqueado,
 * porque não havia projeção. Agora quem responde é `GET /achievements`: as
 * definições já gravadas, os templates que os dados do usuário instanciaram, o
 * progresso e o estado calculado. O catálogo continua exposto na API, e é a
 * fonte que o e2e compara com a tela, mas a grade não o lê mais.
 *
 * Nenhum estado é derivado aqui. `state`, `tier` e `progress` chegam prontos,
 * porque quem sabe o limiar do próximo tier é a condição do catálogo, e uma
 * segunda regra na web divergiria da primeira no dia em que um limiar mudasse.
 */

type AchievementListItem = components["schemas"]["AchievementListItem"];
type AchievementListResponse = components["schemas"]["AchievementListResponse"];
type AchievementDefinition = components["schemas"]["AchievementDefinition"];
type AchievementUnlockPage = components["schemas"]["AchievementUnlockPage"];
type AchievementUnlockRecord = components["schemas"]["AchievementUnlock"];

export type { AchievementListItem, AchievementUnlockRecord };

export type AchievementRarity = AchievementDefinition["rarity"];
export type AchievementOrigin = AchievementDefinition["origin"];
export type AchievementCounts = components["schemas"]["AchievementCounts"];

/** Os quatro estados que a carta pode ter, na ordem em que a jornada os produz. */
export const ACHIEVEMENT_STATES = ["LOCKED", "HIDDEN", "IN_PROGRESS", "UNLOCKED"] as const;
export type AchievementState = (typeof ACHIEVEMENT_STATES)[number];

export const ACHIEVEMENT_ORIGINS = ["CATALOG", "TEMPLATE", "FORGED"] as const;
export const ACHIEVEMENT_RARITIES = ["COMMON", "RARE", "EPIC", "LEGENDARY"] as const;

/**
 * A cor da raridade, que é a moldura da carta Heráldica.
 *
 * Mesma luminosidade e croma da família de acentos do design; só o matiz muda,
 * então nenhuma raridade grita mais alto que a outra por acidente de contraste.
 */
export const RARITY_COLOR: Record<AchievementRarity, string> = {
  COMMON: "oklch(0.704 0.04 256.788)",
  RARE: "oklch(0.72 0.13 250)",
  EPIC: "oklch(0.72 0.13 305)",
  LEGENDARY: "oklch(0.72 0.13 75)",
};

/** Cor neutra da carta oculta: uma carta oculta não vaza a raridade. */
export const NEUTRAL_COLOR = RARITY_COLOR.COMMON;

export const RARITY_LABEL: Record<AchievementRarity, GlossaryKey> = {
  COMMON: "achievement.rarity.common",
  RARE: "achievement.rarity.rare",
  EPIC: "achievement.rarity.epic",
  LEGENDARY: "achievement.rarity.legendary",
};

export const ORIGIN_LABEL: Record<AchievementOrigin, GlossaryKey> = {
  CATALOG: "achievement.origin.catalog",
  TEMPLATE: "achievement.origin.template",
  FORGED: "achievement.origin.forged",
};

export const STATE_LABEL: Record<AchievementState, GlossaryKey> = {
  LOCKED: "achievement.state.locked",
  HIDDEN: "achievement.state.hidden",
  IN_PROGRESS: "achievement.state.inProgress",
  UNLOCKED: "achievement.state.unlocked",
};

/**
 * Os ícones que o catálogo nomeia, resolvidos para componentes do lucide.
 *
 * O nome vem do JSON em kebab-case; o mapa é explícito porque um import
 * dinâmico por nome traria a biblioteca inteira para o bundle.
 */
const ICONS: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  container: Container,
  flag: Flag,
  "flag-off": FlagOff,
  // `flame` e `skull` são os ícones que o Distiller dá às forjadas de sequência
  // de vitórias e de nêmesis derrotado (Fase 6B).
  flame: Flame,
  "folder-plus": FolderPlus,
  hourglass: Hourglass,
  map: Map,
  moon: Moon,
  "rotate-ccw": RotateCcw,
  "shield-check": ShieldCheck,
  skull: Skull,
  stamp: Stamp,
  swords: Swords,
  "thumbs-down": ThumbsDown,
  users: Users,
  "wand-sparkles": WandSparkles,
};

/** O ícone da definição, ou o troféu quando o catálogo nomear um que não temos. */
export function achievementIcon(name: string): LucideIcon {
  return ICONS[name] ?? Trophy;
}

export const HIDDEN_ICON = CircleQuestionMark;

/**
 * Uma carta da grade, já normalizada para render.
 *
 * A normalização é uma só: **uma carta oculta não vaza nada**. A API já manda
 * `hidden` e o estado `HIDDEN`, mas manda junto o nome e a raridade, porque o
 * mesmo item deixa de ser oculto no primeiro progresso e a tela não deveria
 * pedir de novo. Apagar aqui o que não pode aparecer mantém a decisão num
 * lugar só, em vez de espalhar `state === "HIDDEN" ? … : …` pela carta.
 */
export interface AchievementCard {
  /**
   * Identidade da carta na grade.
   *
   * É o `id` da definição gravada, e não a chave do catálogo, porque um
   * template vira **uma definição por entidade**: dois Projects produzem dois
   * "Guardião de {campanha}" com a mesma `key` e ids diferentes.
   */
  readonly id: string;
  /** A chave do catálogo ou do template. Vazia numa forjada, que não tem uma. */
  readonly key: string;
  readonly origin: AchievementOrigin;
  /** Nula na carta oculta, que não revela a raridade. */
  readonly rarity: AchievementRarity | null;
  readonly state: AchievementState;
  readonly icon: string;
  readonly name: { readonly theme: string; readonly plain: string } | null;
  readonly description: { readonly theme: string; readonly plain: string } | null;
  readonly flavor: string | undefined;
  /** Tier corrente e total. `total > 1` é o que faz a carta mostrar o grau. */
  readonly tier: {
    readonly current: number;
    readonly total: number;
    readonly label: string | null;
  };
  readonly progress: {
    readonly current: number;
    readonly target: number;
    readonly percent: number;
  };
  readonly unlockedAt: string | null;
}

export function toCard(item: AchievementListItem): AchievementCard {
  const hidden = item.state === "HIDDEN";

  return {
    id: item.id,
    key: item.key ?? item.id,
    origin: item.origin,
    rarity: hidden ? null : item.rarity,
    state: item.state,
    icon: item.icon,
    name: hidden ? null : item.name,
    description: hidden ? null : item.description,
    flavor: hidden ? undefined : (item.flavor ?? undefined),
    tier: item.tier,
    progress: item.progress,
    unlockedAt: item.unlockedAt,
  };
}

/**
 * Os filtros do Hall, como parâmetros de busca tipados da rota.
 *
 * Cada chave tem `.catch()`: uma URL colada à mão nunca derruba a tela, o valor
 * inválido some e a grade abre inteira. Os valores são os enums canônicos, e
 * não os labels, então a URL não muda com o interruptor de tema.
 *
 * `tab` está aqui pelo mesmo motivo que o resto: a aba aberta é estado de
 * navegação, e um link para o Bestiário precisa abrir no Bestiário.
 */
export const HALL_TABS = ["achievements", "heroes", "bestiary", "chronicle"] as const;
export type HallTab = (typeof HALL_TABS)[number];

export const hallSearchSchema = z.object({
  tab: z.enum(HALL_TABS).optional().catch(undefined),
  origin: z.enum(ACHIEVEMENT_ORIGINS).optional().catch(undefined),
  rarity: z.enum(ACHIEVEMENT_RARITIES).optional().catch(undefined),
  state: z.enum(ACHIEVEMENT_STATES).optional().catch(undefined),
});

export type HallSearch = z.infer<typeof hallSearchSchema>;
export type HallFilters = Omit<HallSearch, "tab">;

/**
 * Os filtros da URL como a query da API os espera.
 *
 * Chave ausente não entra: mandar `origin=` vazio filtraria por origem vazia
 * em vez de não filtrar. `tab` fica de fora porque é navegação, não filtro —
 * trocar de aba não pode refazer a consulta das Conquistas.
 */
export function toAchievementQuery(filters: HallFilters): {
  origin?: AchievementOrigin;
  rarity?: AchievementRarity;
  state?: AchievementState;
} {
  return {
    ...(filters.origin === undefined ? {} : { origin: filters.origin }),
    ...(filters.rarity === undefined ? {} : { rarity: filters.rarity }),
    ...(filters.state === undefined ? {} : { state: filters.state }),
  };
}

export const achievementKeys = {
  all: ["achievements"] as const,
  list: (filters: HallFilters) => ["achievements", "list", filters] as const,
  unlocks: ["achievements", "unlocks"] as const,
  // O tamanho entra na chave porque duas telas leem esta rota com tamanhos
  // diferentes: o Hall pede 50 para decidir o ponto de "ainda não vista" e a
  // Crônica pede 25 por página. Sem ele, uma entrada de cache serviria às duas
  // com o tamanho de quem chegasse primeiro.
  unlockPage: (page: number, pageSize: number | undefined) =>
    ["achievements", "unlocks", page, pageSize] as const,
};

export const heroKeys = { stats: ["heroes", "stats"] as const };

export interface Hall {
  readonly cards: readonly AchievementCard[];
  readonly counts: AchievementCounts;
}

const EMPTY_COUNTS: AchievementCounts = {
  total: 0,
  unlocked: 0,
  inProgress: 0,
  locked: 0,
  hidden: 0,
};

export function useAchievements(filters: HallFilters): UseQueryResult<AchievementListResponse> {
  return useQuery({
    queryKey: achievementKeys.list(filters),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/achievements", {
        params: { query: toAchievementQuery(filters) },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a lista");
      return data;
    },
    // Trocar de filtro não deve piscar a grade inteira enquanto a nova volta.
    placeholderData: (previous) => previous,
  });
}

/** A grade e o medidor. `counts` ignora os filtros: é o total, ao lado deles. */
export function useHall(filters: HallFilters): {
  query: UseQueryResult<AchievementListResponse>;
  hall: Hall;
} {
  const query = useAchievements(filters);
  const data = query.data;

  const hall = useMemo<Hall>(
    () =>
      data === undefined
        ? { cards: [], counts: EMPTY_COUNTS }
        : { cards: data.items.map(toCard), counts: data.counts },
    [data],
  );

  return { query, hall };
}

/* ------------------------------------------------------------- crônica */

export interface UnlockPageParams {
  readonly page: number;
  readonly pageSize?: number;
}

export function useUnlocks(params: UnlockPageParams): UseQueryResult<AchievementUnlockPage> {
  const { page, pageSize } = params;

  return useQuery({
    queryKey: achievementKeys.unlockPage(page, pageSize),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/achievements/unlocks", {
        params: {
          query: {
            page: String(page),
            ...(pageSize === undefined ? {} : { pageSize: String(pageSize) }),
          },
        },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler o histórico");
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

/**
 * Marca como visto o que o usuário acabou de olhar.
 *
 * O destaque de "ainda não visto" existe para o desbloqueio que chegou por
 * toast enquanto o usuário estava em outra tela. Abrir o Hall é a prova de que
 * ele viu, então é ali que a marcação acontece — e não no toast, que pode
 * passar despercebido.
 *
 * A chamada é idempotente do lado da API: marcar de novo devolve o mesmo
 * `seenAt`. Aqui o `ref` só evita repetir a mesma escrita a cada render.
 */
export function useMarkUnlocksSeen(unlocks: readonly AchievementUnlockRecord[] | undefined): void {
  const queryClient = useQueryClient();
  const marked = useRef(new Set<string>());

  const { mutate } = useMutation({
    mutationFn: async (id: string) => {
      const { data, error, response } = await api.POST("/api/v1/achievements/unlocks/{id}/seen", {
        params: { path: { id } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível marcar como visto");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: achievementKeys.unlocks });
    },
  });

  useEffect(() => {
    if (unlocks === undefined) return;

    for (const unlock of unlocks) {
      if (unlock.seenAt !== null) continue;
      if (marked.current.has(unlock.id)) continue;
      marked.current.add(unlock.id);
      mutate(unlock.id);
    }
  }, [mutate, unlocks]);
}
