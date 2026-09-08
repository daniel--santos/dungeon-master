import { useVirtualizer } from "@tanstack/react-virtual";
import { BookOpen, ScrollText, SlidersHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Panel } from "@/components/panel";
import { Switch } from "@/components/ui/switch";
import {
  EVENT_FILTER_IDS,
  EVENT_FILTER_LABEL,
  eventPresentation,
  type EventFilterId,
} from "@/lib/execution-domain";
import { useGlossary } from "@/lib/glossary";
import { KNOWLEDGE_COLOR } from "@/lib/knowledge-domain";
import type { RunEventsState } from "@/lib/run-events";
import { buildTimeline, countByFilter, type TimelineRow } from "@/lib/run-timeline";
import { cn } from "@/lib/utils";

export interface TimelineProps {
  readonly state: RunEventsState;
  readonly filter: EventFilterId;
  readonly onFilterChange: (filter: EventFilterId) => void;
  /** O Run ainda pode receber eventos: o rodapé mostra a conexão. */
  readonly live: boolean;
}

/** A largura da coluna da hora mais o trilho, em pixels do canvas. */
const RAIL_LEFT = 46 + 10 + 11;

/**
 * O Diário da Expedição, virtualizado.
 *
 * Um Run longo passa de mil eventos, e renderizar todos custaria uma tela
 * travada a cada bloco de texto que chega. `useVirtualizer` desenha só o que
 * cabe, e `measureElement` mede cada linha de verdade porque uma linha de texto
 * do agente é mais alta que um resultado de ferramenta.
 *
 * "Seguir ao vivo" nasce ligado e se desliga sozinho quando alguém rola para
 * cima: arrastar o leitor de volta para o fim enquanto ele lê o meio do log é a
 * forma mais rápida de tornar a tela inútil.
 */
