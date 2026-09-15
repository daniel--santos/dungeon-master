import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";

import type { MetricSeriesRecord, SeriesMetricRecord } from "@/lib/api-types";
import {
  formatCompact,
  formatDay,
  formatDuration,
  formatSeriesValue,
  seriesColor,
  seriesShape,
} from "@/lib/metrics-domain";

/**
 * O desenho da série por dia (planejamento v0.4, Fase 10B).
 *
 * ## O que este componente promete
 *
 * - **A cor nunca é o único portador de significado.** Cada linha tem um
 *   marcador de forma própria, e o nome dela aparece na legenda e na tabela
 *   equivalente que o painel desenha logo abaixo.
 * - **Uma paleta só**, vinda dos tokens `--accent-*` de `styles.css`, que já
 *   têm valor próprio em claro e escuro: o gráfico acompanha o tema de cor sem
 *   uma segunda tabela de cores.
 * - **Dia sem dado é zero, e é um fato.** A API devolve a série contínua; uma
 *   série que pula dias vazios desenha uma inclinação que não existiu.
 * - **Nenhuma animação.** Não é preferência estética: uma transição de 400 ms
 *   deixa o e2e lendo um SVG a meio caminho, e um teste que espera a animação
 *   passar é um teste que falha sozinho numa máquina lenta.
 *
 * O componente é só o desenho. O texto alternativo, a legenda e a tabela moram
 * no painel, porque são eles que precisam existir mesmo quando o gráfico não
 * renderiza — um leitor de tela nunca vê o SVG.
 */

export interface SeriesChartProps {
  readonly series: MetricSeriesRecord;
  /** As linhas desenhadas, já cortadas no teto e com o rótulo resolvido. */
  readonly lines: readonly { readonly key: string; readonly label: string }[];
  /** O texto que o leitor de tela recebe no lugar do desenho. */
  readonly description: string;
  readonly height?: number;
}

/** Uma linha por dia, com uma coluna por chave de dimensão. */
type ChartRow = Record<string, number | string>;

export function SeriesChart({ series, lines, description, height = 260 }: SeriesChartProps) {
  const rows = useMemo<ChartRow[]>(() => {
    const porDia = new Map<string, ChartRow>();

    // A primeira linha fixa a ordem dos dias: todas têm exatamente os mesmos
    // pontos, na mesma ordem, porque a série é contínua por construção.
    for (const point of series.series[0]?.points ?? []) {
      porDia.set(point.day, { day: point.day });
    }

    for (const line of lines) {
      const origem = series.series.find((candidate) => candidate.key === line.key);
      for (const point of origem?.points ?? []) {
        const row = porDia.get(point.day) ?? { day: point.day };
        row[line.key] = point.value;
        porDia.set(point.day, row);
      }
    }

    return [...porDia.values()];
  }, [series, lines]);

  const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

  return (
    <div
      aria-label={description}
      className="w-full"
      data-series-chart={series.metric}
      role="img"
      style={{ height }}
    >
      <ResponsiveContainer height="100%" width="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            axisLine={{ stroke: "var(--border)" }}
            dataKey="day"
            tick={axisTick}
            tickFormatter={formatDay}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            tick={axisTick}
            tickFormatter={(value: number) => axisValue(series.metric, value)}
            tickLine={false}
            width={56}
          />
          <Tooltip
            content={(props: RechartsTooltipProps) => (
              <SeriesTooltip {...props} currency={series.currency} series={series} />
            )}
            cursor={{ stroke: "var(--border)" }}
          />
          {lines.map((line, index) => (
            <Line
              key={line.key}
              activeDot={{ r: 4 }}
              dataKey={line.key}
              dot={{ r: 2.5 }}
              isAnimationActive={false}
              name={line.label}
              stroke={seriesColor(index)}
              strokeWidth={1.75}
              type="monotone"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * O valor do eixo Y, curto.
 *
 * Duração vira "2 min" em vez de "120000": um eixo em milissegundos obriga a
 * quem lê a dividir de cabeça, e o número inteiro continua no tooltip e na
 * tabela.
 */
function axisValue(metric: SeriesMetricRecord, value: number): string {
  if (metric === "duration") return formatDuration(value) ?? "—";
  return formatCompact(value);
}

/**
 * A forma que o recharts entrega ao `content` do tooltip.
 *
 * Os dois genéricos são os padrões da biblioteca — o valor pode ser número,
 * texto ou lista, e o nome pode ser número ou texto. Estreitá-los aqui para
 * `number` faz o `content` deixar de casar com a prop, porque o parâmetro é
 * contravariante; quem estreita é o corpo do componente, ao formatar.
 */
type RechartsTooltipProps = TooltipContentProps<TooltipValueType, number | string>;

interface SeriesTooltipProps extends RechartsTooltipProps {
  readonly series: MetricSeriesRecord;
  readonly currency: string | null;
}

/**
 * O tooltip, com os valores formatados pelo locale.
 *
 * Próprio, e não o do recharts, porque o padrão escreve o número cru: uma série
 * de custo apareceria como `12.3456` sem moeda, e uma de duração em
 * milissegundos.
 */
function SeriesTooltip({ active, payload, label, series, currency }: SeriesTooltipProps) {
  if (active !== true || payload === undefined || payload.length === 0) return null;

  return (
    <div className="bg-popover border-border flex flex-col gap-1 rounded-lg border px-3 py-2 shadow-md">
      <span className="text-[11px] font-medium">{formatDay(String(label))}</span>
      {payload.map((entry) => (
        <span className="flex items-center gap-2 text-[11.5px]" key={String(entry.dataKey)}>
          <span
            aria-hidden
            className="size-2 flex-none rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto font-medium">
            {formatSeriesValue(
              series.metric,
              typeof entry.value === "number" ? entry.value : 0,
              currency,
            )}
          </span>
        </span>
      ))}
    </div>
  );
}

/** O marcador de forma da linha, a segunda pista visual da legenda. */
export function SeriesMarker({ index }: { index: number }) {
  const color = seriesColor(index);
  const shape = seriesShape(index);

  const common = { fill: color, stroke: color };

  return (
    <svg aria-hidden className="size-2.5 flex-none" viewBox="0 0 10 10">
      {shape === "circle" && <circle cx="5" cy="5" r="4" {...common} />}
      {shape === "square" && <rect height="8" width="8" x="1" y="1" {...common} />}
      {shape === "triangle" && <polygon points="5,1 9,9 1,9" {...common} />}
      {shape === "diamond" && <polygon points="5,0.5 9.5,5 5,9.5 0.5,5" {...common} />}
      {shape === "star" && (
        <polygon
          points="5,0.5 6.3,3.8 9.5,4 7,6.3 7.8,9.5 5,7.7 2.2,9.5 3,6.3 0.5,4 3.7,3.8"
          {...common}
        />
      )}
      {shape === "cross" && (
        <polygon
          points="3.5,0.5 6.5,0.5 6.5,3.5 9.5,3.5 9.5,6.5 6.5,6.5 6.5,9.5 3.5,9.5 3.5,6.5 0.5,6.5 0.5,3.5 3.5,3.5"
          {...common}
        />
      )}
    </svg>
  );
}
