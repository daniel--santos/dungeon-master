// Os três estados do Cristal de Visão (Run Cockpit): em andamento, Vitória e
// Exaustão. As três telas compartilham o mesmo esqueleto de três colunas da
// seção 37, para que a leitura não mude quando a Expedição termina.

import {
  A_AMBER,
  A_BLUE,
  A_GREEN,
  A_NEUTRAL,
  A_VIOLET,
  BORDER,
  CAMPANHA,
  CARD,
  DESTR,
  FG,
  INPUT,
  KINDS,
  MFG,
  MISSAO,
  MONO,
  RUN_STATUS,
  SERIF,
  breadcrumb,
  btn,
  card,
  chip,
  col,
  dotChip,
  envBadge,
  icon,
  mono,
  row,
  screen,
  tint,
  write,
} from "./kit.mjs";

/* ------------------------------------------------------------ tipos de evento */
// A cor e o ícone de cada tipo da seção 12. Um só mapa serve o cockpit e o
// artboard de componente, para os dois não divergirem.
export const EV = {
  RunStarted: { icon: "flag", color: A_BLUE, size: 22 },
  ContextLoaded: { icon: "book-open", color: A_NEUTRAL, size: 22 },
  ToolCall: { icon: "terminal", color: A_VIOLET, size: 22 },
  ToolResult: { icon: "corner-down-left", color: A_NEUTRAL, size: 18 },
  TextDelta: { icon: "quote", color: FG, size: 22 },
  Usage: { icon: "gauge", color: A_NEUTRAL, size: 18 },
  Diagnostic: { icon: "triangle-alert", color: A_AMBER, size: 22 },
  RunCompleted: { icon: "circle-check-big", color: A_GREEN, size: 22 },
  RunFailed: { icon: "circle-x", color: DESTR, size: 22 },
};

const RAIL_X = 46 + 10 + 11; // gutter da hora + gap + metade do trilho

function typeTag(type) {
  return (
    '<span style="font-family: ' +
    MONO +
    "; font-size: 10px; letter-spacing: 0.02em; color: " +
    MFG +
    '; flex: none">' +
    type +
    "</span>"
  );
}

/**
 * Um item do Diário da Expedição.
 *
 * o.detail  — segunda linha, sempre em cinza
 * o.code    — a segunda linha é caminho ou comando, em monoespaçada
 * o.running — o item ainda não recebeu resposta: trilho pulsando
 * o.group   — quantos TextDelta foram agrupados nesta linha
 * o.live    — a hora é relativa ("agora") em vez de absoluta
 */
export function timelineItem(time, type, title, o = {}) {
  const e = EV[type];
  const s = e.size;
  const dim = type === "ToolResult" || type === "Usage";

  const circle =
    '<span style="' +
    row(
      "justify-content: center; width: " +
        s +
        "px; height: " +
        s +
        "px; flex: none; border-radius: 999px; border: 1px solid " +
        tint(e.color, o.running ? "70%" : "38%") +
        "; background: " +
        CARD +
        "; color: " +
        e.color +
        ";" +
        (o.running ? " animation: dcpulse 1.6s ease-in-out infinite;" : ""),
    ) +
    '">' +
    icon(e.icon, s === 22 ? 12 : 10, "", 2) +
    "</span>";

  // O texto do Herói quebra em duas linhas; nome de Item e rótulo de sistema
  // continuam em uma linha só, com reticências.
  const quebra = type === "TextDelta";

  const head =
    '<div style="' +
    row("gap: 8px; min-width: 0; align-items: flex-start") +
    '">' +
    '<span style="font-size: 13px; line-height: 18px; color: ' +
    (dim ? MFG : FG) +
    "; overflow: hidden; " +
    (quebra
      ? "display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;"
      : "text-overflow: ellipsis; white-space: nowrap;") +
    (o.tool ? " font-weight: 500;" : "") +
    '">' +
    title +
    "</span>" +
    (o.group
      ? '<span style="' +
        row(
          "gap: 4px; height: 16px; padding: 0 6px; flex: none; border-radius: 999px; border: 1px solid " +
            BORDER +
            "; font-size: 10px; color: " +
            MFG +
            ";",
        ) +
        '">' +
        o.group +
        " blocos</span>"
      : "") +
    '<span style="flex: 1"></span>' +
    '<span style="padding-top: 3px">' +
    typeTag(type) +
    "</span></div>";

  const detail = o.detail
    ? '<span style="font-size: 11.5px; line-height: 17px; color: ' +
      MFG +
      (o.code ? "; font-family: " + MONO + "; font-size: 11px" : "") +
      '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
      o.detail +
      "</span>"
    : "";

  return (
    '<div style="' +
    row("gap: 10px; align-items: flex-start; padding: 6px 0; position: relative") +
    '">' +
    '<span style="width: 46px; flex: none; text-align: right; font-family: ' +
    MONO +
    "; font-size: 10.5px; color: " +
    MFG +
    "; padding-top: " +
    (s === 22 ? 4 : 6) +
    'px">' +
    time +
    "</span>" +
    '<span style="' +
    row("justify-content: center; width: 22px; flex: none") +
    '">' +
    circle +
    "</span>" +
    '<div style="' +
    col("gap: 2px; flex: 1; min-width: 0; padding-top: 1px") +
    '">' +
    head +
    detail +
    "</div></div>"
  );
}

