import type { FormatParams, GlossaryKey } from "@dungeon-master/glossary";

import type { EventFilterId } from "@/lib/execution-domain";
import { eventPresentation } from "@/lib/execution-domain";
import type { RunEvent } from "@/lib/run-events";

/**
 * O log cru vira as linhas do Diário.
 *
 * Duas coisas acontecem aqui, e nenhuma delas apaga informação. A primeira é
 * ler o `payload`, que o contrato declara como `unknown` de propósito: um tipo
 * de evento novo, emitido por um worker mais novo que esta web, precisa
 * aparecer na lista em vez de derrubar a tela. Por isso todo acesso é
 * defensivo e o pior caso é uma linha só com o nome do tipo.
 *
 * A segunda é agrupar `TextDelta` contíguo. O harness emite o texto do agente
 * em pedaços que não são frases; uma linha por pedaço encheria a tela de meia
 * palavra. Um bloco de `TextDelta` com `sequence` consecutiva vira uma linha
 * com o texto emendado e o contador de quantos pedaços entraram — é o mesmo
 * conteúdo, com a densidade que o artboard de componente fixou.
 */

export interface TimelineLabels {
  readonly t: (key: GlossaryKey) => string;
  readonly format: (template: string, params?: FormatParams) => string;
}

export interface TimelineRow {
  /** Estável entre redesenhos: a `sequence` do último evento do grupo. */
  readonly key: string;
  readonly sequence: number;
  readonly type: string;
  /** `hh:mm:ss` no fuso do browser. */
  readonly time: string;
  readonly title: string;
  readonly detail: string | null;
  /** O detalhe é caminho ou comando, e vai em monoespaçada. */
  readonly code: boolean;
  /** Quantos `TextDelta` entraram nesta linha. `1` quando não houve grupo. */
  readonly groupSize: number;
  /** A chamada ainda não recebeu resposta: o marcador pulsa. */
  readonly running: boolean;
  readonly group: EventFilterId;
}

const TIME = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const NUMBER = new Intl.NumberFormat("pt-BR");

function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : TIME.format(at);
}

