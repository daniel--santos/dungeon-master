// Página "Componentes": a anatomia do item do Diário e o badge de ambiente.
// São as duas peças que se repetem em toda a Fase 2 e que não podem divergir
// entre as telas.

import {
  A_AMBER,
  A_BLUE,
  A_GREEN,
  A_NEUTRAL,
  A_VIOLET,
  BG,
  BORDER,
  CARD,
  DESTR,
  FG,
  INPUT,
  MFG,
  MONO,
  SERIF,
  card,
  col,
  envBadge,
  icon,
  mono,
  row,
  tint,
  write,
} from "./kit.mjs";
import { EV } from "./cockpit.mjs";

function folha(w, h, eyebrow, titulo, subtitulo, corpo, pad) {
  return (
    '<div style="' +
    col(
      "width: " +
        w +
        "px; height: " +
        h +
        "px; overflow: hidden; gap: 12px; padding: " +
        pad +
        "; background: " +
        BG +
        "; color: " +
        FG +
        ";",
    ) +
    '">' +
    '<div style="' +
    col("gap: 4px; flex: none") +
    '">' +
    '<span style="font-size: 10.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ' +
    MFG +
    '">' +
    eyebrow +
    "</span>" +
    '<h2 style="margin: 0; font-family: ' +
    SERIF +
    "; font-size: 21px; line-height: 26px; font-weight: 600; color: " +
    FG +
    '">' +
    titulo +
    "</h2>" +
    '<p style="margin: 0; font-size: 11.5px; line-height: 16px; color: ' +
    MFG +
    '">' +
    subtitulo +
    "</p></div>" +
    corpo +
    "</div>"
  );
}

/* ============================================ ARTBOARD 7 — item do Diário */
// Cada linha é um tipo da seção 12. As duas colunas mostram a mesma linha nos
// dois estados: enquanto a Expedição corre e depois que ela termina.
const LINHAS = [
  {
    tipo: "RunStarted",
    dens: "sempre visível",
    vivo: ["Expedição iniciada", "há 4 min", "rel"],
    hist: ["Expedição iniciada", "14:02:11", "abs"],
  },
  {
    tipo: "ContextLoaded",
    dens: "uma linha",
    vivo: ["Contexto carregado", "6 arquivos · 18.204 tokens"],
    hist: ["Contexto carregado", "6 arquivos · 18.204 tokens"],
  },
  {
    tipo: "ToolCall",
    dens: "linha própria",
    vivo: ["Bash", "pnpm test — aguardando", "run"],
    hist: ["Bash", "pnpm test · código 0 · 27 s", "merge"],
  },
  {
    tipo: "ToolResult",
    dens: "recuada, cinza",
    vivo: ["código 0 · 14 testes", "chega depois da chamada"],
    hist: ["funde na chamada acima", "", "off"],
  },
  {
    tipo: "TextDelta",
    dens: "agrupa",
    vivo: ["O polling desiste cedo demais.", "grupo aberto, contador sobe", "grow"],
    hist: ["O polling desiste cedo demais.", "grupo fechado", "grp"],
  },
  {
    tipo: "Usage",
    dens: "discreta",
    vivo: ["182.437 entrada · 9.108 saída", "a cada relatório"],
    hist: ["some da lista", "vira o total do rodapé", "off"],
  },
  {
    tipo: "Diagnostic",
    dens: "nunca agrupa",
    vivo: ["Sem eventos há 3 min", "teto de ociosidade em 5 min"],
    hist: ["Sem eventos há 3 min", "teto de ociosidade em 5 min"],
  },
  {
    tipo: "RunCompleted",
    dens: "fecha a lista",
    vivo: ["Vitória", "o pulso do rodapé some", "end"],
    hist: ["Vitória", "primeira linha ao abrir"],
  },
];

function mini(tipo, dados, w) {
  const e = EV[tipo];
  const modo = dados[2];
  const apagado = modo === "off";
  const s = tipo === "ToolResult" || tipo === "Usage" ? 16 : 18;

  const circulo =
    '<span style="' +
    row(
      "justify-content: center; width: " +
        s +
        "px; height: " +
        s +
        "px; flex: none; border-radius: 999px; border: 1px solid " +
        tint(e.color, modo === "run" ? "70%" : apagado ? "18%" : "38%") +
        "; background: " +
        CARD +
        "; color: " +
        (apagado ? MFG : e.color) +
        ";" +
        (modo === "run" ? " animation: dcpulse 1.6s ease-in-out infinite;" : "") +
        (apagado ? " opacity: .5;" : ""),
    ) +
    '">' +
    icon(e.icon, s === 18 ? 10 : 9, "", 2) +
    "</span>";

  const marca =
    modo === "rel" || modo === "abs"
      ? '<span style="font-family: ' +
        MONO +
        "; font-size: 9.5px; color: " +
        MFG +
        '; flex: none">' +
        dados[1] +
        "</span>"
      : "";

  const grupo =
    modo === "grow" || modo === "grp"
      ? '<span style="' +
        row(
          "gap: 3px; height: 14px; padding: 0 5px; flex: none; border-radius: 999px; border: 1px solid " +
            BORDER +
            "; font-size: 9px; color: " +
            (modo === "grow" ? FG : MFG) +
            ";" +
            (modo === "grow" ? " animation: dcpulse 1.8s ease-in-out infinite;" : ""),
        ) +
        '">' +
        (modo === "grow" ? "4 blocos +" : "4 blocos") +
        "</span>"
      : "";

  return (
    '<div style="' +
    row(
      "gap: 8px; align-items: flex-start; width: " +
        w +
        "px; height: 38px; padding: 5px 9px; border-radius: 8px; border: 1px solid " +
        BORDER +
        "; background: " +
        CARD +
        ";" +
        (apagado ? " opacity: .55;" : ""),
    ) +
    '">' +
    circulo +
    '<div style="' +
    col("gap: 1px; flex: 1; min-width: 0") +
    '">' +
    '<div style="' +
    row("gap: 6px; min-width: 0") +
    '">' +
    '<span style="font-size: 11px; line-height: 15px; color: ' +
    (tipo === "ToolResult" || tipo === "Usage" || apagado ? MFG : FG) +
    '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
    dados[0] +
    "</span>" +
    grupo +
    '<span style="flex: 1"></span>' +
    marca +
    "</div>" +
    (dados[1] && modo !== "rel" && modo !== "abs"
      ? '<span style="font-size: 9.5px; line-height: 13px; color: ' +
        MFG +
        '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
        dados[1] +
        "</span>"
      : "") +
    "</div></div>"
  );
}

