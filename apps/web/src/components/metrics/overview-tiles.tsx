import {
  CircleSlash,
  Clock,
  Coins,
  Cpu,
  Gauge,
  Percent,
  Play,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { MoneyList } from "@/components/metrics/money-value";
import { Panel } from "@/components/panel";
import type { MetricsOverviewRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { formatCompact, formatCount, formatDuration, formatPercent } from "@/lib/metrics-domain";
import { cn } from "@/lib/utils";

/**
 * Os tiles da janela (planejamento v0.4, Fase 10B).
 *
 * Cada tile mostra o número **e** o denominador dele. É a regra que a Fase 10A
 * fixou no contrato e que a tela precisa sustentar: uma soma de tokens sem
 * "quantas Expedições reportaram" é um número que parece completo e não é, e
 * um custo sem procedência é um palpite passando por fatura.
 *
 * Nenhum tile deriva estado: `successRate` nulo é "não houve Run", não zero, e
 * chega assim do servidor.
 */

export interface OverviewTilesProps {
  readonly overview: MetricsOverviewRecord;
  /** Quantos disjuntores existem ligados, para o tile dizer "x de y". */
  readonly totalBreakers?: number;
}

export function OverviewTiles({ overview, totalBreakers }: OverviewTilesProps) {
  const { t, format } = useGlossary();
  const { runs, tokens, duration, workers } = overview;

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      data-metrics-tiles={overview.window}
    >
      <Tile icon={Play} title={t("metrics.tile.runs")}>
        <Big data-metrics-runs={runs.total}>{formatCount(runs.total)}</Big>
        <Legend>
          {runs.total === 0 ? (
            <span>{t("metrics.runs.none")}</span>
          ) : (
            <>
              <Pair label={t("metrics.runs.succeeded")} value={formatCount(runs.succeeded)} />
              <Pair label={t("metrics.runs.failed")} value={formatCount(runs.failed)} />
              <Pair label={t("metrics.runs.timedOut")} value={formatCount(runs.timedOut)} />
              <Pair label={t("metrics.runs.cancelled")} value={formatCount(runs.cancelled)} />
            </>
          )}
        </Legend>
      </Tile>

      <Tile icon={Percent} title={t("metrics.tile.successRate")}>
        <Big data-metrics-success-rate={runs.successRate ?? ""}>
          {runs.successRate === null ? "—" : formatPercent(runs.successRate)}
        </Big>
        <Legend>
          {runs.successRate === null ? (
            <span>{t("metrics.runs.none")}</span>
          ) : (
            <Pair
              label={t("metrics.runs.succeeded")}
              value={format("{done} / {total}", { done: runs.succeeded, total: runs.total })}
            />
          )}
        </Legend>
      </Tile>

      <Tile icon={Cpu} title={t("metrics.tile.tokens")}>
        <Big data-metrics-tokens={tokens.total}>{formatCompact(tokens.total)}</Big>
        <Legend>
          <span data-metrics-tokens-measured={tokens.knownRuns}>
            {format(t("metrics.tokens.measured"), {
              known: tokens.knownRuns,
              total: tokens.knownRuns + tokens.unknownRuns,
            })}
          </span>
          <Pair label={t("metrics.tokens.input")} value={formatCompact(tokens.input)} />
          <Pair label={t("metrics.tokens.output")} value={formatCompact(tokens.output)} />
          <Pair label={t("metrics.tokens.cacheRead")} value={formatCompact(tokens.cacheRead)} />
          <Pair label={t("metrics.tokens.cacheWrite")} value={formatCompact(tokens.cacheWrite)} />
        </Legend>
      </Tile>

      <Tile icon={Coins} title={t("metrics.tile.cost")}>
        <MoneyList costs={overview.costs} notMeasuredRuns={overview.notMeasuredRuns} size="lg" />
      </Tile>

      <Tile icon={Clock} title={t("metrics.tile.duration")}>
        <Big data-metrics-duration={duration.averageMs ?? ""}>
          {formatDuration(duration.averageMs) ?? "—"}
        </Big>
        <Legend>
          <Pair label={t("metrics.duration.average")} value={formatDuration(duration.averageMs)} />
          <Pair label={t("metrics.duration.p95")} value={formatDuration(duration.p95Ms)} />
          <Pair label={t("metrics.duration.max")} value={formatDuration(duration.maxMs)} />
          <span>{format(t("metrics.duration.measured"), { n: duration.measuredRuns })}</span>
        </Legend>
      </Tile>

      <Tile icon={CircleSlash} title={t("metrics.tile.breakers")}>
        <Big data-metrics-breakers={overview.openCircuitBreakers}>
          {formatCount(overview.openCircuitBreakers)}
        </Big>
        {totalBreakers !== undefined && (
          <Legend>
            <span>{format(t("metrics.breakers.open"), { total: totalBreakers })}</span>
          </Legend>
        )}
      </Tile>

      <Tile icon={Gauge} title={t("metrics.tile.workers")}>
        <Big data-metrics-workers-online={workers.online}>{formatCount(workers.online)}</Big>
        <Legend>
          <Pair label={t("metrics.workers.online")} value={formatCount(workers.online)} />
          <Pair label={t("metrics.workers.stale")} value={formatCount(workers.stale)} />
          <Pair label={t("metrics.workers.offline")} value={formatCount(workers.offline)} />
        </Legend>
      </Tile>
    </div>
  );
}

interface TileProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly children: ReactNode;
}

function Tile({ icon: Icon, title, children }: TileProps) {
  return (
    <Panel className="flex flex-col gap-2.5 px-4.5 pt-3.5 pb-4">
      <span className="text-muted-foreground flex items-center gap-1.75 text-[11px] tracking-[0.08em] uppercase">
        <Icon aria-hidden className="size-3.25" />
        <span>{title}</span>
      </span>
      {children}
    </Panel>
  );
}

function Big({ children, className, ...rest }: ComponentProps<"span">) {
  return (
    <span className={cn("text-[26px] leading-8 font-semibold", className)} {...rest}>
      {children}
    </span>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex flex-col gap-0.5 text-[11.5px] leading-4">
      {children}
    </div>
  );
}

/** Um par rótulo/valor. Um valor nulo é ausência de medida: vira travessão. */
function Pair({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="text-foreground/80 font-medium">{value ?? "—"}</span>
    </span>
  );
}
