import { Users } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Panel, PanelHeader } from "@/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGlossary } from "@/lib/glossary";
import { levelPercent, useHeroStats, type HeroStatsRecord } from "@/lib/heroes";

/**
 * A aba de Heróis: uma ficha por Agent, e a tabela por Equipamento embaixo.
 *
 * Tudo aqui é cosmético. Experiência e nível não destravam nada — é a regra da
 * seção 12 do CLAUDE.md — e existem porque ver o acumulado de um Agent responde
 * a pergunta prática de qual deles vem entregando.
 *
 * A carta é por Agent e a tabela é por Loadout porque são leituras diferentes
 * do mesmo fato: quem trabalha é o Agent, mas o que muda o resultado é a
 * combinação que ele levou. A projeção grava as duas no mesmo passe.
 *
 * Um nome nulo é uma entidade apagada, e a linha continua: a estatística
 * sobrevive ao registro que a produziu, e escondê-la reescreveria o passado.
 */

const DELETED = "—";

export function HeroesTab() {
  const { t, format } = useGlossary();
  const query = useHeroStats();

  const agents = query.data?.agents ?? [];
  const loadouts = query.data?.loadouts ?? [];

  if (query.isError) {
    return <p className="text-destructive text-sm">{query.error.message}</p>;
  }

  if (query.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (agents.length === 0 && loadouts.length === 0) {
    return (
      <Panel>
        <EmptyState icon={Users} title={t("hall.tab.heroes")}>
          {format("Nenhuma {run} terminada ainda. A ficha aparece assim que a primeira voltar.", {
            run: t("entity.run"),
          })}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {agents.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((stats) => (
            <HeroCard key={stats.scopeId} stats={stats} />
          ))}
        </div>
      )}

      {loadouts.length > 0 && (
        <Panel>
          <PanelHeader
            aside={format("{count} no total", { count: loadouts.length })}
            title={t("hero.byLoadout")}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">{t("entity.loadout")}</TableHead>
                <TableHead className="w-24 px-4 text-right">{t("hero.level")}</TableHead>
                <TableHead className="w-24 px-4 text-right">{t("hero.xp")}</TableHead>
                <TableHead className="w-28 px-4 text-right">{t("hero.expeditions")}</TableHead>
                <TableHead className="w-24 px-4 text-right">{t("hero.victories")}</TableHead>
                <TableHead className="w-24 px-4 text-right">{t("hero.defeats")}</TableHead>
                <TableHead className="w-32 px-4 text-right">{t("hero.monstersSlain")}</TableHead>
                <TableHead className="w-36 px-4">{t("hero.topHarness")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadouts.map((stats) => (
                <TableRow key={stats.scopeId} data-hero-loadout={stats.scopeId}>
                  <TableCell className="px-4">{stats.name ?? DELETED}</TableCell>
                  <TableCell className="px-4 text-right font-mono text-[12.5px]">
                    {stats.level}
                  </TableCell>
                  <TableCell className="px-4 text-right font-mono text-[12.5px]">
                    {stats.xp}
                  </TableCell>
                  <TableCell className="px-4 text-right font-mono text-[12.5px]">
                    {stats.expeditions}
                  </TableCell>
                  <TableCell className="px-4 text-right font-mono text-[12.5px]">
                    {stats.victories}
                  </TableCell>
                  <TableCell className="px-4 text-right font-mono text-[12.5px]">
                    {stats.defeats}
                  </TableCell>
                  <TableCell className="px-4 text-right font-mono text-[12.5px]">
                    {stats.monstersSlain}
                  </TableCell>
                  <TableCell className="text-muted-foreground px-4 text-[12.5px]">
                    {stats.topHarness ?? DELETED}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}

const ACCENT = "oklch(0.72 0.13 75)";

function HeroCard({ stats }: { stats: HeroStatsRecord }) {
  const { t, format } = useGlossary();
  const percent = levelPercent(stats);

  return (
    <article
      className="bg-card border-border flex flex-col gap-3.5 rounded-[14px] border p-4 shadow-sm"
      data-hero-agent={stats.scopeId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-semibold">{stats.name ?? DELETED}</span>
          <span className="text-muted-foreground truncate text-[11.5px]">
            {stats.topHarness === null
              ? t("hero.topHarness")
              : `${t("hero.topHarness")}: ${stats.topHarness}`}
          </span>
        </div>

        <span
          className="flex h-7 flex-none items-center rounded-full px-2.5 text-[11px] font-semibold"
          style={{
            border: `1px solid color-mix(in oklab, ${ACCENT} 45%, transparent)`,
            background: `color-mix(in oklab, ${ACCENT} 12%, transparent)`,
            color: ACCENT,
          }}
        >
          {`${t("hero.level")} ${String(stats.level)}`}
        </span>
      </div>

      <div className="flex flex-col gap-1.25">
        <div className="bg-muted h-1.25 w-full overflow-hidden rounded-full">
          <div
            className="h-full rounded-full"
            style={{ background: ACCENT, width: `${String(percent)}%` }}
          />
        </div>
        <span className="text-muted-foreground text-[11px]">
          {format("{xp} · {toNext}", {
            xp: `${t("hero.xp")} ${String(stats.xp)}`,
            toNext: `${t("hero.toNextLevel")}: ${String(stats.xpToNextLevel)}`,
          })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Stat label={t("hero.expeditions")} value={stats.expeditions} />
        <Stat label={t("hero.victories")} value={stats.victories} />
        <Stat label={t("hero.defeats")} value={stats.defeats} />
        <Stat label={t("hero.monstersSlain")} value={stats.monstersSlain} />
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground truncate text-[11.5px]">{label}</span>
      <span className="flex-none font-mono text-[13px]">{value}</span>
    </span>
  );
}