export function timeline(items, o = {}) {
  const list =
    '<div style="' +
    col(
      "gap: 0; position: relative; justify-content: flex-end; min-height: 0; flex: 1; overflow: hidden; padding: 0 16px",
    ) +
    '">' +
    '<span style="position: absolute; left: ' +
    (RAIL_X + 16) +
    "px; top: 0; bottom: 0; width: 1px; background: " +
    BORDER +
    '"></span>' +
    items.join("") +
    '<span style="position: absolute; left: 0; right: 0; top: 0; height: 40px; background: linear-gradient(180deg, ' +
    CARD +
    " 42%, " +
    tint(CARD, "0%") +
    ')"></span>' +
    (o.older
      ? '<span style="position: absolute; left: 16px; top: 4px; font-size: 10.5px; color: ' +
        MFG +
        '">' +
        o.older +
        "</span>"
      : "") +
    "</div>";

  const header =
    '<div style="' +
    row(
      "justify-content: space-between; gap: 12px; flex: none; height: 44px; padding: 0 16px; border-bottom: 1px solid " +
        BORDER +
        ";",
    ) +
    '">' +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex">' +
    icon("scroll-text", 15) +
    "</span>" +
    '<span style="font-size: 14px; font-weight: 500">Diário da Expedição</span>' +
    "</div>" +
    (o.live
      ? '<span style="' +
        row("gap: 6px; font-size: 11px; color: " + A_BLUE) +
        '"><span style="width: 6px; height: 6px; border-radius: 999px; background: ' +
        A_BLUE +
        '; animation: dcpulse 1.6s ease-in-out infinite"></span>ao vivo</span>'
      : '<span style="font-size: 11px; color: ' + MFG + '">' + (o.headRight || "") + "</span>") +
    "</div>";

  const foot =
    '<div style="' +
    row(
      "justify-content: space-between; gap: 12px; flex: none; height: 34px; padding: 0 16px; border-top: 1px solid " +
        BORDER +
        ";",
    ) +
    '">' +
    (o.live
      ? '<span style="' +
        row("gap: 6px; font-size: 10.5px; color: " + MFG) +
        '"><span style="width: 5px; height: 5px; border-radius: 999px; background: ' +
        A_GREEN +
        '; animation: dcpulse 2.4s ease-in-out infinite"></span>conectado · último evento há 2 s</span>' +
        '<span style="font-size: 10.5px; color: ' +
        MFG +
        '">47 eventos</span>'
      : '<span style="font-size: 10.5px; color: ' +
        MFG +
        '">' +
        (o.footLeft || "") +
        '</span><span style="font-size: 10.5px; color: ' +
        MFG +
        '">' +
        (o.footRight || "") +
        "</span>") +
    "</div>";

  return (
    '<section style="' +
    card(col("overflow: hidden; height: 100%; min-height: 0")) +
    '">' +
    header +
    list +
    foot +
    "</section>"
  );
}

/* ------------------------------------------------------------------ blocos */
export function panel(title, iconName, body, extra = "") {
  return (
    '<section style="' +
    card(col("gap: 10px; padding: 14px 16px 16px; " + extra)) +
    '">' +
    (title
      ? '<div style="' +
        row("gap: 8px") +
        '"><span style="color: ' +
        MFG +
        '; display: flex">' +
        icon(iconName, 14) +
        '</span><span style="font-size: 13px; font-weight: 500">' +
        title +
        "</span></div>"
      : "") +
    body +
    "</section>"
  );
}

export function metaRow(label, value, o = {}) {
  return (
    '<div style="' +
    row("justify-content: space-between; gap: 12px; padding: " + (o.tight ? "3.5px" : "5px") + " 0") +
    '">' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '; flex: none">' +
    label +
    "</span>" +
    '<span style="font-size: 12.5px; text-align: right; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ' +
    (o.color || FG) +
    '">' +
    value +
    "</span></div>"
  );
}

export function copyRow(label, value) {
  return (
    '<div style="' +
    col("gap: 4px") +
    '">' +
    '<span style="font-size: 11px; color: ' +
    MFG +
    '">' +
    label +
    "</span>" +
    '<div style="' +
    row(
      "gap: 6px; height: 28px; padding: 0 4px 0 8px; border-radius: 8px; border: 1px solid " +
        BORDER +
        "; background: oklch(1 0 0 / 0.05);",
    ) +
    '">' +
    '<span style="flex: 1; min-width: 0; font-family: ' +
    MONO +
    "; font-size: 11px; color: " +
    FG +
    '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
    value +
    "</span>" +
    '<span style="' +
    row("justify-content: center; width: 20px; height: 20px; border-radius: 5px; color: " + MFG) +
    '">' +
    icon("copy", 12) +
    "</span></div></div>"
  );
}

