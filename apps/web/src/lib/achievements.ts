import type { components } from "@dungeon-master/api-client";
import type { GlossaryKey } from "@dungeon-master/glossary";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  BookOpen,
  CircleQuestionMark,
  Container,
  Flag,
  FlagOff,
  FolderPlus,
  Hourglass,
  Map,
  Moon,
  RotateCcw,
  ShieldCheck,
  Stamp,
  Swords,
  ThumbsDown,
  Trophy,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import { api } from "@/lib/api";
import { fail } from "@/lib/problem";

/**
 * O catálogo de Conquistas, que na Fase 1 é só leitura.
 *
 * Não há progresso nem desbloqueio: a projeção chega na Fase 2.5. O que existe
 * aqui é o catálogo versionado que a API carrega no boot, e a decisão de
 * mostrá-lo inteiro desde o começo, para o usuário ver o que há para conquistar.
 */

type AchievementCatalog = components["schemas"]["AchievementCatalog"];
type AchievementDefinition = components["schemas"]["AchievementDefinition"];

export type AchievementRarity = AchievementDefinition["rarity"];
export type AchievementOrigin = AchievementDefinition["origin"];

/** Os estados que a carta pode ter. Na Fase 1 só os dois primeiros acontecem. */
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
  "folder-plus": FolderPlus,
  hourglass: Hourglass,
  map: Map,
  moon: Moon,
  "rotate-ccw": RotateCcw,
  "shield-check": ShieldCheck,
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

/** Uma carta da grade do Hall, já normalizada para render. */
export interface AchievementCard {
  readonly key: string;
  readonly origin: AchievementOrigin;
  /** Nula na carta oculta, que não revela a raridade. */
  readonly rarity: AchievementRarity | null;
  readonly state: AchievementState;
  readonly icon: string;
  readonly name: { readonly theme: string; readonly plain: string } | null;
  readonly description: { readonly theme: string; readonly plain: string } | null;
  readonly flavor: string | undefined;
  readonly tierRarities: readonly AchievementRarity[] | undefined;
}

/**
 * A chave da carta que representa as Conquistas geradas a partir da sua jornada.
 *
 * Os templates do catálogo não são Conquistas de ninguém ainda: cada um vira
 * uma carta concreta quando os seus dados a instanciam, na Fase 2.5. Mostrar um
 * card por template fingiria que já existem cinco Conquistas fixas esperando;
 * mostrar uma carta oculta diz a verdade — há mais o que descobrir, e ainda não
 * dá para dizer o quê.
 */
export const TEMPLATE_CARD_KEY = "__templates__";

function toCard(definition: AchievementDefinition): AchievementCard {
  const hidden = definition.hidden;
  return {
    key: definition.key,
    origin: definition.origin,
    rarity: hidden ? null : definition.rarity,
    state: hidden ? "HIDDEN" : "LOCKED",
    icon: definition.icon,
    name: hidden ? null : definition.name,
    description: hidden ? null : definition.description,
    flavor: hidden ? undefined : definition.flavor,
    tierRarities: definition.tierRarities,
  };
}

export interface Hall {
  readonly cards: readonly AchievementCard[];
  /** Definições que contam para o medidor: as que não são ocultas. */
  readonly total: number;
  readonly unlocked: number;
}

export const achievementKeys = { catalog: ["achievements", "catalog"] as const };

function useCatalog(): UseQueryResult<AchievementCatalog> {
  return useQuery({
    queryKey: achievementKeys.catalog,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/achievements/catalog");
      if (data === undefined) fail(error, response.status, "Não foi possível ler o catálogo");
      return data;
    },
    // Catálogo é dado versionado, não estado: relê no reload, não a cada foco.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** O catálogo já no formato da grade, com o medidor de progresso. */
export function useHall(): { query: UseQueryResult<AchievementCatalog>; hall: Hall } {
  const query = useCatalog();
  const catalog = query.data;

  const hall = useMemo<Hall>(() => {
    if (catalog === undefined) return { cards: [], total: 0, unlocked: 0 };

    const cards = catalog.definitions.map(toCard);

    if (catalog.templates.length > 0) {
      cards.push({
        key: TEMPLATE_CARD_KEY,
        origin: "TEMPLATE",
        rarity: null,
        state: "HIDDEN",
        icon: "help-circle",
        name: null,
        description: null,
        flavor: undefined,
        tierRarities: undefined,
      });
    }

    return {
      cards,
      total: catalog.definitions.filter((definition) => !definition.hidden).length,
      unlocked: 0,
    };
  }, [catalog]);

  return { query, hall };
}

/**
 * Os filtros do Hall, como parâmetros de busca tipados da rota.
 *
 * Cada chave tem `.catch()`: uma URL colada à mão nunca derruba a tela, o valor
 * inválido some e a grade abre inteira. Os valores são os enums canônicos, e
 * não os labels, então a URL não muda com o interruptor de tema.
 */
export const hallSearchSchema = z.object({
  origin: z.enum(ACHIEVEMENT_ORIGINS).optional().catch(undefined),
  rarity: z.enum(ACHIEVEMENT_RARITIES).optional().catch(undefined),
  state: z.enum(ACHIEVEMENT_STATES).optional().catch(undefined),
});

export type HallFilters = z.infer<typeof hallSearchSchema>;

export function filterCards(
  cards: readonly AchievementCard[],
  filters: HallFilters,
): readonly AchievementCard[] {
  return cards.filter((card) => {
    if (filters.origin !== undefined && card.origin !== filters.origin) return false;
    // Uma carta oculta não tem raridade, então nenhum filtro de raridade a pega.
    if (filters.rarity !== undefined && card.rarity !== filters.rarity) return false;
    if (filters.state !== undefined && card.state !== filters.state) return false;
    return true;
  });
}
