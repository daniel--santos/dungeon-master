import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BookOpen, BugIcon, Trophy, Users } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { AchievementCard } from "@/components/hall/achievement-card";
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
  filterCards,
  hallSearchSchema,
  ORIGIN_LABEL,
  RARITY_LABEL,
  STATE_LABEL,
  useHall,
  type AchievementOrigin,
  type AchievementRarity,
  type AchievementState,
} from "@/lib/achievements";
import { useGlossary } from "@/lib/glossary";

/** O Radix recusa `value=""`, então "sem filtro" precisa de um valor próprio. */
const ANY = "__any__";

export const Route = createFileRoute("/hall")({
  validateSearch: hallSearchSchema,
  component: HallPage,
});

/**
 * O Hall em modo catálogo.
 *
 * Na Fase 1 não há projeção de progresso: o catálogo inteiro aparece bloqueado,
 * e o medidor diz zero porque é zero. Mostrar tudo desde o começo é a decisão
 * do planejamento — o usuário vê o que há para conquistar antes de existir
 * execução para conquistar qualquer coisa.
 */
function HallPage() {
  const { t, format } = useGlossary();
  const navigate = useNavigate({ from: "/hall" });
  const search = Route.useSearch();
  const { query, hall } = useHall();

  const cards = useMemo(() => filterCards(hall.cards, search), [hall.cards, search]);

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
              <span className="text-foreground font-medium">
                {format("{unlocked} de {total}", { unlocked: hall.unlocked, total: hall.total })}
              </span>{" "}
              desbloqueadas
            </span>
            <div className="bg-muted h-1.25 w-60 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full"
                style={{
                  width: hall.total === 0 ? "0%" : `${String((hall.unlocked / hall.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        }
      />

      <Tabs defaultValue="achievements">
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
              Modo catálogo · o progresso começa a contar na Fase 2
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
                <AchievementCard key={card.key} card={card} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="heroes">
          <Panel>
            <EmptyState icon={Users} title={t("hall.tab.heroes")}>
              {format(
                "O cadastro de {agents} chega na Fase 2A e a ficha com experiência, vitórias e derrotas na Fase 2.5.",
                { agents: t("entity.agent.plural") },
              )}
            </EmptyState>
          </Panel>
        </TabsContent>

        <TabsContent value="bestiary">
          <Panel>
            <EmptyState icon={BugIcon} title={t("hall.tab.bestiary")}>
              {format(
                "Aqui vai aparecer tudo do tipo {bug} que você resolveu, com destaque para o que voltou e foi vencido de vez. Chega na Fase 2.5, quando houver execução para vencer.",
                { bug: t("entity.task.kind.bug") },
              )}
            </EmptyState>
          </Panel>
        </TabsContent>

        <TabsContent value="chronicle">
          <Panel>
            <EmptyState icon={BookOpen} title={t("hall.tab.chronicle")}>
              {format(
                "A linha do tempo dos desbloqueios chega na Fase 2.5, junto com a projeção que os calcula.",
                {},
              )}
            </EmptyState>
          </Panel>
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