/* ----------------------------------------------------------- coluna Missão */
function colunaMissao(status, o = {}) {
  const k = KINDS.BUG;
  const detalhes = panel(
    "Missão",
    "list-checks",
    metaRow("Campanha", CAMPANHA) +
      metaRow("Tipo", chip(k.dnd, k.icon)) +
      metaRow("Prioridade", "Urgente", { color: DESTR }) +
      metaRow("Etapas da missão", "1 de 3") +
      (o.compact ? metaRow("Status", status) : "") +
      '<div style="height: 1px; background: ' +
      BORDER +
      '; margin: 6px 0"></div>' +
      '<p style="margin: 0; font-size: 12px; line-height: 18px; color: ' +
      MFG +
      '">' +
      mono("taskkill", FG, "font-size: 11px") +
      " devolve 0 mesmo com um filho vivo, e a trava de worktree nunca sai.</p>" +
      '<a href="#" style="font-size: 12px">Abrir Missão</a>',
  );

  const dep = (label, title, kindIcon, chipEl) =>
    '<div style="' +
    row("gap: 8px; align-items: flex-start; padding: 3px 0") +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex; flex: none; margin-top: 2px">' +
    icon(kindIcon, 13) +
    "</span>" +
    '<div style="' +
    col("gap: 3px; flex: 1; min-width: 0") +
    '">' +
    '<span style="font-size: 11.5px; line-height: 16px; color: ' +
    FG +
    '">' +
    title +
    "</span>" +
    '<div style="' +
    row("gap: 7px") +
    '"><span style="font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; color: ' +
    MFG +
    '">' +
    label +
    "</span>" +
    chipEl +
    "</div></div></div>";

  const deps = panel(
    "Dependências",
    "git-branch",
    dep(
      "Depende de",
      "Fixar versões exatas em todos os package.json",
      "wrench",
      dotChip("Concluída", A_NEUTRAL, true),
    ) +
      '<div style="height: 1px; background: ' +
      BORDER +
      '"></div>' +
      dep(
        "Bloqueia",
        "Badge de ambiente sempre visível no cockpit",
        "target",
        dotChip("Pronta", A_BLUE, false),
      ),
  );

  const ritual = panel(
    "Ritual",
    "wand-sparkles",
    '<span style="font-size: 13px; color: ' +
      MFG +
      '">Nenhum ainda</span>' +
      '<p style="margin: 0; font-size: 11.5px; line-height: 17px; color: ' +
      MFG +
      '">Esta Expedição é um passo solto. Rituais encadeiam passos e chegam na Fase 4.</p>',
  );

  // Nas telas terminais, o lugar da Dependência é ocupado pelas outras
  // tentativas: de um resultado, o que se quer saber é se já houve outro.
  const irma = (num, statusKey, dur, quando, atual) => {
    const s = RUN_STATUS[statusKey];
    return (
      '<div style="' +
      row(
        "gap: 9px; padding: 7px 8px; border-radius: 8px;" +
          (atual ? " background: oklch(1 0 0 / 0.06);" : ""),
      ) +
      '">' +
      '<span style="font-family: ' +
      MONO +
      "; font-size: 11px; color: " +
      (atual ? FG : MFG) +
      '; flex: none">#' +
      num +
      "</span>" +
      dotChip(s.label, s.color, s.dim) +
      '<span style="flex: 1"></span>' +
      '<span style="font-family: ' +
      MONO +
      "; font-size: 11px; color: " +
      MFG +
      '">' +
      dur +
      "</span>" +
      '<span style="font-size: 11px; color: ' +
      MFG +
      '; width: 54px; text-align: right">' +
      quando +
      "</span></div>"
    );
  };

  const irmas = panel(
    "Expedições desta Missão",
    "circle-play",
    '<div style="' +
      col("gap: 2px; margin: 0 -8px") +
      '">' +
      irma(243, "TIMED_OUT", "15:00", "há 5 min", o.atual === 243) +
      irma(241, "SUCCEEDED", "04:38", "há 2 h", o.atual === 241) +
      irma(238, "CANCELLED", "00:41", "ontem", false) +
      "</div>",
  );

  return (
    '<div style="' +
    col("gap: 16px; min-height: 0") +
    '">' +
    detalhes +
    (o.compact ? irmas : deps + ritual) +
    "</div>"
  );
}

/* ---------------------------------------------------------- coluna Runtime */
function runtimeCard(o = {}) {
  const divisor = '<div style="height: 1px; background: ' + BORDER + '; margin: 4px 0"></div>';
  return panel(
    "Runtime",
    "cpu",
    metaRow("Herói", "Ferreiro de Plataforma", { tight: true }) +
      metaRow("Guilda", "Claude Code", { tight: true }) +
      metaRow("Patrono", "Claude Opus 5", { tight: true }) +
      metaRow("Equipamento", "Forja de Plataforma", { tight: true }) +
      metaRow("Versão da CLI", mono("claude 2.1.263", FG, "font-size: 10.5px"), { tight: true }) +
      (o.usage
        ? divisor +
          metaRow("Tokens de entrada", o.usage[0], { tight: true }) +
          metaRow("Tokens de saída", o.usage[1], { tight: true }) +
          metaRow("Em cache", o.usage[2], { tight: true, color: MFG })
        : "") +
      (o.permissoes
        ? divisor +
          metaRow("Permissão pedida", mono("advisory", MFG, "font-size: 10.5px"), { tight: true }) +
          metaRow("Permissão aplicada", mono("harness-native", A_AMBER, "font-size: 10.5px"), {
            tight: true,
          }) +
          '<p style="margin: 3px 0 0; font-size: 11px; line-height: 16px; color: ' +
          MFG +
          '">Quem barra é a própria CLI. A política do Equipamento é um pedido, não uma barreira.</p>'
        : ""),
  );
}

function sessaoCard(sessao, worktree) {
  return (
    '<section style="' +
    card(col("gap: 9px; padding: 14px 16px 15px")) +
    '">' +
    copyRow("Sessão capturada", sessao) +
    copyRow("Worktree", worktree) +
    "</section>"
  );
}

function tempoCard(o) {
  return (
    '<section style="' +
    card(col("gap: 10px; padding: 14px 16px 16px")) +
    '">' +
    '<div style="' +
    row("justify-content: space-between; align-items: flex-end") +
    '">' +
    '<div style="' +
    col("gap: 3px") +
    '">' +
    '<span style="font-size: 11px; color: ' +
    MFG +
    '">' +
    o.label +
    "</span>" +
    '<span style="font-family: ' +
    MONO +
    "; font-size: 26px; line-height: 30px; letter-spacing: -0.02em; color: " +
    (o.color || FG) +
    '">' +
    o.value +
    "</span></div>" +
    '<span style="font-size: 11px; color: ' +
    MFG +
    '; padding-bottom: 4px">' +
    o.right +
    "</span>" +
    "</div>" +
    o.action +
    (o.note
      ? '<p style="margin: 0; font-size: 10.5px; line-height: 15px; color: ' +
        MFG +
        '">' +
        o.note +
        "</p>"
      : "") +
    "</section>"
  );
}

