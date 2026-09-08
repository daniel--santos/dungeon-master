import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Trophy } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { AchievementCard } from "@/components/hall/achievement-card";
import { BestiaryTab } from "@/components/hall/bestiary-tab";
import { ChronicleTab } from "@/components/hall/chronicle-tab";
import { HeroesTab } from "@/components/hall/heroes-tab";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ACHIEVEMENT_ORIGINS,
  ACHIEVEMENT_RARITIES,
  ACHIEVEMENT_STATES,
  hallSearchSchema,
  ORIGIN_LABEL,
  RARITY_LABEL,
  STATE_LABEL,
  useHall,
  useMarkUnlocksSeen,
  useUnlocks,
  type AchievementOrigin,
  type AchievementRarity,
  type AchievementState,
  type HallTab,
} from "@/lib/achievements";
import { useGlossary } from "@/lib/glossary";

/** O Radix recusa `value=""`, então "sem filtro" precisa de um valor próprio. */
const ANY = "__any__";

/** Quantos desbloqueios recentes o Hall olha para decidir o destaque de novo. */
const RECENT_UNLOCKS = 50;

export const Route = createFileRoute("/hall")({
  validateSearch: hallSearchSchema,
  component: HallPage,
});

/**
 * O Hall dos Heróis, com dados reais (planejamento v0.4, Fase 2.5D).
 *
 * As quatro abas leem a mesma projeção que o Worker mantém. A grade não deriva
 * estado nenhum: `state`, `tier` e `progress` chegam prontos de
 * `GET /achievements`, e os filtros vão para a consulta em vez de peneirarem o
 * resultado no cliente — o medidor tem de continuar contando o total mesmo com
 * um filtro aberto, e é por isso que `counts` ignora os filtros de propósito.
 *
 * Abrir o Hall marca como visto o que ainda não foi. Um desbloqueio chega por
 * toast na tela em que o usuário estiver, e o toast pode passar despercebido;
 * abrir esta tela é a prova de que ele olhou.
 */
function HallPage() {
  const { t, format } = useGlossary();
  const navigate = useNavigate({ from: "/hall" });
  const search = Route.useSearch();

  const filters = useMemo(
    () => ({ origin: search.origin, rarity: search.rarity, state: search.state }),
    [search.origin, search.rarity, search.state],
  );

  const { query, hall } = useHall(filters);

  // Os desbloqueios recentes servem a dois propósitos: o pontinho de "ainda não
  // vista" na carta, e a marcação de visto ao abrir a tela.
  const unlocks = useUnlocks({ page: 1, pageSize: RECENT_UNLOCKS });
  useMarkUnlocksSeen(unlocks.data?.items);

  // Por `definitionId`, e não por `key`: um template vira uma definição por
  // entidade, e duas Campanhas têm duas cartas com a mesma chave.
  const unseen = useMemo(() => {
    const ids = new Set<string>();
    for (const unlock of unlocks.data?.items ?? []) {
      if (unlock.seenAt === null) ids.add(unlock.definitionId);
    }
    return ids;
  }, [unlocks.data]);

  const { cards, counts } = hall;
  const tab: HallTab = search.tab ?? "achievements";

  return (
    <>
      <PageHeader
        title={t("nav.hall")}
        description={format(
          "O catálogo inteiro fica à vista desde o começo. Nada some, nada é surpresa — salvo o que for {hidden}.",
          { hidden: t("achievement.state.hidden") },
        )}
        actions={
          <div className="flex flex-col items-end gap-2">
            <span className="text-muted-foreground text-[13px]">
              {format(t("hall.counter"), { unlocked: counts.unlocked, total: counts.total })}
            </span>
            <div className="bg-muted h-1.25 w-60 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full"
                style={{
                  width:
                    counts.total === 0
                      ? "0%"
                      : `${String((counts.unlocked / counts.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        }
      />

      <Tabs
        onValueChange={(next) => {
          void navigate({
            search: (previous) => ({ ...previous, tab: next as HallTab }),
            replace: true,
          });
        }}
        value={tab}
      >
        <TabsList>
          <TabsTrigger value="achievements">{t("hall.tab.achievements")}</TabsTrigger>
          <TabsTrigger value="heroes">{t("hall.tab.heroes")}</TabsTrigger>
          <TabsTrigger value="bestiary">{t("hall.tab.bestiary")}</TabsTrigger>
          <TabsTrigger value="chronicle">{t("hall.tab.chronicle")}</TabsTrigger>
        </TabsList>

        <TabsContent className="flex flex-col gap-4" value="achievements">
          <div className="flex flex-wrap items-center gap-2">
            <Filter
              label={t("hall.filter.origin")}
              onChange={(next) => {
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    origin: next as AchievementOrigin | undefined,
                  }),
                  replace: true,
                });
              }}
              options={ACHIEVEMENT_ORIGINS.map((origin) => ({
                value: origin,
                label: t(ORIGIN_LABEL[origin]),
              }))}
              value={search.origin}
            />
            <Filter
              label={t("hall.filter.rarity")}
              onChange={(next) => {
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    rarity: next as AchievementRarity | undefined,
                  }),
                  replace: true,
                });
              }}
              options={ACHIEVEMENT_RARITIES.map((rarity) => ({
                value: rarity,
                label: t(RARITY_LABEL[rarity]),
              }))}
              value={search.rarity}
            />
            <Filter
              label={t("hall.filter.state")}
              onChange={(next) => {
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    state: next as AchievementState | undefined,
                  }),
                  replace: true,
                });
              }}
              options={ACHIEVEMENT_STATES.map((state) => ({
                value: state,
                label: t(STATE_LABEL[state]),
              }))}
              value={search.state}
            />

            <div className="flex-1" />

            <span className="text-muted-foreground self-center text-xs">
              {format("{inProgress} · {locked}", {
                inProgress: `${String(counts.inProgress)} ${t("achievement.state.inProgress").toLowerCase()}`,
                locked: `${String(counts.locked)} ${t("achievement.state.locked").toLowerCase()}`,
              })}
            </span>
          </div>

          {query.isError && <p className="text-destructive text-sm">{query.error.message}</p>}
          {query.isPending && <p className="text-muted-foreground text-sm">Lendo…</p>}

          {!query.isPending && !query.isError && cards.length === 0 && (
            <Panel>
              <EmptyState icon={Trophy} title="Nada com esse filtro">
                {format("Nenhuma {achievement} casa com o que você pediu.", {
                  achievement: t("entity.achievement"),
                })}
              </EmptyState>
            </Panel>
          )}

          {cards.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map((card) => (
                <AchievementCard key={card.id} card={card} unseen={unseen.has(card.id)} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="heroes">
          <HeroesTab />
        </TabsContent>

        <TabsContent value="bestiary">
          <BestiaryTab />
        </TabsContent>

        <TabsContent value="chronicle">
          <ChronicleTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

interface FilterProps {
  readonly label: string;
  readonly value: string | undefined;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string | undefined) => void;
}

function Filter({ label, value, options, onChange }: FilterProps) {
  return (
    <Select
      value={value ?? ANY}
      onValueChange={(next) => {
        onChange(next === ANY ? undefined : next);
      }}
    >
      <SelectTrigger aria-label={label} className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{label}</SelectItem>
        <SelectSeparator />
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