function fields(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

function text(payload: unknown, key: string): string | null {
  const value = fields(payload)[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function count(payload: unknown, key: string): number | null {
  const value = fields(payload)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Uma linha só, sem espaço duplicado, cortada no que cabe. */
function oneLine(value: string, limit = 220): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

interface Described {
  readonly title: string;
  readonly detail: string | null;
  readonly code: boolean;
}

/** O que cada tipo de evento diz na sua linha. */
function describe(event: RunEvent, labels: TimelineLabels): Described {
  const { t, format } = labels;
  const payload = event.payload;

  switch (event.type) {
    case "RunStarted": {
      const version = text(payload, "harnessVersion");
      const workspace = text(payload, "workspacePath");
      return {
        title: format("{run} iniciada", { run: t("entity.run") }),
        detail: [version, workspace].filter((part) => part !== null).join(" · ") || null,
        code: true,
      };
    }

    case "TextDelta":
      return { title: oneLine(text(payload, "text") ?? ""), detail: null, code: false };

    case "ToolCall":
      return {
        title: text(payload, "name") ?? event.type,
        detail: oneLine(text(payload, "arguments") ?? ""),
        code: true,
      };

    case "ToolResult": {
      const ok = fields(payload)["ok"];
      const output = oneLine(text(payload, "output") ?? "", 120);
      return {
        title: output === "" ? (ok === false ? "sem saída · falhou" : "sem saída") : output,
        detail: null,
        code: false,
      };
    }

    case "Artifact": {
      const bytes = count(payload, "bytes");
      return {
        title: text(payload, "path") ?? event.type,
        detail:
          [text(payload, "kind"), bytes === null ? null : `${NUMBER.format(bytes)} bytes`]
            .filter((part) => part !== null)
            .join(" · ") || null,
        code: false,
      };
    }

    case "Usage": {
      const usage = fields(fields(payload)["usage"]);
      const read = (key: string): number =>
        typeof usage[key] === "number" && Number.isFinite(usage[key]) ? usage[key] : 0;
      return {
        title: format("{in} entrada · {out} saída · {cache} em cache", {
          in: NUMBER.format(read("inputTokens")),
          out: NUMBER.format(read("outputTokens")),
          cache: NUMBER.format(read("cacheReadInputTokens")),
        }),
        detail: null,
        code: false,
      };
    }

    case "Diagnostic":
      return {
        title: oneLine(text(payload, "message") ?? event.type),
        detail: (() => {
          const detail = text(payload, "detail");
          return detail === null ? null : oneLine(detail);
        })(),
        code: false,
      };

    case "ApprovalRequested":
      return {
        title: oneLine(text(payload, "summary") ?? event.type),
        detail: text(payload, "toolName"),
        code: false,
      };

    case "SessionCaptured":
      return {
        title: "Sessão capturada",
        detail: text(payload, "harnessSessionId"),
        code: true,
      };

    case "RunCompleted":
      return {
        title: t("run.status.succeeded"),
        detail: (() => {
          const summary = text(payload, "summary");
          return summary === null ? null : oneLine(summary);
        })(),
        code: false,
      };

    case "RunFailed":
      return {
        title: t("run.status.failed"),
        detail: oneLine(text(fields(payload)["error"], "message") ?? ""),
        code: false,
      };

    case "RunTimedOut": {
      const limit = count(payload, "limitMs");
      const kind = text(payload, "kind");
      return {
        title: t("run.status.timedOut"),
        detail: [
          kind === "IDLE" ? "teto de ociosidade" : "teto de conclusão",
          limit === null ? null : `${NUMBER.format(Math.round(limit / 1000))} s`,
          fields(payload)["processTreeTerminated"] === false
            ? "árvore de processos não confirmada"
            : "árvore de processos confirmada encerrada",
        ]
          .filter((part) => part !== null)
          .join(" · "),
        code: false,
      };
    }

    case "RunCancelled":
      return {
        title: t("run.status.cancelled"),
        detail: [
          fields(payload)["processTreeTerminated"] === false
            ? "árvore de processos não confirmada"
            : "árvore de processos confirmada encerrada",
          text(payload, "terminationMethod"),
        ]
          .filter((part) => part !== null)
          .join(" · "),
        code: false,
      };

    // Um tipo que esta versão da web não conhece aparece pelo nome, e não some.
    default:
      return { title: event.type, detail: null, code: false };
  }
}

/**
 * Emenda um bloco de `TextDelta` numa linha só.
 *
 * O texto vem em pedaços sem garantia de terminar em espaço, então a emenda é
 * literal: o que o agente escreveu é o que aparece, sem separador inventado.
 */
function joinDeltas(events: readonly RunEvent[]): string {
  return oneLine(events.map((event) => text(event.payload, "text") ?? "").join(""));
}

export interface BuildTimelineOptions {
  readonly labels: TimelineLabels;
  /** `all` deixa tudo passar; os outros filtram pelo grupo do tipo. */
  readonly filter?: EventFilterId;
}

/** Quantos eventos cada filtro do rodapé contaria, incluindo `all`. */
export function countByFilter(events: readonly RunEvent[]): Record<EventFilterId, number> {
  const counts: Record<EventFilterId, number> = {
    all: events.length,
    tools: 0,
    text: 0,
    usage: 0,
    system: 0,
    diagnostic: 0,
  };

  for (const event of events) {
    counts[eventPresentation(event.type).group] += 1;
  }

  return counts;
}

export function buildTimeline(
  events: readonly RunEvent[],
  { labels, filter = "all" }: BuildTimelineOptions,
): readonly TimelineRow[] {
  const visible =
    filter === "all"
      ? events
      : events.filter((event) => eventPresentation(event.type).group === filter);

  const rows: TimelineRow[] = [];
  let index = 0;

  while (index < visible.length) {
    const event = visible[index];
    if (event === undefined) break;

    if (event.type === "TextDelta") {
      // O grupo só cresce enquanto a `sequence` for consecutiva: um evento de
      // outro tipo no meio quebra o bloco, mesmo que ele tenha sido filtrado
      // da vista — o que o agente escreveu antes e depois de chamar uma
      // ferramenta são dois pensamentos, não um.
      const block: RunEvent[] = [event];
      let next = index + 1;
      while (next < visible.length) {
        const candidate = visible[next];
        if (candidate === undefined) break;
        if (candidate.type !== "TextDelta") break;
        const previous = block.at(-1);
        if (previous === undefined || candidate.sequence !== previous.sequence + 1) break;
        block.push(candidate);
        next += 1;
      }

      const last = block.at(-1) ?? event;
      rows.push({
        key: String(last.sequence),
        sequence: last.sequence,
        type: "TextDelta",
        time: clock(last.timestamp),
        title: joinDeltas(block),
        detail: null,
        code: false,
        groupSize: block.length,
        running: false,
        group: "text",
      });

      index = next;
      continue;
    }

    const described = describe(event, labels);
    rows.push({
      key: String(event.sequence),
      sequence: event.sequence,
      type: event.type,
      time: clock(event.timestamp),
      title: described.title,
      detail: described.detail,
      code: described.code,
      groupSize: 1,
      running: false,
      group: eventPresentation(event.type).group,
    });

    index += 1;
  }

  return markPendingCall(rows, events);
}

/**
 * A última chamada de ferramenta sem resposta fica pulsando.
 *
 * Só a última: uma resposta que nunca veio no meio do log é história antiga, e
 * pintar todas de "aguardando" transformaria o Diário num alarme.
 */
function markPendingCall(
  rows: readonly TimelineRow[],
  events: readonly RunEvent[],
): readonly TimelineRow[] {
  const lastEvent = events.at(-1);
  if (lastEvent === undefined || lastEvent.type !== "ToolCall") return rows;

  const lastRow = rows.at(-1);
  if (lastRow === undefined || lastRow.sequence !== lastEvent.sequence) return rows;

  return [...rows.slice(0, -1), { ...lastRow, running: true }];
}