/* --------------------------------------------------------------- cabeçalho */
function cockpitHeader(statusKey, actions, o = {}) {
  const s = RUN_STATUS[statusKey];
  return (
    '<div style="' +
    col("gap: 8px; flex: none") +
    '">' +
    breadcrumb(["Expedições", CAMPANHA, "Expedição " + (o.id || 241)]) +
    '<div style="' +
    row("justify-content: space-between; align-items: flex-start; gap: 24px") +
    '">' +
    '<div style="' +
    col("gap: 3px; min-width: 0") +
    '">' +
    '<span style="' +
    row("gap: 6px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: " + MFG) +
    '">' +
    icon("gem", 12, "", 1.8) +
    "<span>Cristal de Visão</span></span>" +
    '<h1 style="margin: 0; font-family: ' +
    SERIF +
    "; font-size: 27px; line-height: 34px; font-weight: 600; color: " +
    FG +
    '">' +
    MISSAO +
    "</h1></div>" +
    '<div style="' +
    row("gap: 8px; flex: none; padding-top: 12px") +
    '">' +
    actions +
    "</div></div>" +
    '<div style="' +
    row("gap: 10px; padding-top: 2px") +
    '">' +
    dotChip(s.label, s.color, s.dim, s.pulse) +
    chip("Monstro", "bug") +
    envBadge("host", "dnd", "lg") +
    '<span style="flex: 1"></span>' +
    '<span style="' +
    row("gap: 6px; font-size: 11.5px; color: " + MFG) +
    '">' +
    icon("clock", 13) +
    "<span>Iniciada hoje às " +
    (o.inicio || "14:02") +
    "</span></span>" +
    "</div></div>"
  );
}

/* ------------------------------------------------------- rodapé de filtros */
function filtroChip(text, count, on) {
  return (
    '<span style="' +
    row(
      "gap: 7px; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid " +
        (on ? INPUT : BORDER) +
        "; background: " +
        (on ? "oklch(1 0 0 / 0.08)" : "transparent") +
        "; font-size: 12.5px; color: " +
        (on ? FG : MFG) +
        ";",
    ) +
    '">' +
    "<span>" +
    text +
    "</span>" +
    '<span style="font-family: ' +
    MONO +
    "; font-size: 10.5px; color: " +
    MFG +
    '">' +
    count +
    "</span></span>"
  );
}

function rodapeFiltros(live) {
  const sw =
    '<span style="' +
    row("gap: 8px") +
    '">' +
    '<span style="' +
    row(
      "width: 32px; height: 18px; border-radius: 999px; padding: 2px; background: " +
        (live ? "oklch(0.929 0.013 255.508)" : "oklch(1 0 0 / 0.14)") +
        "; justify-content: " +
        (live ? "flex-end" : "flex-start") +
        ";",
    ) +
    '"><span style="width: 14px; height: 14px; border-radius: 999px; background: ' +
    (live ? "oklch(0.208 0.042 265.755)" : MFG) +
    '"></span></span>' +
    '<span style="font-size: 12.5px; color: ' +
    (live ? FG : MFG) +
    '">Seguir ao vivo</span></span>';

  return (
    '<section style="' +
    card(row("gap: 10px; height: 40px; padding: 0 12px 0 14px; flex: none; border-radius: 12px")) +
    '">' +
    '<span style="' +
    row("gap: 7px; font-size: 12px; color: " + MFG + "; flex: none") +
    '">' +
    icon("sliders-horizontal", 14) +
    "<span>Eventos</span></span>" +
    '<div style="width: 1px; height: 18px; background: ' +
    BORDER +
    '"></div>' +
    '<div style="' +
    row("gap: 6px") +
    '">' +
    filtroChip("Tudo", 47, true) +
    filtroChip("Itens", 22, false) +
    filtroChip("Texto", 9, false) +
    filtroChip("Uso", 3, false) +
    filtroChip("Sistema", 13, false) +
    filtroChip("Diagnóstico", 0, false) +
    "</div>" +
    '<span style="flex: 1"></span>' +
    sw +
    '<div style="width: 1px; height: 18px; background: ' +
    BORDER +
    '"></div>' +
    '<button style="' +
    btn("ghost", "sm") +
    '">' +
    icon("copy", 13) +
    "<span>Copiar Diário</span></button>" +
    "</section>"
  );
}

