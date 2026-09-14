import type { BudgetLimitKey } from "@dungeon-master/contracts";
import { CircleHelp } from "lucide-react";

import { CHIP, tint } from "@/components/autonomy/shared";
import type { BudgetLimitsRecord, BudgetRecord } from "@/lib/api-types";
import { useBudgetUsage } from "@/lib/autonomy";
import {
  BUDGET_LIMIT_KEY,
  BUDGET_LIMIT_KEYS,
  formatLimitValue,
  pressureColor,
  usageValue,
} from "@/lib/autonomy-domain";
import { formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

export interface UsageBarsProps {
  readonly limits: BudgetLimitsRecord;
  /** O consumo medido por teto; um teto nulo não tem barra. */
  readonly values: Readonly<Partial<Record<BudgetLimitKey, number>>>;
  readonly exceeded: readonly BudgetLimitKey[];
  /** A maior razão consumo/teto; `1` é no teto. */
  readonly pressure: number;
  /** Falso quando algum Run que rodou terminou sem reportar tokens. */
  readonly tokensKnown: boolean;
  readonly runsWithoutUsage: number;
  readonly [attribute: `data-${string}`]: string | undefined;
}

/**
 * As barras de consumo de um orçamento (Fase 9C): uma por teto definido,
 * com o consumo sobre o limite, a pressão colorida e a incerteza dita.
 *
 * `tokensKnown` falso não é um número menor: é uma soma que o sistema não
 * conhece, e a barra de tokens ganha a marca "consumo incerto" com quantos
 * Runs ficaram sem medida — é o mesmo motivo pelo qual a API não libera
 * sobre ela.
 */
export function UsageBars({
  limits,
  values,
  exceeded,
  pressure,
  tokensKnown,
  runsWithoutUsage,
  ...rest
}: UsageBarsProps) {
  const { t, format } = useGlossary();
  const color = pressureColor(pressure);
  const keys = BUDGET_LIMIT_KEYS.filter((key) => limits[key] !== null);

  return (
    <div className="flex flex-col gap-2" {...rest}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={CHIP}
          data-budget-pressure={pressure.toFixed(2)}
          style={{ borderColor: tint(color, 45), color }}
        >
          <span
            aria-hidden
            className="size-1.5 flex-none rounded-full"
            style={{ backgroundColor: color }}
          />
          <span>
            {format("{label} {percent}%", {
              label: t("budget.usage.pressure"),
              percent: Math.round(pressure * 100),
            })}
          </span>
        </span>
        {exceeded.length > 0 && (
          <span
            className={cn(CHIP, "text-destructive")}
            data-budget-exceeded={exceeded.join(",")}
            style={{ borderColor: tint("var(--destructive)", 45) }}
          >
            {t("budget.usage.exceeded")}
          </span>
        )}
        {!tokensKnown && (
          <span
            className={cn(CHIP, "text-accent-amber")}
            data-budget-tokens-unknown={String(runsWithoutUsage)}
            style={{ borderColor: tint("var(--accent-amber)", 45) }}
            title={format(t("budget.usage.unknown.hint"), { n: runsWithoutUsage })}
          >
            <CircleHelp aria-hidden className="size-3" />
            <span>{t("budget.usage.unknown")}</span>
          </span>
        )}
      </div>

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {keys.map((key) => {
          const limit = limits[key];
          const value = values[key];
          if (limit === null || limit === undefined) return null;
          const ratio = value === undefined ? 0 : Math.min(1, value / limit);
          const over = exceeded.includes(key);
          const barColor = over ? "var(--destructive)" : pressureColor(ratio);
          const uncertain = key === "maxTokens" && !tokensKnown;
          return (
            <li
              key={key}
              className="flex flex-col gap-1"
              data-budget-limit={key}
              data-budget-limit-ratio={ratio.toFixed(2)}
            >
              <div className="flex items-baseline justify-between gap-3 text-[11.5px]">
                <span className={cn("truncate", over && "text-destructive")}>
                  {t(BUDGET_LIMIT_KEY[key])}
                </span>
                <span className="text-muted-foreground flex-none font-mono text-[10.5px]">
                  {format("{current} / {limit}", {
                    current: value === undefined ? "—" : formatLimitValue(key, value),
                    limit: formatLimitValue(key, limit),
                  })}
                  {uncertain && " ?"}
                </span>
              </div>
              <div
                aria-hidden
                className="bg-border h-1.5 w-full overflow-hidden rounded-full"
                style={
                  uncertain
                    ? {
                        backgroundImage:
                          "repeating-linear-gradient(90deg, transparent 0 4px, color-mix(in oklch, var(--muted-foreground) 35%, transparent) 4px 6px)",
                      }
                    : undefined
                }
              >
                <div
                  className="h-full rounded-full transition-[width]"
                  data-budget-bar={key}
                  style={{
                    width: `${String(Math.round(ratio * 100))}%`,
                    backgroundColor: barColor,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * O consumo medido de um orçamento, lido de `GET /budgets/{id}/usage`.
 *
 * Em `PER_RUN` a medida é do último Run terminal do escopo, e a legenda diz
 * isso: o teto por Run é conferido pelo Worker durante a execução (9B).
 */
export function BudgetUsagePanel({ budget }: { budget: BudgetRecord }) {
  const { t, format } = useGlossary();
  const usage = useBudgetUsage(budget.id, budget.enabled);

  if (!budget.enabled) return null;

  if (usage.isPending) {
    return <p className="text-muted-foreground m-0 text-[11.5px]">Medindo…</p>;
  }

  if (usage.isError) {
    return (
      <p className="text-destructive m-0 text-[11.5px]" data-budget-usage-error>
        {usage.error.message}
      </p>
    );
  }

  const data = usage.data;
  return (
    <div className="flex flex-col gap-1.5" data-budget-usage={budget.id}>
      <UsageBars
        exceeded={data.exceeded}
        limits={data.limits}
        pressure={data.pressure}
        runsWithoutUsage={data.runsWithoutUsage}
        tokensKnown={data.tokensKnown}
        values={{
          maxTokens: usageValue(data, "maxTokens"),
          maxRuns: usageValue(data, "maxRuns"),
          maxWallClockMs: usageValue(data, "maxWallClockMs"),
          maxConcurrentRuns: usageValue(data, "maxConcurrentRuns"),
        }}
      />
      <span className="text-muted-foreground text-[10.5px]">
        {data.window === "PER_RUN"
          ? t("budget.usage.perRun")
          : data.windowStart === null || data.windowEnd === null
            ? format("Medido em {when}", { when: formatDateTime(data.computedAt) })
            : format("{label}: {from} → {to} · medido em {when}", {
                label: t("budget.usage.window"),
                from: formatDateTime(data.windowStart),
                to: formatDateTime(data.windowEnd),
                when: formatDateTime(data.computedAt),
              })}
      </span>
    </div>
  );
}