export function Timeline({ state, filter, onFilterChange, live }: TimelineProps) {
  const { t, format } = useGlossary();
  const [follow, setFollow] = useState(true);

  const rows = buildTimeline(state.events, { labels: { t, format }, filter });
  const counts = countByFilter(state.events);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  // Rolar para o fim depois que o layout mediu as linhas novas, e não antes:
  // um `scrollToIndex` sobre alturas estimadas para no lugar errado.
  useLayoutEffect(() => {
    if (!follow || rows.length === 0) return;
    virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
  }, [follow, rows.length, virtualizer]);

  // Rolar para cima desliga o seguimento; voltar ao fim o religa.
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;

    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      setFollow(distance < 48);
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
    };
  }, []);

  const items = virtualizer.getVirtualItems();

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-border flex h-11 flex-none items-center justify-between gap-3 border-b px-4">
          <div className="flex items-center gap-2">
            <ScrollText aria-hidden className="text-muted-foreground size-3.75" />
            <span className="text-sm font-medium">{t("run.timeline")}</span>
          </div>

          {live ? (
            <span
              className="flex items-center gap-1.5 text-[11px]"
              style={{ color: "oklch(0.72 0.13 250)" }}
            >
              <span
                aria-hidden
                className="size-1.5 animate-pulse rounded-full"
                style={{ backgroundColor: "oklch(0.72 0.13 250)" }}
              />
              <span>ao vivo</span>
            </span>
          ) : (
            <span className="text-muted-foreground text-[11px]">histórico completo</span>
          )}
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto px-4" ref={scrollRef}>
          <span
            aria-hidden
            className="bg-border absolute top-0 bottom-0 w-px"
            style={{ left: RAIL_LEFT + 16 }}
          />

          {rows.length === 0 && (
            <p className="text-muted-foreground px-1 py-6 text-sm">
              {!state.replayDone
                ? format("Lendo o {timeline}…", { timeline: t("run.timeline") })
                : state.events.length > 0
                  ? "Nenhum evento com esse filtro."
                  : live
                    ? format(
                        "Nenhum evento ainda. A primeira linha aparece quando o {worker} tirar esta {run} da fila.",
                        { worker: t("infra.worker"), run: t("entity.run") },
                      )
                    : "Esta execução não registrou nenhum evento."}
            </p>
          )}

          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;
              return (
                <div
                  key={item.key}
                  className="absolute top-0 left-0 w-full"
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${String(item.start)}px)` }}
                >
                  <TimelineItem row={row} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-border flex h-8.5 flex-none items-center justify-between gap-3 border-t px-4">
          <span className="text-muted-foreground flex items-center gap-1.5 text-[10.5px]">
            <ConnectionDot state={state} />
            <span>{connectionText(state, live)}</span>
          </span>
          <span className="text-muted-foreground text-[10.5px]">
            {format("{n} eventos", { n: state.events.length })}
          </span>
        </div>
      </Panel>

      <Panel className="flex h-10 flex-none items-center gap-2.5 rounded-xl px-3.5">
        <span className="text-muted-foreground flex flex-none items-center gap-1.75 text-xs">
          <SlidersHorizontal aria-hidden className="size-3.5" />
          <span>Eventos</span>
        </span>
        <span aria-hidden className="bg-border h-4.5 w-px" />

        <div className="flex items-center gap-1.5">
          {EVENT_FILTER_IDS.map((id) => {
            const label = EVENT_FILTER_LABEL[id];
            const on = filter === id;
            return (
              <button
                key={id}
                className={cn(
                  "flex h-7 items-center gap-1.75 rounded-lg border px-2.5 text-[12.5px] whitespace-nowrap",
                  on ? "border-input bg-white/[0.08]" : "text-muted-foreground border-transparent",
                )}
                data-event-filter={id}
                onClick={() => {
                  onFilterChange(id);
                }}
                type="button"
              >
                <span>{"key" in label ? t(label.key) : label.text}</span>
                <span className="text-muted-foreground font-mono text-[10.5px]">{counts[id]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {live && (
          <label className="flex flex-none cursor-pointer items-center gap-2 text-[12.5px] whitespace-nowrap">
            <Switch
              aria-label="Seguir ao vivo"
              checked={follow}
              onCheckedChange={(checked) => {
                setFollow(checked);
                if (checked && rows.length > 0) {
                  virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
                }
              }}
            />
            <span className={follow ? undefined : "text-muted-foreground"}>Seguir ao vivo</span>
          </label>
        )}
      </Panel>
    </div>
  );
}

function ConnectionDot({ state }: { state: RunEventsState }) {
  const color =
    state.status === "open"
      ? "oklch(0.72 0.13 150)"
      : state.status === "reconnecting"
        ? "oklch(0.72 0.13 75)"
        : "var(--muted-foreground)";

  return (
    <span
      aria-hidden
      className={cn("size-1.25 rounded-full", state.status !== "closed" && "animate-pulse")}
      style={{ backgroundColor: color }}
    />
  );
}

function connectionText(state: RunEventsState, live: boolean): string {
  if (state.error !== null) return state.error;
  if (!live) return "conexão encerrada";
  if (state.status === "replaying") return "lendo o histórico";
  if (state.status === "reconnecting") return "reconectando pelo cursor";
  if (state.status === "closed") return "conexão encerrada";
  return "conectado";
}

/**
 * Uma linha do Diário.
 *
 * A hora fica numa coluna própria em monoespaçada, para as horas alinharem; o
 * marcador é um círculo na cor do tipo; e o detalhe, quando é caminho ou
 * comando, vem em monoespaçada porque é texto para copiar, não para ler.
 */
function TimelineItem({ row }: { row: TimelineRow }) {
  const { t, format } = useGlossary();
  const presentation = eventPresentation(row.type);
  const { icon: Icon, dim } = presentation;
  // Uma consulta ao Grimório (Fase 7C) leva a cor do Grimório no marcador e
  // um fundo próprio: é a única linha do Diário em que o agente foi buscar o
  // que a Campanha já sabia, e ela precisa ser achada num log de mil linhas.
  const color = row.knowledge ? KNOWLEDGE_COLOR : presentation.color;
  const small = dim;

  return (
    <div
      className={cn(
        "relative flex items-start gap-2.5 py-1.5",
        row.knowledge && "-mx-2 rounded-lg px-2",
      )}
      data-event-type={row.type}
      data-knowledge-tool={row.knowledge ? "" : undefined}
      style={
        row.knowledge
          ? { backgroundColor: `color-mix(in oklch, ${KNOWLEDGE_COLOR} 8%, transparent)` }
          : undefined
      }
    >
      <span className="text-muted-foreground w-11.5 flex-none pt-1 text-right font-mono text-[10.5px]">
        {row.time}
      </span>

      <span className="flex w-5.5 flex-none justify-center">
        <span
          className={cn(
            "flex flex-none items-center justify-center rounded-full border",
            small ? "size-4.5" : "size-5.5",
            row.running && "animate-pulse",
          )}
          style={{
            borderColor: `color-mix(in oklch, ${color} ${row.running ? "70%" : "38%"}, transparent)`,
            backgroundColor: "var(--card)",
            color,
          }}
        >
          <Icon aria-hidden className={small ? "size-2.5" : "size-3"} strokeWidth={2} />
        </span>
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "min-w-0 text-[13px] leading-4.5",
              dim ? "text-muted-foreground" : undefined,
              row.type === "TextDelta" ? "line-clamp-2" : "truncate",
              row.type === "ToolCall" && "font-medium",
            )}
          >
            {row.title}
          </span>

          {row.knowledge && (
            <span
              className="flex h-4 flex-none items-center gap-1 rounded-full border px-1.5 text-[10px]"
              data-knowledge-tool-badge
              style={{
                borderColor: `color-mix(in oklch, ${KNOWLEDGE_COLOR} 45%, transparent)`,
                color: KNOWLEDGE_COLOR,
              }}
            >
              <BookOpen aria-hidden className="size-2.5" />
              <span>{t("context.toolCall.badge")}</span>
            </span>
          )}

          {row.groupSize > 1 && (
            <span className="border-border text-muted-foreground flex h-4 flex-none items-center rounded-full border px-1.5 text-[10px]">
              {format("{n} blocos", { n: row.groupSize })}
            </span>
          )}

          <span className="flex-1" />

          <span className="text-muted-foreground flex-none pt-0.75 font-mono text-[10px] tracking-[0.02em]">
            {row.type}
          </span>
        </div>

        {row.detail !== null && row.detail !== "" && (
          <span
            className={cn(
              "text-muted-foreground truncate",
              row.code ? "font-mono text-[11px]" : "text-[11.5px] leading-4.25",
            )}
          >
            {row.detail}
          </span>
        )}
      </div>
    </div>
  );
}