/* ================================================== ARTBOARD 1 — em andamento */
const EVENTOS_VIVOS = [
  timelineItem("14:02:11", "RunStarted", "Expedição iniciada", {
    detail: "Guilda Claude Code · Campo aberto · trava de worktree adquirida",
  }),
  timelineItem("14:02:12", "ContextLoaded", "Contexto carregado", {
    detail: "6 arquivos · 2 Páginas do Grimório · 18.204 tokens",
  }),
  timelineItem("14:02:14", "ToolCall", "Read", {
    tool: true,
    detail: "packages/platform/src/process-tree.ts",
    code: true,
  }),
  timelineItem("14:02:14", "ToolResult", "214 linhas"),
  timelineItem(
    "14:02:19",
    "TextDelta",
    "O taskkill /T /F volta 0 assim que a raiz morre; os netos ficam.",
    { group: 4 },
  ),
  timelineItem("14:02:26", "ToolCall", "Grep", {
    tool: true,
    detail: "taskkill  em  packages/platform",
    code: true,
  }),
  timelineItem("14:02:27", "ToolResult", "4 ocorrências em 2 arquivos"),
  timelineItem("14:02:33", "ToolCall", "Edit", {
    tool: true,
    detail: "packages/platform/src/process-tree.ts   +38 −6",
    code: true,
  }),
  timelineItem("14:02:34", "ToolResult", "Arquivo gravado"),
  timelineItem("14:02:41", "ToolCall", "Bash", {
    tool: true,
    detail: "pnpm --filter @dungeon-master/platform test",
    code: true,
  }),
  timelineItem("14:03:08", "ToolResult", "código 1 · 1 de 14 testes falhou"),
  timelineItem("14:03:11", "Usage", "182.437 entrada · 9.108 saída · 148.302 em cache"),
  timelineItem(
    "14:03:16",
    "TextDelta",
    "O polling desiste antes do último neto sair. Vou subir o teto para 5 s.",
    { group: 2 },
  ),
  timelineItem("14:03:22", "ToolCall", "Edit", {
    tool: true,
    running: true,
    detail: "packages/platform/src/process-tree.test.ts — aguardando resposta",
    code: true,
  }),
];

export function buildMain() {
  const actions =
    '<button style="' +
    btn("ghost", "sm") +
    '">' +
    icon("external-link", 14) +
    "<span>Abrir Missão</span></button>";

  const cancelar =
    '<button style="' +
    btn("destructive", "default", "width: 100%") +
    '">' +
    icon("circle-stop", 15) +
    "<span>Cancelar Expedição</span></button>";

  const direita =
    '<div style="' +
    col("gap: 16px; min-height: 0") +
    '">' +
    runtimeCard({ permissoes: true }) +
    sessaoCard("sess_01K7QW3M8ZP4RN", ".runs/exp-241") +
    tempoCard({
      label: "Tempo decorrido",
      value: "01:13",
      right: "teto 15 min",
      action: cancelar,
      note: "Um segundo toque confirma. Só vira Retirada depois que a árvore de processos for confirmada encerrada.",
    }) +
    "</div>";

  const grid =
    '<div style="display: grid; grid-template-columns: 300px minmax(0, 1fr) 320px; gap: 20px; height: 680px; flex: none; min-height: 0; align-items: stretch">' +
    colunaMissao(dotChip("Em execução", A_BLUE, false, true)) +
    timeline(EVENTOS_VIVOS, { live: true, older: "33 eventos antes" }) +
    direita +
    "</div>";

  return write(
    "Main.dc.html",
    1440,
    1000,
    screen("dnd", "Expedições", 1440, 1000, cockpitHeader("RUNNING", actions) + grid + rodapeFiltros(true)),
  );
}

/* ====================================================== ARTBOARD 2 — Vitória */
const EVENTOS_VITORIA = [
  timelineItem("14:02:41", "ToolCall", "Bash", {
    tool: true,
    detail: "pnpm --filter @dungeon-master/platform test",
    code: true,
  }),
  timelineItem("14:03:08", "ToolResult", "código 1 · 1 de 14 testes falhou"),
  timelineItem("14:03:11", "Usage", "182.437 entrada · 9.108 saída · 148.302 em cache"),
  timelineItem(
    "14:03:16",
    "TextDelta",
    "O polling desiste antes do último neto sair. Vou subir o teto para 5 s.",
    { group: 2 },
  ),
  timelineItem("14:03:22", "ToolCall", "Edit", {
    tool: true,
    detail: "packages/platform/src/process-tree.test.ts   +21 −4",
    code: true,
  }),
  timelineItem("14:03:23", "ToolResult", "Arquivo gravado"),
  timelineItem("14:03:29", "ToolCall", "Bash", {
    tool: true,
    detail: "pnpm --filter @dungeon-master/platform test",
    code: true,
  }),
  timelineItem("14:05:02", "ToolResult", "código 0 · 14 de 14 testes passaram"),
  timelineItem(
    "14:05:09",
    "TextDelta",
    "O polling agora confirma cada neto antes de devolver. Dois commits no worktree.",
    { group: 3 },
  ),
  timelineItem("14:05:41", "ToolCall", "Bash", { tool: true, detail: "git commit", code: true }),
  timelineItem("14:05:42", "ToolResult", "2 commits · 4 arquivos"),
  timelineItem("14:06:44", "Usage", "241.902 entrada · 14.377 saída · 196.114 em cache"),
  timelineItem("14:06:49", "RunCompleted", "Vitória", {
    detail: "resultado estruturado validado · árvore encerrada · trava liberada",
  }),
];

