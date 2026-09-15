/**
 * Datas na interface.
 *
 * Tudo que vem da API é ISO 8601 em UTC; aqui vira o texto que o usuário lê,
 * sempre no fuso do browser. As duas formas convivem de propósito: a lista usa
 * a distância ("há 2 h") porque o que importa é o quão recente é, e o detalhe
 * usa a data completa porque ali o instante exato é o dado.
 */

const RELATIVE = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto", style: "narrow" });

const DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A distância até agora, arredondada para a maior unidade que ainda faz sentido.
 *
 * `numeric: "auto"` é o que produz "ontem" em vez de "há 1 dia"; abaixo de um
 * minuto o texto é fixo, porque "há 0 minutos" não diz nada.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "—";

  const elapsed = now - at;
  const ago = Math.max(elapsed, 0);

  if (ago < MINUTE) return "agora mesmo";
  if (ago < HOUR) return RELATIVE.format(-Math.floor(ago / MINUTE), "minute");
  if (ago < DAY) return RELATIVE.format(-Math.floor(ago / HOUR), "hour");
  if (ago < 30 * DAY) return RELATIVE.format(-Math.floor(ago / DAY), "day");
  if (ago < 365 * DAY) return RELATIVE.format(-Math.floor(ago / (30 * DAY)), "month");
  return RELATIVE.format(-Math.floor(ago / (365 * DAY)), "year");
}

/** A data, sem hora, no fuso do browser. */
export function formatDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : DATE.format(at);
}

/** A data com hora e minuto, no fuso do browser. */
export function formatDateTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : DATE_TIME.format(at);
}

const UTC_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const UTC_DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/**
 * A data em **UTC**, para o que é datado em UTC no domínio.
 *
 * As vigências de preço e os dias do rollup de métricas são UTC por
 * construção: o custo de um Run usa a vigência da data dele, e o `day` de
 * `metric_daily` é um dia civil UTC. Mostrar essas datas no fuso do browser
 * fazia uma vigência aberta em 1º de setembro aparecer como 31 de agosto para
 * quem está em São Paulo — a mesma linha, com dois dias diferentes conforme
 * quem olha.
 */
export function formatUtcDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : UTC_DATE.format(at);
}

/** A data com hora e minuto, em UTC. Acompanha `formatUtcDate`. */
export function formatUtcDateTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : `${UTC_DATE_TIME.format(at)} UTC`;
}
