import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { SeriesChart, SeriesMarker } from "@/components/metrics/series-chart";
import { Panel, PanelHeader } from "@/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  MetricDimensionRecord,
  MetricSeriesRecord,
  SeriesMetricRecord,
} from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useDimensionLabel } from "@/lib/metrics";
import {
  formatDay,
  formatPercent,
  formatSeriesValue,
  MAX_SERIES_LINES,
  METRIC_DIMENSION,
  METRIC_DIMENSIONS,
  SERIES_METRIC,
  SERIES_METRICS,
} from "@/lib/metrics-domain";
import { ChartNoAxesColumn } from "lucide-react";

/**
 * A série por dia, a quebra da dimensão e a tabela equivalente (Fase 10B).
 *
 * As três coisas moram no mesmo painel porque são a mesma informação em três
 * formas, e a terceira é o que torna a primeira acessível: um leitor de tela
 * nunca vê o SVG, e a tabela de dias é a versão dele que um leitor percorre
 * célula a célula. A quebra por dimensão fica aberta; a tabela de dias fica num
 * `details`, porque noventa linhas abertas por padrão enterrariam o resto da
 * tela.
 *
 * A série desenha no máximo seis linhas — o tamanho da paleta. O que sobra
 * continua na quebra por dimensão, com o total: nada some, só deixa de ter
 * traço próprio no desenho.
 */

export interface SeriesPanelProps {
  readonly series: MetricSeriesRecord;
  readonly metric: SeriesMetricRecord;
  readonly dimension: MetricDimensionRecord;
  readonly onMetricChange: (metric: SeriesMetricRecord) => void;
  readonly onDimensionChange: (dimension: MetricDimensionRecord) => void;
  readonly isPending: boolean;
}

export function SeriesPanel({
  series,
  metric,
  dimension,
  onMetricChange,
  onDimensionChange,
  isPending,
}: SeriesPanelProps) {
  const { t, format } = useGlossary();
  const labelOf = useDimensionLabel();

  const lines = useMemo(
    () =>
      series.series.map((line) => ({
        key: line.key,
        label: labelOf(series.dimension, line.key, line.label),
        total: line.total,
        points: line.points,
      })),
    [series, labelOf],
  );

  const drawn = lines.slice(0, MAX_SERIES_LINES);
  const grandTotal = lines.reduce((sum, line) => sum + line.total, 0);

  const description = format(t("metrics.series.chartLabel"), {
    metric: t(SERIES_METRIC[metric]),
    dimension: t(METRIC_DIMENSION[dimension]),
  });

  return (
    <Panel data-metrics-series={metric}>
      <PanelHeader
        title={t("metrics.series.title")}
        aside={format(t("metrics.range"), { from: series.from, to: series.to })}
      />

      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <Picker
          label={t("metrics.series.metric")}
          onChange={(next) => {
            onMetricChange(next as SeriesMetricRecord);
          }}
          options={SERIES_METRICS.map((value) => ({ value, label: t(SERIES_METRIC[value]) }))}
          testId="metric"
          value={metric}
        />
        <Picker
          label={t("metrics.series.dimension")}
          onChange={(next) => {
            onDimensionChange(next as MetricDimensionRecord);
          }}
          options={METRIC_DIMENSIONS.map((value) => ({ value, label: t(METRIC_DIMENSION[value]) }))}
          testId="dimension"
          value={dimension}
        />
        <div className="flex-1" />
        {/* A moeda da série de custo é uma só: somar moedas exigiria uma taxa de
            câmbio que o sistema não tem. Sem nada precificado ela vem nula, e a
            tela diz isso em vez de desenhar uma linha no zero. */}
        {metric === "cost" && (
          <span
            className="text-muted-foreground text-xs"
            data-series-currency={series.currency ?? ""}
          >
            {series.currency ?? t("metrics.cost.nothingPriced")}
          </span>
        )}
        {isPending && <span className="text-muted-foreground text-xs">Lendo…</span>}
      </div>

      {lines.length === 0 ? (
        <EmptyState icon={ChartNoAxesColumn} title={t("metrics.series.empty")}>
          {t("metrics.empty.description")}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4 px-5 pt-3 pb-5">
          <SeriesChart description={description} lines={drawn} series={series} />

          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {drawn.map((line, index) => (
              <li className="flex items-center gap-1.5 text-[11.5px]" key={line.key}>
                <SeriesMarker index={index} />
                <span>{line.label}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">
              {format(t("metrics.breakdown.title"), {
                dimension: t(METRIC_DIMENSION[dimension]),
              })}
            </span>
            <div className="overflow-x-auto">
              <Table data-metrics-breakdown={dimension}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t(METRIC_DIMENSION[dimension])}</TableHead>
                    <TableHead className="text-right">
                      {`${t("metrics.series.total")} · ${t(SERIES_METRIC[metric])}`}
                    </TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow data-breakdown-key={line.key} key={line.key}>
                      <TableCell className="font-medium">{line.label}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatSeriesValue(metric, line.total, series.currency)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {grandTotal === 0 ? "—" : formatPercent(line.total / grandTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <details className="group" data-metrics-series-table>
            <summary className="text-muted-foreground cursor-pointer text-[12.5px] select-none">
              {t("metrics.series.table")}
            </summary>
            <div className="mt-2 max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("metrics.series.day")}</TableHead>
                    {drawn.map((line) => (
                      <TableHead className="text-right" key={line.key}>
                        {line.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(drawn[0]?.points ?? []).map((point, dayIndex) => (
                    <TableRow key={point.day}>
                      <TableCell>{formatDay(point.day)}</TableCell>
                      {drawn.map((line) => (
                        <TableCell className="text-right tabular-nums" key={line.key}>
                          {formatSeriesValue(
                            metric,
                            line.points[dayIndex]?.value ?? 0,
                            series.currency,
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        </div>
      )}
    </Panel>
  );
}

interface PickerProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly testId: string;
}

function Picker({ label, value, options, onChange, testId }: PickerProps) {
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label} className="w-52" data-metrics-picker={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