function resultadoBloco() {
  const tituloSecao = (texto, nota) =>
    '<div style="' +
    row("justify-content: space-between; align-items: flex-end; gap: 16px; flex: none") +
    '">' +
    '<h2 style="margin: 0; font-family: ' +
    SERIF +
    "; font-size: 20px; line-height: 26px; font-weight: 600; color: " +
    FG +
    '">' +
    texto +
    "</h2>" +
    '<span style="font-size: 11.5px; color: ' +
    MFG +
    '">' +
    nota +
    "</span></div>";

  const arquivo = (path, mais, menos) =>
    '<div style="' +
    row("gap: 10px; padding: 5px 0") +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex; flex: none">' +
    icon("file-text", 13) +
    "</span>" +
    '<span style="flex: 1; min-width: 0; font-family: ' +
    MONO +
    "; font-size: 11.5px; color: " +
    FG +
    '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
    path +
    "</span>" +
    '<span style="font-family: ' +
    MONO +
    "; font-size: 11px; color: " +
    A_GREEN +
    '; flex: none">+' +
    mais +
    "</span>" +
    '<span style="font-family: ' +
    MONO +
    "; font-size: 11px; color: " +
    DESTR +
    '; flex: none">−' +
    menos +
    "</span></div>";

  const commit = (hash, msg, quando) =>
    '<div style="' +
    row("gap: 10px; padding: 5px 0; align-items: flex-start") +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex; flex: none; margin-top: 2px">' +
    icon("git-commit", 13) +
    "</span>" +
    '<div style="' +
    col("gap: 2px; flex: 1; min-width: 0") +
    '">' +
    '<span style="font-size: 12.5px; line-height: 17px; color: ' +
    FG +
    '">' +
    msg +
    "</span>" +
    '<span style="font-family: ' +
    MONO +
    "; font-size: 10.5px; color: " +
    MFG +
    '">' +
    hash +
    " · " +
    quando +
    "</span></div></div>";

  const espolio = (nome, tipo, tamanho) =>
    '<div style="' +
    row("gap: 10px; padding: 6px 0") +
    '">' +
    '<span style="color: ' +
    A_AMBER +
    '; display: flex; flex: none">' +
    icon("package", 14) +
    "</span>" +
    '<div style="' +
    col("gap: 1px; flex: 1; min-width: 0") +
    '">' +
    '<span style="font-size: 12.5px; color: ' +
    FG +
    '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
    nome +
    "</span>" +
    '<span style="font-size: 10.5px; color: ' +
    MFG +
    '">' +
    tipo +
    " · " +
    tamanho +
    "</span></div>" +
    '<span style="color: ' +
    MFG +
    '; display: flex; flex: none">' +
    icon("arrow-right", 13) +
    "</span></div>";

  const vazio = (texto, nota, iconName) =>
    '<div style="' +
    col("align-items: center; justify-content: center; gap: 7px; padding: 14px 8px 16px") +
    '">' +
    '<span style="' +
    row(
      "justify-content: center; width: 32px; height: 32px; border-radius: 999px; border: 1px dashed " +
        INPUT +
        "; color: " +
        MFG +
        ";",
    ) +
    '">' +
    icon(iconName, 15) +
    "</span>" +
    '<span style="font-size: 12.5px; color: ' +
    FG +
    '">' +
    texto +
    "</span>" +
    '<p style="margin: 0; max-width: 300px; text-align: center; font-size: 11px; line-height: 16px; color: ' +
    MFG +
    '">' +
    nota +
    "</p></div>";

  const esquerda =
    '<div style="' +
    col("gap: 16px") +
    '">' +
    panel(
      "Resumo",
      "quote",
      '<p style="margin: 0; font-size: 13px; line-height: 20px; color: ' +
        MFG +
        '">A terminação da árvore agora confirma cada descendente por polling antes de devolver, com teto de 5 s e distinção entre término real e abort. A trava de worktree passou para um ' +
        mono("finally", FG, "font-size: 11px") +
        ", então uma Expedição interrompida não deixa mais o caminho preso. O teste que reproduzia o caso no Windows entrou na suíte de plataforma.</p>",
    ) +
    panel(
      "Arquivos alterados",
      "file-text",
      '<div style="' +
        col("gap: 0") +
        '">' +
        arquivo("packages/platform/src/process-tree.ts", 38, 6) +
        arquivo("packages/platform/src/process-tree.test.ts", 21, 4) +
        arquivo("packages/runtime/src/host/cancel.ts", 12, 9) +
        arquivo("packages/runtime/src/worktree-lock.ts", 7, 3) +
        "</div>",
    ) +
    panel(
      "Commits no worktree",
      "git-branch",
      '<div style="' +
        col("gap: 0") +
        '">' +
        commit("a3f19c2", "Confirmar término de cada descendente antes de devolver", "14:05:41") +
        commit("b7d0e84", "Liberar a trava de worktree no finally", "14:05:42") +
        "</div>" +
        '<div style="' +
        row("gap: 8px; padding-top: 4px") +
        '">' +
        '<button style="' +
        btn("outline", "sm") +
        '">Ver diff</button>' +
        '<button style="' +
        btn("ghost", "sm") +
        '">Trazer para a Campanha</button></div>',
    ) +
    "</div>";

  const direita =
    '<div style="' +
    col("gap: 16px") +
    '">' +
    panel(
      "Espólios",
      "package",
      '<div style="' +
        col("gap: 0") +
        '">' +
        espolio("Relatório do teste de plataforma", "Saída de teste", "14 KB") +
        espolio("process-tree.diff", "Diff unificado", "6 KB") +
        "</div>",
    ) +
    panel(
      "Missões propostas",
      "list-checks",
      vazio(
        "Nenhuma ainda",
        "A Expedição não propôs desdobramentos. A decomposição automática chega na Fase 5.",
        "list-checks",
      ),
    ) +
    panel(
      "Candidatos ao Grimório",
      "book-open",
      vazio(
        "Nenhum ainda",
        "O que virou aprendizado ainda mora no Diário. A destilação chega na Fase 6.",
        "book-open",
      ),
    ) +
    "</div>";

  return (
    '<div style="' +
    col("gap: 16px; flex: none") +
    '">' +
    tituloSecao(
      "Resultado da Expedição",
      "structured output validado pelo schema TaskExecutionResult",
    ) +
    '<div style="display: grid; grid-template-columns: minmax(0, 1.32fr) minmax(0, 1fr); gap: 20px; align-items: start">' +
    esquerda +
    direita +
    "</div></div>"
  );
}

