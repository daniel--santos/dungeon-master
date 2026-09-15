import { Activity, Boxes, Clock, Coins, Cpu, ShieldCheck, Wrench } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { MoneyValue } from "@/components/metrics/money-value";
import { Panel } from "@/components/panel";
import type { RunMetricsRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { formatCount, formatDuration } from "@/lib/metrics-domain";
import { useRunMetrics } from "@/lib/metrics";

/**
 * A aba de medidas do cockpit (planejamento v0.4, Fase 10B).
 *
 * Só existe depois de o Run terminar **e** o projetor passar: `run_metric` só
 * tem Expedição acabada. Antes disso a API responde `404`, e isso não é falha
 * de tela — é "ainda não medido", e a aba diz isso em vez de mostrar a
 * mensagem de erro de uma requisição que fez exatamente o que devia.
 *
 * ## O que o contexto contra o prompt responde
 *
 * "Valeu a pena montar as provisões?" O bloco põe lado a lado os tokens
 * estimados do contexto e os tokens de entrada que a Guilda reportou. Quando o
 * segundo é nulo — harness que não reporta `Usage` — a comparação some, em vez
 * de virar uma razão com zero embaixo.
 */

export interface RunMetricsPanelProps {
  readonly runId: string;
}

export function RunMetricsPanel({ runId }: RunMetricsPanelProps) {
  const { t } = useGlossary();
  const metrics = useRunMetrics(runId);

  if (metrics.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (metrics.isError) {
    return <p className="text-destructive text-sm">{metrics.error.message}</p>;
  }

  if (metrics.data === null) {
    return (
      <Panel>
        <EmptyState icon={Activity} title={t("run.metrics.empty")}>
          {t("metrics.empty.description")}
        </EmptyState>
      </Panel>
    );
  }

  return <Breakdown metrics={metrics.data} />;
}

function Breakdown({ metrics }: { metrics: RunMetricsRecord }) {
  const { t, format } = useGlossary();
  const { tokens, context, toolCalls, gates } = metrics;

  return (
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"
      data-run-metrics={metrics.runId}
    >
      <Block icon={Cpu} title={t("run.metrics.tokens")}>
        {tokens.known ? (
          <>
            <Row label={t("metrics.tokens.input")} value={count(tokens.input)} />
            <Row label={t("metrics.tokens.output")} value={count(tokens.output)} />
            <Row label={t("metrics.tokens.cacheRead")} value={count(tokens.cacheRead)} />
            <Row label={t("metrics.tokens.cacheWrite")} value={count(tokens.cacheWrite)} />
            <Row label={t("metrics.series.total")} strong value={count(tokens.total)} />
          </>
        ) : (
          // Falso não é zero: a Guilda não reportou `Usage`, e inventar quatro
          // zeros aqui faria esta Expedição parecer gratuita.
          <Note data-run-tokens-unknown>{t("metrics.tokens.unknown")}</Note>
        )}
      </Block>

      <Block icon={Boxes} title={t("run.metrics.context")}>
        {context.estimatedTokens === null ? (
          <Note>{t("run.metrics.context.none")}</Note>
        ) : (
          <>
            <Row
              label={t("run.metrics.context.estimated")}
              value={count(context.estimatedTokens)}
            />
            <Row label={t("run.metrics.context.items")} value={count(context.items)} />
            <Row label={t("run.metrics.context.sections")} value={count(context.sections)} />
            <Row label={t("run.metrics.context.truncations")} value={count(context.truncations)} />
            {tokens.input !== null && (
              <Row
                label={t("metrics.tokens.input")}
                strong
                value={format("{context} / {input}", {
                  context: formatCount(context.estimatedTokens),
                  input: formatCount(tokens.input),
                })}
              />
            )}
          </>
        )}
      </Block>

      <Block icon={Wrench} title={t("run.metrics.tools")}>
        {toolCalls.byServer.length === 0 ? (
          <Note>{t("run.metrics.tools.empty")}</Note>
        ) : (
          <>
            {toolCalls.byServer.map((entry) => (
              <Row
                key={entry.server}
                label={entry.server === "native" ? t("run.metrics.tools.native") : entry.server}
                value={count(entry.calls)}
              />
            ))}
            <Row label={t("metrics.series.total")} strong value={count(toolCalls.total)} />
          </>
        )}
      </Block>

      <Block icon={Activity} title={t("run.metrics.steps")}>
        {metrics.steps.length === 0 ? (
          <Note>{t("run.metrics.steps.empty")}</Note>
        ) : (
          metrics.steps.map((step) => (
            <Row key={step.type} label={step.type} value={count(step.count)} />
          ))
        )}
      </Block>

      <Block icon={ShieldCheck} title={t("run.metrics.gates")}>
        <Row label={t("run.metrics.gates.user")} value={count(gates.grantedByUser)} />
        <Row label={t("run.metrics.gates.policy")} value={count(gates.grantedByPolicy)} />
        <Row label={t("run.metrics.children")} value={count(metrics.childrenDelegated)} />
      </Block>

      <Block icon={Clock} title={t("run.metrics.timing")}>
        <Row label={t("run.metrics.timing.duration")} value={formatDuration(metrics.durationMs)} />
        <Row label={t("run.metrics.timing.queue")} value={formatDuration(metrics.queueMs)} />
        <div className="border-border mt-1 flex flex-col gap-1.5 border-t pt-2.5">
          <span className="text-muted-foreground flex items-center gap-1.75 text-[11px] tracking-[0.08em] uppercase">
            <Coins aria-hidden className="size-3.25" />
            <span>{t("run.metrics.cost")}</span>
          </span>
          <MoneyValue money={metrics.cost} />
        </div>
      </Block>
    </div>
  );
}

/** Um número que pode faltar. Ausência é travessão, e não zero. */
function count(value: number | null): string | null {
  return value === null ? null : formatCount(value);
}

function Block({
  icon: Icon,
  title,
  children,
}: {
  readonly icon: typeof Activity;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <Panel className="flex flex-col gap-2 px-4.5 pt-3.5 pb-4">
      <span className="text-muted-foreground flex items-center gap-1.75 text-[11px] tracking-[0.08em] uppercase">
        <Icon aria-hidden className="size-3.25" />
        <span>{title}</span>
      </span>
      <div className="flex flex-col gap-1">{children}</div>
    </Panel>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly strong?: boolean;
}) {
  return (
    <span className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value ?? "—"}</span>
    </span>
  );
}

function Note({ children, ...rest }: ComponentProps<"span">) {
  return (
    <span className="text-muted-foreground text-[12.5px]" {...rest}>
      {children}
    </span>
  );
}