export function buildEventoTimeline() {
  const W_TIPO = 128;
  const W_CEL = 250;

  const cabecalho =
    '<div style="' +
    row("gap: 12px; flex: none") +
    '">' +
    '<span style="width: ' +
    W_TIPO +
    'px; flex: none"></span>' +
    ['<span style="' + row("gap: 6px") + '"><span style="width: 6px; height: 6px; border-radius: 999px; background: ' + A_BLUE + '; animation: dcpulse 1.6s ease-in-out infinite"></span>Ao vivo</span>', "Histórico"]
      .map(
        (t) =>
          '<span style="width: ' +
          W_CEL +
          "px; flex: none; font-size: 11px; font-weight: 500; color: " +
          MFG +
          '">' +
          t +
          "</span>",
      )
      .join("") +
    "</div>";

  const linhas = LINHAS.map(
    (l) =>
      '<div style="' +
      row("gap: 12px; flex: none") +
      '">' +
      '<div style="' +
      col("gap: 1px; width: " + W_TIPO + "px; flex: none; padding-top: 5px") +
      '">' +
      '<span style="font-family: ' +
      MONO +
      "; font-size: 10.5px; color: " +
      EV[l.tipo].color +
      '">' +
      l.tipo +
      "</span>" +
      '<span style="font-size: 9.5px; color: ' +
      MFG +
      '">' +
      l.dens +
      "</span></div>" +
      mini(l.tipo, l.vivo, W_CEL) +
      mini(l.tipo, l.hist, W_CEL) +
      "</div>",
  ).join("");

  const corpo =
    '<div style="' + col("gap: 4px; flex: none") + '">' + cabecalho + linhas + "</div>";

  return write(
    "EventoTimeline.dc.html",
    720,
    480,
    folha(
      720,
      480,
      "Componente · Fase 2",
      "Item do Diário da Expedição",
      "A diferença entre ao vivo e histórico é de densidade, não de conteúdo: nada some do log.",
      corpo,
      "20px 28px",
    ),
  );
}

/* =========================================== ARTBOARD 8 — badge de ambiente */
export function buildBadgeAmbiente() {
  const coluna = (theme, rotulo) =>
    '<section style="' +
    card(col("gap: 11px; padding: 14px 16px 16px")) +
    '">' +
    '<div style="' +
    row("justify-content: space-between") +
    '">' +
    '<span style="font-size: 11.5px; font-weight: 500; color: ' +
    FG +
    '">' +
    rotulo +
    "</span>" +
    mono(theme, MFG, "font-size: 10px") +
    "</div>" +
    envBadge("host", theme, "md") +
    envBadge("docker", theme, "md") +
    '<div style="height: 1px; background: ' +
    BORDER +
    '"></div>' +
    '<div style="' +
    col("gap: 5px") +
    '">' +
    '<span style="font-size: 10px; color: ' +
    MFG +
    '">Compacto, na tabela de Expedições</span>' +
    envBadge("host", theme, "sm") +
    "</div></section>";

  const contra =
    '<div style="' +
    row(
      "gap: 12px; align-items: center; flex: none; padding: 10px 14px; border-radius: 12px; border: 1px dashed " +
        tint(DESTR, "35%") +
        "; background: " +
        tint(DESTR, "6%") +
        ";",
    ) +
    '">' +
    '<span style="color: ' +
    DESTR +
    '; display: flex; flex: none">' +
    icon("ban", 16) +
    "</span>" +
    '<span style="' +
    row(
      "gap: 7px; height: 26px; padding: 0 10px; flex: none; border-radius: 8px; border: 1px solid " +
        BORDER +
        "; background: oklch(1 0 0 / 0.04); opacity: .55;",
    ) +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex">' +
    icon("shield-alert", 13) +
    '</span><span style="font-size: 13px; text-decoration: line-through; text-decoration-color: ' +
    DESTR +
    '">Campo aberto</span></span>' +
    '<p style="margin: 0; font-size: 11px; line-height: 16px; color: ' +
    MFG +
    '; flex: 1">Nunca assim. O nome do tema sozinho esconde a informação de segurança — o aviso e o texto canônico viajam com ele em qualquer tamanho, em qualquer tema, em qualquer tela.</p>' +
    "</div>";

  const corpo =
    '<div style="' +
    col("gap: 12px; flex: none") +
    '">' +
    '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px">' +
    coluna("dnd", "Com o tema ligado") +
    coluna("plain", "Com o tema desligado") +
    "</div>" +
    contra +
    "</div>";

  return write(
    "BadgeAmbiente.dc.html",
    880,
    400,
    folha(
      880,
      400,
      "Componente · Fase 2",
      "Badge de ambiente",
      "Segurança nunca é tematizada a ponto de sumir. Trocar o tema muda o nome, nunca o aviso nem o texto canônico.",
      corpo,
      "22px 26px",
    ),
  );
}