export function buildConcluida() {
  const actions =
    '<button style="' +
    btn("outline", "sm") +
    '">' +
    icon("external-link", 14) +
    "<span>Abrir Missão</span></button>" +
    '<button style="' +
    btn("default", "sm") +
    '">' +
    icon("swords", 14) +
    "<span>Nova Expedição</span></button>";

  const direita =
    '<div style="' +
    col("gap: 16px; min-height: 0") +
    '">' +
    runtimeCard({ usage: ["241.902", "14.377", "196.114"] }) +
    sessaoCard("sess_01K7QW3M8ZP4RN", ".runs/exp-241") +
    tempoCard({
      label: "Duração",
      value: "04:38",
      right: "teto 15 min",
      color: A_GREEN,
      action:
        '<button style="' +
        btn("outline", "sm", "width: 100%") +
        '">' +
        icon("refresh-cw", 13) +
        "<span>Repetir com o mesmo Equipamento</span></button>",
    }) +
    "</div>";

  const grid =
    '<div style="display: grid; grid-template-columns: 300px minmax(0, 1fr) 320px; gap: 20px; height: 640px; flex: none; min-height: 0; align-items: stretch">' +
    colunaMissao(dotChip("Concluída", A_NEUTRAL, true), { compact: true, atual: 241 }) +
    timeline(EVENTOS_VITORIA, {
      headRight: "histórico completo",
      older: "38 eventos antes",
      footLeft: "47 eventos · 14:02:11 → 14:06:49",
      footRight: "Copiar Diário",
    }) +
    direita +
    "</div>";

  return write(
    "ExpedicaoConcluida.dc.html",
    1440,
    1510,
    screen(
      "dnd",
      "Expedições",
      1440,
      1510,
      cockpitHeader("SUCCEEDED", actions) + grid + resultadoBloco(),
    ),
  );
}

/* ===================================================== ARTBOARD 3 — Exaustão */
const EVENTOS_EXAUSTAO = [
  timelineItem("14:12:14", "RunStarted", "Expedição iniciada", {
    detail: "Guilda Claude Code · Campo aberto · trava de worktree adquirida",
  }),
  timelineItem("14:12:15", "ContextLoaded", "Contexto carregado", {
    detail: "6 arquivos · 2 Páginas do Grimório · 18.204 tokens",
  }),
  timelineItem("14:12:22", "ToolCall", "Read", {
    tool: true,
    detail: "packages/platform/src/process-tree.ts",
    code: true,
  }),
  timelineItem("14:12:22", "ToolResult", "214 linhas"),
  timelineItem(
    "14:13:04",
    "TextDelta",
    "Vou rodar a suíte inteira em série para ver qual teste segura o processo.",
    { group: 3 },
  ),
  timelineItem("14:16:48", "ToolCall", "Edit", {
    tool: true,
    detail: "packages/platform/src/process-tree.ts   +52 −11",
    code: true,
  }),
  timelineItem("14:16:49", "ToolResult", "Arquivo gravado"),
  timelineItem("14:16:52", "ToolCall", "Bash", {
    tool: true,
    detail: "pnpm --filter @dungeon-master/platform test --runInBand",
    code: true,
  }),
  timelineItem("14:21:03", "Usage", "318.440 entrada · 21.905 saída · 244.180 em cache"),
  timelineItem("14:24:10", "Diagnostic", "Sem eventos do harness há 3 min", {
    detail: "teto de ociosidade em 5 min",
  }),
  timelineItem("14:27:11", "Diagnostic", "Teto de conclusão atingido: 15 min", {
    detail: "cancelamento disparado pelo Runtime, não pelo Mestre da Guilda",
  }),
  timelineItem("14:27:11", "ToolResult", "sem resposta · chamada abandonada"),
  timelineItem("14:27:14", "RunFailed", "Exaustão", {
    detail: "árvore de processos confirmada encerrada · 4 processos · worktree preservado",
  }),
];

function diagnosticoBanner() {
  return (
    '<section style="' +
    row(
      "gap: 14px; align-items: flex-start; flex: none; padding: 14px 18px; border-radius: 14px; border: 1px solid " +
        tint(A_AMBER, "38%") +
        "; background: " +
        tint(A_AMBER, "10%") +
        ";",
    ) +
    '">' +
    '<span style="color: ' +
    A_AMBER +
    '; display: flex; flex: none; margin-top: 1px">' +
    icon("hourglass", 18) +
    "</span>" +
    '<div style="' +
    col("gap: 5px; flex: 1; min-width: 0") +
    '">' +
    '<span style="font-size: 14px; font-weight: 500; color: ' +
    FG +
    '">Exaustão: a Expedição bateu o teto de conclusão de 15 minutos</span>' +
    '<p style="margin: 0; font-size: 12.5px; line-height: 19px; color: ' +
    MFG +
    '">O último evento do harness chegou às 14:24, três minutos antes do teto — a suíte de plataforma ficou presa em ' +
    mono("--runInBand", FG, "font-size: 11px") +
    ". Isto foi um teto nosso, não um abort do harness. O Runtime pediu o encerramento, esperou a árvore e confirmou os quatro processos mortos antes de escrever o estado terminal.</p>" +
    "</div>" +
    '<div style="' +
    row("gap: 8px; flex: none; padding-top: 2px") +
    '">' +
    '<button style="' +
    btn("outline", "sm") +
    '">Ver os 3 eventos finais</button></div>' +
    "</section>"
  );
}

function recuperacaoBloco() {
  const linha = (label, valor, code) =>
    '<div style="' +
    row("justify-content: space-between; gap: 16px; padding: 6px 0") +
    '">' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '; flex: none">' +
    label +
    "</span>" +
    (code
      ? mono(valor, FG, "font-size: 11px")
      : '<span style="font-size: 12.5px; text-align: right">' + valor + "</span>") +
    "</div>";

  const esquerda =
    '<section style="' +
    card(col("gap: 12px; padding: 16px 18px 18px")) +
    '">' +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<span style="color: ' +
    A_BLUE +
    '; display: flex">' +
    icon("folder-open", 15) +
    "</span>" +
    '<span style="font-size: 14px; font-weight: 500">O worktree foi preservado</span></div>' +
    '<p style="margin: 0; font-size: 12.5px; line-height: 19px; color: ' +
    MFG +
    '">Nada foi descartado. As alterações da Expedição continuam no worktree dela, fora da sua árvore principal, até você decidir o que fazer. Um worktree separa o trabalho; ele não é um sandbox.</p>' +
    copyRow("Caminho", "D:\\Dev\\Claude\\Estudo\\dungeon-master\\.runs\\exp-243") +
    copyRow("Comando para inspecionar", "git -C .runs/exp-243 status --short") +
    '<div style="' +
    col("gap: 0") +
    '">' +
    linha("Branch", "dm/exp-243", true) +
    linha("Alterações não commitadas", "3 arquivos") +
    linha("Trava do caminho", "liberada às 14:27:14") +
    "</div>" +
    '<div style="' +
    row("gap: 8px; padding-top: 2px") +
    '">' +
    '<button style="' +
    btn("outline", "sm") +
    '">' +
    icon("external-link", 13) +
    "<span>Abrir no editor</span></button>" +
    '<button style="' +
    btn("ghost", "sm", "color: " + DESTR) +
    '">' +
    icon("trash-2", 13) +
    "<span>Descartar worktree</span></button></div>" +
    "</section>";

  const direita =
    '<div style="' +
    col("gap: 16px") +
    '">' +
    '<section style="' +
    card(col("gap: 11px; padding: 16px 18px 18px")) +
    '">' +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex">' +
    icon("rotate-ccw", 15) +
    "</span>" +
    '<span style="font-size: 14px; font-weight: 500">Continuar de onde parou</span></div>' +
    '<p style="margin: 0; font-size: 12.5px; line-height: 19px; color: ' +
    MFG +
    '">A sessão do harness foi capturada antes do teto, e a Guilda Claude Code declara ' +
    mono("resume", FG, "font-size: 11px") +
    " nas suas capabilities. Uma nova Expedição pode partir da mesma sessão, no mesmo worktree, com um teto maior.</p>" +
    copyRow("Sessão capturada", "sess_01K7RB5T2XA9QD") +
    '<div style="' +
    row("gap: 8px; padding-top: 2px") +
    '">' +
    '<button style="' +
    btn("default", "sm") +
    '">' +
    icon("play", 13) +
    "<span>Retomar a Expedição</span></button>" +
    '<button style="' +
    btn("outline", "sm") +
    '">' +
    icon("swords", 13) +
    "<span>Nova Expedição</span></button></div>" +
    "</section>" +
    '<section style="' +
    card(col("gap: 9px; padding: 16px 18px 18px")) +
    '">' +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex">' +
    icon("shield-check", 15) +
    "</span>" +
    '<span style="font-size: 14px; font-weight: 500">Encerramento confirmado</span></div>' +
    '<div style="' +
    col("gap: 0") +
    '">' +
    linha("Processos encerrados", "4 de 4") +
    linha("Confirmação", "polling · 3 rodadas") +
    linha("Estado terminal escrito", "14:27:14") +
    "</div>" +
    '<p style="margin: 0; font-size: 11px; line-height: 16px; color: ' +
    MFG +
    '">A Expedição só vira Exaustão depois que a árvore de processos é confirmada morta. Um filho vivo teria segurado o estado.</p>' +
    "</section></div>";

  return (
    '<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; flex: none">' +
    esquerda +
    direita +
    "</div>"
  );
}

export function buildFalha() {
  const actions =
    '<button style="' +
    btn("outline", "sm") +
    '">' +
    icon("external-link", 14) +
    "<span>Abrir Missão</span></button>" +
    '<button style="' +
    btn("default", "sm") +
    '">' +
    icon("play", 14) +
    "<span>Retomar a Expedição</span></button>";

  const direita =
    '<div style="' +
    col("gap: 16px; min-height: 0") +
    '">' +
    runtimeCard({ usage: ["318.440", "21.905", "244.180"], permissoes: true }) +
    tempoCard({
      label: "Duração até o teto",
      value: "15:00",
      right: "teto 15 min",
      color: A_AMBER,
      action:
        '<button style="' +
        btn("outline", "sm", "width: 100%") +
        '">' +
        icon("sliders-horizontal", 13) +
        "<span>Ajustar tetos no Equipamento</span></button>",
    }) +
    "</div>";

  const grid =
    '<div style="display: grid; grid-template-columns: 300px minmax(0, 1fr) 320px; gap: 20px; height: 620px; flex: none; min-height: 0; align-items: stretch">' +
    colunaMissao(dotChip("Pronta", A_BLUE, false), { compact: true, atual: 243 }) +
    timeline(EVENTOS_EXAUSTAO, {
      headRight: "histórico completo",
      older: "121 eventos antes",
      footLeft: "127 eventos · 14:12:14 → 14:27:14",
      footRight: "Copiar Diário",
    }) +
    direita +
    "</div>";

  return write(
    "ExpedicaoFalha.dc.html",
    1440,
    1450,
    screen(
      "dnd",
      "Expedições",
      1440,
      1450,
      cockpitHeader("TIMED_OUT", actions, { id: 243, inicio: "14:12" }) +
        diagnosticoBanner() +
        grid +
        recuperacaoBloco(),
    ),
  );
}
