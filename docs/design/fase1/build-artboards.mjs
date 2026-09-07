// Gera os artboards .dc.html do canvas de design da Fase 1.
// Rode com: node docs/design/fase1/build-artboards.mjs
// Os .dc.html gerados sao os arquivos de trabalho do canvas.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ tokens */
// Valores lidos de apps/web/src/styles.css (bloco .dark). Nada arredondado.
const BG = "oklch(0.129 0.042 264.695)";
const FG = "oklch(0.984 0.003 247.858)";
const CARD = "oklch(0.208 0.042 265.755)";
const MUTED = "oklch(0.279 0.041 260.031)";
const MFG = "oklch(0.704 0.04 256.788)";
const PRIMARY = "oklch(0.929 0.013 255.508)";
const PRIMARY_FG = "oklch(0.208 0.042 265.755)";
const DESTR = "oklch(0.704 0.191 22.216)";
const BORDER = "oklch(1 0 0 / 10%)";
const INPUT = "oklch(1 0 0 / 15%)";
const RING = "oklch(0.551 0.027 264.364)";

// Familia de acentos derivada: mesma luminosidade e croma, so o matiz muda.
const A_NEUTRAL = MFG;
const A_BLUE = "oklch(0.72 0.13 250)";
const A_VIOLET = "oklch(0.72 0.13 305)";
const A_AMBER = "oklch(0.72 0.13 75)";

const SANS =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SERIF =
  "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
const MONO = "ui-monospace, SFMono-Regular, 'Cascadia Code', Consolas, monospace";

const SHADOW_SM = "0 1px 2px 0 rgb(0 0 0 / 0.28)";
const SHADOW_XS = "0 1px 2px 0 rgb(0 0 0 / 0.22)";

const RARITY = {
  Comum: A_NEUTRAL,
  Rara: A_BLUE,
  "Épica": A_VIOLET,
  "Lendária": A_AMBER,
};

/* ------------------------------------------------------------------- icons */
const P = {
  "layout-dashboard":
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  inbox:
    '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  "list-checks":
    '<path d="M11 6h9"/><path d="M11 12h9"/><path d="M11 18h9"/><path d="m3 5 1.5 1.5L7 4"/><path d="m3 11 1.5 1.5L7 10"/><path d="m3 17 1.5 1.5L7 16"/>',
  "circle-play":
    '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
  "book-open":
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  package:
    '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  "wand-sparkles":
    '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
  trophy:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  lock:
    '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  "shield-alert":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  bug:
    '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  target:
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  compass:
    '<path d="m16.24 7.76-1.8 5.41a2 2 0 0 1-1.27 1.27l-5.41 1.8 1.8-5.41a2 2 0 0 1 1.27-1.27z"/><circle cx="12" cy="12" r="10"/>',
  wrench:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  flag:
    '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V15"/>',
  "flag-off":
    '<path d="M8 2c3 0 5 2 8 2 2 0 4-1 4-1v11"/><path d="M4 22V4"/><path d="M4 15s1-1 4-1 5 2 8 2"/><path d="m2 2 20 20"/>',
  swords:
    '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  "shield-check":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  container:
    '<path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z"/><path d="M10 21.9V14L2.1 9.1"/><path d="m10 14 11.9-6.9"/><path d="M14 19.8v-8.1"/><path d="M18 17.5V9.4"/>',
  "rotate-ccw":
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  stamp:
    '<path d="M5 22h14"/><path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3 3 3 0 0 0-3 3c0 2 1 2 1 3.5V13"/>',
  "thumbs-down":
    '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  map:
    '<path d="M14.1 5.55a2 2 0 0 0 1.79 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.56 2.27a2 2 0 0 1-1.79 0l-4.21-2.1a2 2 0 0 0-1.79 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9l4.56-2.27a2 2 0 0 1 1.79 0z"/><path d="M15 5.76v15"/><path d="M9 3.24v15"/>',
  hourglass:
    '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.41L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.41L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  "folder-plus":
    '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  "help-circle":
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  "git-branch":
    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  die: '<path d="M12 2.5 3.5 7.25v9.5L12 21.5l8.5-4.75v-9.5z"/><path d="M12 8.5 7.5 15.5h9z"/>',
  "corner-down-left": '<path d="m9 10-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
};

function icon(name, size = 16, style = "", sw = 2) {
  return (
    '<svg width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
    sw +
    '" stroke-linecap="round" stroke-linejoin="round" style="' +
    style +
    '">' +
    P[name] +
    "</svg>"
  );
}

/* -------------------------------------------------------------- primitives */
const row = (extra = "") => "display: flex; align-items: center; " + extra;
const col = (extra = "") => "display: flex; flex-direction: column; " + extra;

const card = (extra = "") =>
  "background: " +
  CARD +
  "; border: 1px solid " +
  BORDER +
  "; border-radius: 14px; box-shadow: " +
  SHADOW_SM +
  "; " +
  extra;

function btn(variant, size, extra = "") {
  const sizes = {
    default: "height: 36px; padding: 0 16px; font-size: 14px; gap: 8px;",
    sm: "height: 32px; padding: 0 12px; font-size: 14px; gap: 6px;",
    xs: "height: 24px; padding: 0 8px; font-size: 12px; gap: 4px;",
  };
  const variants = {
    default:
      "background: " + PRIMARY + "; color: " + PRIMARY_FG + "; border: 1px solid transparent;",
    outline:
      "background: oklch(1 0 0 / 0.045); color: " +
      FG +
      "; border: 1px solid " +
      INPUT +
      "; box-shadow: " +
      SHADOW_XS +
      ";",
    ghost: "background: transparent; color: " + MFG + "; border: 1px solid transparent;",
  };
  return (
    "display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; border-radius: 8px; font-weight: 500; " +
    sizes[size] +
    " " +
    variants[variant] +
    " " +
    extra
  );
}

const inputStyle = (extra = "") =>
  "height: 36px; border-radius: 8px; border: 1px solid " +
  INPUT +
  "; background: oklch(1 0 0 / 0.045); padding: 0 12px; font-size: 14px; color: " +
  FG +
  "; display: flex; align-items: center; gap: 8px; " +
  extra;

function select(label, value, width) {
  const filled = value !== null;
  return (
    '<div style="' +
    inputStyle("width: " + width + "px; justify-content: space-between; padding-right: 8px;") +
    '">' +
    '<span style="font-size: 14px; color: ' +
    (filled ? FG : MFG) +
    '">' +
    (filled ? value : label) +
    "</span>" +
    '<span style="color: ' +
    MFG +
    '; display: flex">' +
    icon("chevron-down", 16) +
    "</span>" +
    "</div>"
  );
}

function chip(text, iconName, color, extra = "") {
  return (
    '<span style="display: inline-flex; width: fit-content; ' +
    row(
      "gap: 6px; height: 22px; padding: 0 8px; border-radius: 8px; border: 1px solid " +
        BORDER +
        "; background: oklch(1 0 0 / 0.04); font-size: 12px; color: " +
        (color || FG) +
        "; white-space: nowrap; display: inline-flex; width: fit-content; " +
        extra,
    ) +
    '">' +
    (iconName
      ? '<span style="color: ' + MFG + '; display: flex">' + icon(iconName, 13, "", 1.5) + "</span>"
      : "") +
    "<span>" +
    text +
    "</span></span>"
  );
}

function dotChip(text, color, dim) {
  return (
    '<span style="display: inline-flex; width: fit-content; ' +
    row(
      "gap: 6px; height: 22px; padding: 0 8px; border-radius: 8px; border: 1px solid " +
        BORDER +
        "; background: oklch(1 0 0 / 0.04); font-size: 12px; color: " +
        (dim ? MFG : FG) +
        "; white-space: nowrap; display: inline-flex; width: fit-content;",
    ) +
    '">' +
    '<span style="width: 6px; height: 6px; border-radius: 999px; background: ' +
    color +
    '; flex: none"></span><span>' +
    text +
    "</span></span>"
  );
}

const KINDS = {
  BUG: { icon: "bug", dnd: "Monstro", plain: "Bug" },
  FEATURE: { icon: "target", dnd: "Missão", plain: "Funcionalidade" },
  RESEARCH: { icon: "compass", dnd: "Exploração", plain: "Pesquisa" },
  CHORE: { icon: "wrench", dnd: "Manutenção", plain: "Manutenção" },
};

// Estados de Task da Fase 1. Nao ha labels no glossario para eles: sao os
// mesmos textos nos dois modos.
const STATUS = {
  READY: { label: "Pronta", color: A_BLUE, dim: false },
  QUEUED: { label: "Na fila", color: A_NEUTRAL, dim: true },
  WAITING: { label: "Aguardando", color: A_AMBER, dim: false },
  BLOCKED: { label: "Bloqueada", color: DESTR, dim: false },
  COMPLETED: { label: "Concluída", color: RING, dim: true },
};

const PRIORITY = {
  Urgente: DESTR,
  Alta: FG,
  "Média": MFG,
  Baixa: MFG,
};

/* ------------------------------------------------------------------ shell */
const NAV = [
  { icon: "layout-dashboard", dnd: "Mesa do Mestre", plain: "Painel" },
  { icon: "inbox", dnd: "Quadro de Missões", plain: "Caixa de entrada" },
  { icon: "folder", dnd: "Campanhas", plain: "Projetos" },
  { icon: "list-checks", dnd: "Missões", plain: "Tarefas" },
  { icon: "circle-play", dnd: "Expedições", plain: "Execuções" },
  { sep: true },
  { icon: "book-open", dnd: "Grimório", plain: "Conhecimento" },
  { icon: "users", dnd: "Heróis", plain: "Agentes" },
  { icon: "package", dnd: "Equipamentos", plain: "Loadouts" },
  { icon: "wand-sparkles", dnd: "Rituais", plain: "Workflows" },
  { sep: true },
  { icon: "trophy", dnd: "Hall dos Heróis", plain: "Conquistas" },
  { icon: "settings", dnd: "Configurações", plain: "Configurações" },
];

function sidebar(theme, active) {
  const items = NAV.map((it) => {
    if (it.sep)
      return '<div style="height: 1px; background: ' + BORDER + '; margin: 8px 4px"></div>';
    const label = it[theme];
    const on = label === active;
    return (
      '<div style="' +
      row(
        "gap: 10px; height: 34px; padding: 0 10px; border-radius: 8px; font-size: 14px; " +
          (on
            ? "background: " + MUTED + "; color: " + FG + "; font-weight: 500;"
            : "color: " + MFG + ";"),
      ) +
      '">' +
      '<span style="display: flex; flex: none; ' +
      (on ? "" : "opacity: .85") +
      '">' +
      icon(it.icon, 16) +
      "</span><span>" +
      label +
      "</span></div>"
    );
  }).join("");

  return (
    '<aside style="' +
    col(
      "width: 248px; flex: none; background: " +
        CARD +
        "; border-right: 1px solid " +
        BORDER +
        ";",
    ) +
    '">' +
    '<div style="' +
    row("gap: 10px; height: 56px; padding: 0 16px; border-bottom: 1px solid " + BORDER + ";") +
    '">' +
    '<span style="display: flex; color: ' +
    FG +
    '">' +
    icon("die", 20, "", 1.6) +
    "</span>" +
    '<span style="font-size: 15px; font-weight: 600; letter-spacing: -0.01em">Dungeon Master</span>' +
    "</div>" +
    '<nav style="' +
    col("gap: 2px; padding: 12px 12px; flex: 1") +
    '">' +
    items +
    "</nav>" +
    '<div style="padding: 12px 16px; border-top: 1px solid ' +
    BORDER +
    '; font-size: 11px; color: ' +
    MFG +
    '">Dungeon Master 0.4.0 · Fase 1</div>' +
    "</aside>"
  );
}

function topbar(theme) {
  const placeholder =
    theme === "dnd"
      ? "Buscar Missões, Campanhas, Heróis…"
      : "Buscar tarefas, projetos, agentes…";
  const user = theme === "dnd" ? "Mestre da Guilda" : "Você";
  const initials = theme === "dnd" ? "MG" : "V";
  return (
    '<header style="' +
    row(
      "height: 56px; flex: none; padding: 0 24px; gap: 16px; border-bottom: 1px solid " +
        BORDER +
        "; background: " +
        BG +
        ";",
    ) +
    '">' +
    '<div style="' +
    inputStyle("width: 420px; justify-content: space-between; cursor: text;") +
    '">' +
    '<span style="' +
    row("gap: 8px; color: " + MFG) +
    '">' +
    icon("search", 16) +
    '<span style="font-size: 14px">' +
    placeholder +
    "</span></span>" +
    '<span style="' +
    row(
      "height: 20px; padding: 0 6px; border-radius: 6px; border: 1px solid " +
        BORDER +
        "; background: oklch(1 0 0 / 0.06); font-family: " +
        MONO +
        "; font-size: 11px; color: " +
        MFG +
        ";",
    ) +
    '">⌘K</span>' +
    "</div>" +
    '<div style="flex: 1"></div>' +
    '<div style="' +
    row(
      "gap: 8px; height: 36px; padding: 0 8px 0 6px; border-radius: 8px; border: 1px solid " +
        BORDER +
        "; background: oklch(1 0 0 / 0.03);",
    ) +
    '">' +
    '<span style="' +
    row(
      "justify-content: center; width: 24px; height: 24px; border-radius: 999px; background: " +
        MUTED +
        "; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; color: " +
        FG +
        ";",
    ) +
    '">' +
    initials +
    "</span>" +
    '<span style="font-size: 14px; font-weight: 500">' +
    user +
    "</span>" +
    '<span style="color: ' +
    MFG +
    '; display: flex">' +
    icon("chevron-down", 16) +
    "</span></div>" +
    "</header>"
  );
}

function pageHeader(theme, title, subtitle, right) {
  const font = theme === "dnd" ? SERIF : SANS;
  const tracking = theme === "dnd" ? "0" : "-0.02em";
  return (
    '<div style="' +
    row("justify-content: space-between; align-items: flex-end; gap: 24px") +
    '">' +
    '<div style="' +
    col("gap: 6px") +
    '">' +
    '<h1 style="margin: 0; font-family: ' +
    font +
    "; font-size: 30px; line-height: 36px; font-weight: 600; letter-spacing: " +
    tracking +
    '; color: ' +
    FG +
    '">' +
    title +
    "</h1>" +
    (subtitle
      ? '<p style="margin: 0; font-size: 14px; line-height: 20px; color: ' +
        MFG +
        '">' +
        subtitle +
        "</p>"
      : "") +
    "</div>" +
    (right || "") +
    "</div>"
  );
}

/* ----------------------------------------------------------------- file IO */
function write(name, w, h, body, extraCss = "") {
  const html =
    "<!doctype html>\n" +
    "<html>\n<head>\n  <meta charset=\"utf-8\">\n  <script src=\"./support.js\"></script>\n</head>\n<body>\n" +
    "<x-dc>\n<helmet>\n  <link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap\">\n" +
    "  <style>\n" +
    "    *, *::before, *::after { box-sizing: border-box; }\n" +
    "    body { margin: 0; background: " +
    BG +
    "; color: " +
    FG +
    "; font-family: " +
    SANS +
    "; -webkit-font-smoothing: antialiased; }\n" +
    "    a { color: " +
    A_BLUE +
    "; text-decoration: none; }\n" +
    "    a:hover { color: oklch(0.8 0.13 250); text-decoration: underline; }\n" +
    extraCss +
    "  </style>\n</helmet>\n" +
    body +
    "\n</x-dc>\n" +
    "<script data-dc-script data-props='{\"$preview\":{\"width\":" +
    w +
    ',"height":' +
    h +
    "}}'>\nclass Component extends DCLogic {}\n</script>\n</body>\n</html>\n";
  writeFileSync(join(OUT, name), html, "utf8");
  return name;
}

function frame(w, h, inner) {
  return (
    '<div style="' +
    row(
      "width: " +
        w +
        "px; height: " +
        h +
        "px; overflow: hidden; background: " +
        BG +
        "; color: " +
        FG +
        "; align-items: stretch;",
    ) +
    '">' +
    inner +
    "</div>"
  );
}

function screen(theme, active, w, h, content) {
  return frame(
    w,
    h,
    sidebar(theme, active) +
      '<div style="' +
      col("flex: 1; min-width: 0") +
      '">' +
      topbar(theme) +
      '<main style="' +
      col("flex: 1; min-height: 0; gap: 24px; padding: 28px 32px") +
      '">' +
      content +
      "</main></div>",
  );
}

/* ============================================================== ARTBOARD 1 */
const inboxItems = [
  ["ver por que a autenticação quebra no módulo X", "capturado agora"],
  ["o worker não responde ao Ctrl+C no Windows", "há 2 h"],
  ["documentar como rodar o embedded-postgres nos testes", "há 5 h"],
  ["trocar o glossário sem recarregar a página", "ontem"],
  ["checar se o cliente OpenAPI regenerou depois do último contrato", "ontem"],
  ["avaliar o Antigravity CLI em modo headless", "há 3 dias"],
];

function buildMain() {
  const capture =
    '<section style="' +
    card(col("gap: 12px; padding: 20px")) +
    '">' +
    '<div style="' +
    row("gap: 12px") +
    '">' +
    '<div style="' +
    inputStyle("flex: 1; height: 40px; font-size: 15px;") +
    '">' +
    '<span style="font-size: 15px; color: ' +
    FG +
    '">ver por que a autenticação quebra no módulo X</span>' +
    '<span style="width: 1.5px; height: 18px; background: ' +
    FG +
    '; margin-left: 1px"></span>' +
    "</div>" +
    '<button style="' +
    btn("default", "default", "height: 40px") +
    '">Capturar</button>' +
    "</div>" +
    '<div style="' +
    row("gap: 8px; color: " + MFG) +
    '">' +
    icon("corner-down-left", 14) +
    '<span style="font-size: 12px">Enter captura. Sem Campanha, sem tipo, sem prioridade — isso vem quando virar Missão.</span>' +
    "</div>" +
    "</section>";

  const rows = inboxItems
    .map(
      (it, i) =>
        '<div style="' +
        row(
          "gap: 16px; padding: 13px 20px; " +
            (i === 0 ? "" : "border-top: 1px solid " + BORDER + ";"),
        ) +
        '">' +
        '<div style="' +
        col("gap: 3px; flex: 1; min-width: 0") +
        '">' +
        '<span style="font-size: 14px; line-height: 20px; color: ' +
        FG +
        '">' +
        it[0] +
        "</span>" +
        '<span style="font-size: 12px; line-height: 16px; color: ' +
        MFG +
        '">' +
        it[1] +
        "</span></div>" +
        '<div style="' +
        row("gap: 8px; flex: none") +
        '">' +
        '<button style="' +
        btn("outline", "sm") +
        '">Virar Missão</button>' +
        '<button style="' +
        btn("ghost", "sm") +
        '">Descartar</button>' +
        "</div></div>",
    )
    .join("");

  const list =
    '<section style="' +
    card(col("overflow: hidden")) +
    '">' +
    '<div style="' +
    row(
      "justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid " + BORDER + ";",
    ) +
    '">' +
    '<span style="font-size: 14px; font-weight: 500">6 itens capturados</span>' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '">Mais recentes primeiro</span>' +
    "</div>" +
    rows +
    "</section>";

  return write(
    "Main.dc.html",
    1440,
    900,
    screen(
      "dnd",
      "Quadro de Missões",
      1440,
      900,
      pageHeader(
        "dnd",
        "Quadro de Missões",
        "Capture agora, decida depois. Nada aqui é uma Missão até você dizer que é.",
      ) +
        capture +
        list,
    ),
  );
}

/* ============================================================== ARTBOARD 2 */
const TASK_ROWS = [
  [
    "Worker não encerra a árvore de processos no Windows",
    "BUG",
    "Dungeon Master",
    "READY",
    "Urgente",
    "há 6 min",
  ],
  [
    "Trocar o glossário sem recarregar a página",
    "FEATURE",
    "Dungeon Master",
    "READY",
    "Alta",
    "há 1 h",
  ],
  [
    "Sessão do harness não é reaproveitada ao retomar",
    "BUG",
    "Dungeon Master",
    "BLOCKED",
    "Alta",
    "há 3 h",
  ],
  [
    "Avaliar o Antigravity CLI em modo headless",
    "RESEARCH",
    "Referências técnicas",
    "QUEUED",
    "Média",
    "há 5 h",
  ],
  [
    "Migrar os testes para embedded-postgres",
    "CHORE",
    "Dungeon Master",
    "COMPLETED",
    "Média",
    "ontem",
  ],
  [
    "Catálogo de Conquistas visível desde o início",
    "FEATURE",
    "Dungeon Master",
    "QUEUED",
    "Alta",
    "ontem",
  ],
  [
    "Badge de ambiente sempre visível no cockpit",
    "FEATURE",
    "Dungeon Master",
    "READY",
    "Urgente",
    "ontem",
  ],
  [
    "openapi.json desatualizado depois do último contrato",
    "BUG",
    "Dungeon Master",
    "WAITING",
    "Alta",
    "há 2 dias",
  ],
  [
    "Comparar Sandcastle e execução direta por spawn",
    "RESEARCH",
    "Referências técnicas",
    "WAITING",
    "Baixa",
    "há 2 dias",
  ],
  [
    "Fixar versões exatas em todos os package.json",
    "CHORE",
    "Dungeon Master",
    "COMPLETED",
    "Baixa",
    "há 3 dias",
  ],
];

const COLS = [468, 128, 176, 152, 104, 100];

function tasksScreen(theme) {
  const t = theme === "dnd";
  const title = t ? "Missões" : "Tarefas";
  const newLabel = t ? "Nova Missão" : "Nova Tarefa";
  const projectCol = t ? "Campanha" : "Projeto";
  const subtitle = t
    ? "Tudo que os Heróis podem receber. Filtre por Campanha, tipo, status e prioridade."
    : "Tudo que os agentes podem receber. Filtre por projeto, tipo, status e prioridade.";

  const action =
    '<button style="' +
    btn("default", "default") +
    '">' +
    icon("plus", 16) +
    "<span>" +
    newLabel +
    "</span></button>";

  const filters =
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<div style="' +
    inputStyle("width: 260px; color: " + MFG) +
    '">' +
    icon("search", 16) +
    '<span style="font-size: 14px; color: ' +
    MFG +
    '">Buscar por título</span></div>' +
    select(projectCol, "Dungeon Master", 190) +
    select("Tipo", null, 140) +
    select("Status", null, 140) +
    select("Prioridade", null, 150) +
    '<button style="' +
    btn("ghost", "sm") +
    '">' +
    icon("x", 14) +
    "<span>Limpar</span></button>" +
    '<div style="flex: 1"></div>' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '; align-self: center">24 ' +
    (t ? "Missões" : "Tarefas") +
    "</span></div>";

  const head =
    '<div style="' +
    row("height: 40px; border-bottom: 1px solid " + BORDER + "; padding: 0 16px; gap: 16px") +
    '">' +
    ["Título", "Tipo", projectCol, "Status", "Prioridade", "Atualizada"]
      .map(
        (c, i) =>
          '<span style="width: ' +
          (i === 0 ? "auto; flex: 1" : COLS[i] + "px; flex: none") +
          '; font-size: 12px; font-weight: 500; color: ' +
          MFG +
          '">' +
          c +
          "</span>",
      )
      .join("") +
    "</div>";

  const body = TASK_ROWS.map((r) => {
    const k = KINDS[r[1]];
    const s = STATUS[r[3]];
    return (
      '<div style="' +
      row(
        "height: 48px; border-bottom: 1px solid " +
          BORDER +
          "; padding: 0 16px; gap: 16px; font-size: 14px",
      ) +
      '">' +
      '<span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ' +
      FG +
      '">' +
      r[0] +
      "</span>" +
      '<span style="width: ' +
      COLS[1] +
      'px; flex: none">' +
      chip(k[theme], k.icon) +
      "</span>" +
      '<span style="width: ' +
      COLS[2] +
      "px; flex: none; color: " +
      MFG +
      '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
      r[2] +
      "</span>" +
      '<span style="width: ' +
      COLS[3] +
      'px; flex: none">' +
      dotChip(s.label, s.color, s.dim) +
      "</span>" +
      '<span style="width: ' +
      COLS[4] +
      "px; flex: none; color: " +
      PRIORITY[r[4]] +
      '">' +
      r[4] +
      "</span>" +
      '<span style="width: ' +
      COLS[5] +
      "px; flex: none; color: " +
      MFG +
      '">' +
      r[5] +
      "</span></div>"
    );
  }).join("");

  const footer =
    '<div style="' +
    row("justify-content: space-between; padding: 12px 16px") +
    '">' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '">Mostrando 1–10 de 24</span>' +
    '<div style="' +
    row("gap: 6px") +
    '">' +
    '<button style="' +
    btn("outline", "sm", "opacity: .5") +
    '">Anterior</button>' +
    '<button style="' +
    btn("default", "sm", "width: 32px; padding: 0") +
    '">1</button>' +
    '<button style="' +
    btn("ghost", "sm", "width: 32px; padding: 0") +
    '">2</button>' +
    '<button style="' +
    btn("ghost", "sm", "width: 32px; padding: 0") +
    '">3</button>' +
    '<button style="' +
    btn("outline", "sm") +
    '">Próxima</button>' +
    "</div></div>";

  const table =
    '<section style="' + card(col("overflow: hidden")) + '">' + head + body + footer + "</section>";

  return screen(
    theme,
    t ? "Missões" : "Tarefas",
    1440,
    900,
    pageHeader(theme, title, subtitle, action) +
      '<div style="' +
      col("gap: 16px") +
      '">' +
      filters +
      table +
      "</div>",
  );
}

/* ============================================================== ARTBOARD 3 */
function buildMissao() {
  const breadcrumb =
    '<div style="' +
    row("gap: 6px; font-size: 12px; color: " + MFG) +
    '"><span>Missões</span>' +
    icon("chevron-right", 12) +
    "<span>Dungeon Master</span>" +
    icon("chevron-right", 12) +
    '<span style="color: ' +
    FG +
    '">Worker não encerra a árvore de processos no Windows</span></div>';

  const titleRow =
    '<div style="' +
    row("justify-content: space-between; align-items: flex-start; gap: 24px") +
    '">' +
    '<div style="' +
    col("gap: 10px") +
    '">' +
    '<h1 style="margin: 0; font-family: ' +
    SERIF +
    "; font-size: 30px; line-height: 38px; font-weight: 600; max-width: 720px; color: " +
    FG +
    '">Worker não encerra a árvore de processos no Windows</h1>' +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    chip("Monstro", "bug") +
    dotChip("Pronta", A_BLUE, false) +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '; align-self: center">Atualizada há 6 min</span></div></div>' +
    '<button style="' +
    btn("outline", "sm") +
    '">Editar</button></div>';

  const codeSpan = (s) =>
    '<code style="font-family: ' +
    MONO +
    "; font-size: 12px; background: oklch(1 0 0 / 0.07); border: 1px solid " +
    BORDER +
    "; border-radius: 6px; padding: 1px 5px; color: " +
    FG +
    '">' +
    s +
    "</code>";

  const desc =
    '<section style="' +
    card(col("gap: 10px; padding: 20px")) +
    '">' +
    '<span style="font-size: 14px; font-weight: 500">Descrição</span>' +
    '<p style="margin: 0; font-size: 14px; line-height: 22px; color: ' +
    MFG +
    '">No Windows, ' +
    codeSpan("taskkill") +
    " devolve código de saída 0 mesmo quando um filho continua vivo. A Expedição fica em " +
    codeSpan("RUNNING") +
    " até o timeout e a trava de worktree nunca é liberada.</p>" +
    '<p style="margin: 0; font-size: 14px; line-height: 22px; color: ' +
    MFG +
    '">Reproduzir: subir o worker, disparar uma Expedição em Campo aberto, cancelar pelo cockpit e conferir a árvore com ' +
    codeSpan("Get-CimInstance Win32_Process") +
    ".</p>" +
    '<p style="margin: 0; font-size: 14px; line-height: 22px; color: ' +
    MFG +
    '">Esperado: confirmar o término por polling antes de marcar a Expedição como Retirada, e liberar a trava no ' +
    codeSpan("finally") +
    ".</p></section>";

  const steps = [
    [true, "Isolar o comportamento do taskkill em um teste de plataforma"],
    [false, "Confirmar término por polling em packages/platform"],
    [false, "Liberar a trava de worktree no finally"],
  ]
    .map(
      (s) =>
        '<div style="' +
        row("gap: 10px; padding: 9px 0") +
        '">' +
        '<span style="' +
        row(
          "justify-content: center; width: 16px; height: 16px; flex: none; border-radius: 5px; border: 1px solid " +
            (s[0] ? "transparent" : INPUT) +
            "; background: " +
            (s[0] ? PRIMARY : "transparent") +
            "; color: " +
            PRIMARY_FG +
            ";",
        ) +
        '">' +
        (s[0] ? icon("check", 11, "", 3) : "") +
        "</span>" +
        '<span style="font-size: 14px; color: ' +
        (s[0] ? MFG : FG) +
        (s[0] ? "; text-decoration: line-through" : "") +
        '">' +
        s[1] +
        "</span></div>",
    )
    .join("");

  const stepsCard =
    '<section style="' +
    card(col("gap: 4px; padding: 20px")) +
    '">' +
    '<div style="' +
    row("justify-content: space-between; margin-bottom: 6px") +
    '">' +
    '<span style="font-size: 14px; font-weight: 500">Etapas da missão</span>' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '">1 de 3</span></div>' +
    steps +
    "</section>";

  const tab = (label, on) =>
    '<span style="' +
    row(
      "height: 30px; padding: 0 12px; border-radius: 8px; font-size: 14px; font-weight: 500; " +
        (on
          ? "background: oklch(1 0 0 / 0.10); color: " + FG + "; box-shadow: " + SHADOW_XS + ";"
          : "color: " + MFG + ";"),
    ) +
    '">' +
    label +
    "</span>";

  const empty =
    '<div style="' +
    col("align-items: center; justify-content: center; gap: 10px; padding: 40px 24px 44px") +
    '">' +
    '<span style="' +
    row(
      "justify-content: center; width: 44px; height: 44px; border-radius: 999px; border: 1px dashed " +
        INPUT +
        "; color: " +
        MFG +
        ";",
    ) +
    '">' +
    icon("circle-play", 20) +
    "</span>" +
    '<span style="font-size: 14px; font-weight: 500">Nenhuma Expedição ainda</span>' +
    '<p style="margin: 0; max-width: 460px; text-align: center; font-size: 13px; line-height: 20px; color: ' +
    MFG +
    '">A execução chega na Fase 2. Por enquanto esta Missão é planejada e acompanhada à mão; quando o runtime existir, cada tentativa aparece aqui com o seu Diário da Expedição.</p></div>';

  const tabsCard =
    '<section style="' +
    card(col("overflow: hidden")) +
    '">' +
    '<div style="' +
    row("gap: 4px; padding: 10px 12px; border-bottom: 1px solid " + BORDER + ";") +
    '">' +
    tab("Expedições", true) +
    tab("Espólios", false) +
    "</div>" +
    empty +
    "</section>";

  const metaRow = (label, value) =>
    '<div style="' +
    row("justify-content: space-between; gap: 16px; padding: 8px 0") +
    '">' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '">' +
    label +
    "</span>" +
    '<span style="font-size: 14px; text-align: right">' +
    value +
    "</span></div>";

  const details =
    '<section style="' +
    card(col("padding: 16px 20px 18px")) +
    '">' +
    '<span style="font-size: 14px; font-weight: 500; padding-bottom: 8px">Detalhes</span>' +
    metaRow("Campanha", "Dungeon Master") +
    metaRow("Tipo", chip("Monstro", "bug")) +
    metaRow("Status", dotChip("Pronta", A_BLUE, false)) +
    metaRow("Prioridade", '<span style="color: ' + DESTR + '">Urgente</span>') +
    metaRow("Etapas da missão", "1 de 3") +
    metaRow("Dependências", "1 entrada · 1 saída") +
    metaRow("Criada", "05/09/2026") +
    "</section>";

  const depRow = (label, title, kindIcon, status) =>
    '<div style="' +
    col("gap: 6px; padding: 10px 0") +
    '">' +
    '<span style="font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: ' +
    MFG +
    '">' +
    label +
    "</span>" +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex; flex: none; margin-top: 2px">' +
    icon(kindIcon, 14) +
    "</span>" +
    '<span style="font-size: 13px; line-height: 18px; flex: 1">' +
    title +
    "</span></div>" +
    '<div style="margin-left: 22px">' +
    status +
    "</div></div>";

  const deps =
    '<section style="' +
    card(col("padding: 16px 20px 18px")) +
    '">' +
    '<div style="' +
    row("gap: 8px; padding-bottom: 4px") +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex">' +
    icon("git-branch", 14) +
    "</span>" +
    '<span style="font-size: 14px; font-weight: 500">Dependências</span></div>' +
    depRow(
      "Depende de",
      "Fixar versões exatas em todos os package.json",
      "wrench",
      dotChip("Concluída", RING, true),
    ) +
    '<div style="height: 1px; background: ' +
    BORDER +
    '"></div>' +
    depRow(
      "Bloqueia",
      "Badge de ambiente sempre visível no cockpit",
      "target",
      dotChip("Pronta", A_BLUE, false),
    ) +
    "</section>";

  const env =
    '<section style="' +
    card(col("gap: 10px; padding: 16px 20px 18px")) +
    '">' +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<span style="color: ' +
    DESTR +
    '; display: flex">' +
    icon("shield-alert", 14) +
    "</span>" +
    '<span style="font-size: 14px; font-weight: 500">Ambiente</span></div>' +
    '<div style="' +
    row("gap: 8px; flex-wrap: wrap") +
    '">' +
    '<span style="font-size: 16px; font-weight: 500">Campo aberto</span>' +
    '<span style="font-size: 16px; color: ' +
    MFG +
    '">·</span>' +
    '<span style="font-size: 16px; color: ' +
    DESTR +
    '">sem isolamento</span></div>' +
    '<span style="' +
    row(
      "align-self: flex-start; height: 22px; padding: 0 8px; border-radius: 6px; border: 1px solid oklch(0.704 0.191 22.216 / 40%); background: oklch(0.704 0.191 22.216 / 12%); font-family: " +
        MONO +
        "; font-size: 11px; letter-spacing: 0.04em; color: " +
        DESTR +
        ";",
    ) +
    '">HOST · UNISOLATED</span>' +
    '<p style="margin: 0; font-size: 12px; line-height: 18px; color: ' +
    MFG +
    '">O Herói roda direto na sua máquina, com acesso ao disco e à rede do host. A alternativa isolada é a Masmorra selada (DOCKER · ISOLATED), que chega na Fase 2.</p></section>';

  const content =
    '<div style="' +
    col("gap: 10px") +
    '">' +
    breadcrumb +
    titleRow +
    "</div>" +
    '<div style="display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start">' +
    '<div style="' +
    col("gap: 16px") +
    '">' +
    desc +
    stepsCard +
    tabsCard +
    "</div>" +
    '<div style="' +
    col("gap: 16px") +
    '">' +
    details +
    deps +
    env +
    "</div></div>";

  return write("Missao.dc.html", 1440, 1030, screen("dnd", "Missões", 1440, 1030, content));
}

/* ============================================================== ARTBOARD 4 */
const CATALOG = [
  ["flag", "Primeira Expedição", "Comum", "Voltar vitorioso da primeira Expedição.", null],
  [
    "swords",
    "Caçador de Monstros I",
    "Comum",
    "Derrotar Monstros e devolver a paz à Campanha.",
    ["Comum", "Rara", "Épica"],
  ],
  [
    "shield-check",
    "Sem Baixas",
    "Rara",
    "Encadear dez Expedições vitoriosas, sem uma única derrota.",
    null,
  ],
  [
    "flag-off",
    "Retirada Tática",
    "Comum",
    "Interromper uma Expedição antes que ela cobrasse caro.",
    null,
  ],
  [
    "container",
    "Masmorra Selada",
    "Rara",
    "Vencer uma Expedição inteira dentro de uma Masmorra selada.",
    null,
  ],
  [
    "users",
    "Aliado das Quatro Guildas",
    "Épica",
    "Vencer ao menos uma Expedição com cada uma das quatro Guildas.",
    null,
  ],
  [
    "rotate-ccw",
    "Segundo Fôlego",
    "Rara",
    "Retomar uma Expedição interrompida e terminá-la em vitória.",
    null,
  ],
  [
    "stamp",
    "Selo da Guilda",
    "Comum",
    "Estampar o primeiro Selo da Guilda sobre o trabalho de um Herói.",
    null,
  ],
  ["thumbs-down", "Veto", "Comum", "Negar o Selo da Guilda quando o trabalho não estava pronto.", null],
  [
    "book-open",
    "Escriba do Grimório I",
    "Rara",
    "Promover Páginas do Grimório a partir do que as Expedições aprenderam.",
    ["Rara", "Épica", "Lendária"],
  ],
  [
    "wand-sparkles",
    "Ritualista",
    "Rara",
    "Conduzir uma Expedição vitoriosa seguindo um Ritual do começo ao fim.",
    null,
  ],
  ["map", "Cartógrafo", "Comum", "Desenhar a primeira ligação no Mapa da masmorra.", null],
  [
    "hourglass",
    "Marcha Longa",
    "Épica",
    "Sustentar a Expedição vitoriosa mais longa da Campanha, acima de uma hora.",
    null,
  ],
  ["moon", "Vigília Noturna", "Comum", "Vencer uma Expedição entre a meia-noite e o amanhecer.", null],
  [
    "folder-plus",
    "Fundador de Campanhas",
    "Comum",
    "Abrir cinco Campanhas e dar a cada uma o seu próprio Grimório.",
    null,
  ],
];

function medallion(iconName, size, dashed) {
  return (
    '<span style="' +
    row(
      "justify-content: center; width: " +
        size +
        "px; height: " +
        size +
        "px; flex: none; border-radius: 10px; border: 1px " +
        (dashed ? "dashed" : "solid") +
        " " +
        INPUT +
        "; background: oklch(1 0 0 / 0.03); color: " +
        MFG +
        "; opacity: .55;",
    ) +
    '">' +
    icon(iconName, Math.round(size * 0.5)) +
    "</span>"
  );
}

function rarityLabel(name) {
  return (
    '<span style="font-size: 10px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: ' +
    RARITY[name] +
    '">' +
    name +
    "</span>"
  );
}

function tierPips(tiers) {
  return (
    '<span style="' +
    row("gap: 4px") +
    '">' +
    tiers
      .map(
        (t) =>
          '<span style="width: 5px; height: 5px; border-radius: 999px; background: ' +
          RARITY[t] +
          '"></span>',
      )
      .join("") +
    '<span style="font-size: 11px; color: ' +
    MFG +
    '; margin-left: 2px">3 tiers</span></span>'
  );
}

function achievementCard(a, hidden) {
  const stateChip =
    '<span style="' +
    row("gap: 5px; font-size: 11px; color: " + MFG) +
    '">' +
    icon("lock", 11) +
    "<span>" +
    (hidden ? "Oculta" : "Bloqueada") +
    "</span></span>";
  const origin =
    '<span style="font-size: 11px; color: ' +
    MFG +
    '">' +
    (hidden ? "Da sua jornada" : "Do catálogo") +
    "</span>";
  return (
    '<article style="' +
    card(col("gap: 12px; padding: 16px; height: 100%")) +
    '">' +
    '<div style="' +
    row("justify-content: space-between; align-items: flex-start") +
    '">' +
    medallion(hidden ? "help-circle" : a[0], 36, true) +
    (hidden ? "" : rarityLabel(a[2])) +
    "</div>" +
    '<div style="' +
    col("gap: 5px; flex: 1") +
    '">' +
    '<h3 style="margin: 0; font-family: ' +
    SERIF +
    "; font-size: 16px; line-height: 22px; font-weight: 600; color: " +
    (hidden ? MFG : FG) +
    '">' +
    (hidden ? "???" : a[1]) +
    "</h3>" +
    '<p style="margin: 0; font-size: 12px; line-height: 18px; color: ' +
    MFG +
    '">' +
    (hidden
      ? "Esta Conquista se revela quando você chegar perto dela."
      : a[3]) +
    "</p></div>" +
    '<div style="' +
    row("justify-content: space-between; gap: 8px; padding-top: 2px") +
    '">' +
    stateChip +
    (a[4] && !hidden ? tierPips(a[4]) : origin) +
    "</div></article>"
  );
}

function buildHall() {
  const H = 1050;
  const tab = (label, on) =>
    '<span style="' +
    row(
      "height: 30px; padding: 0 12px; border-radius: 8px; font-size: 14px; font-weight: 500; " +
        (on
          ? "background: oklch(1 0 0 / 0.10); color: " + FG + "; box-shadow: " + SHADOW_XS + ";"
          : "color: " + MFG + ";"),
    ) +
    '">' +
    label +
    "</span>";

  const tabs =
    '<div style="' +
    row(
      "align-self: flex-start; gap: 4px; padding: 3px; border-radius: 10px; background: " +
        MUTED +
        ";",
    ) +
    '">' +
    tab("Conquistas", true) +
    tab("Heróis", false) +
    tab("Bestiário", false) +
    tab("Crônica", false) +
    "</div>";

  const progress =
    '<div style="' +
    col("gap: 8px; align-items: flex-end") +
    '">' +
    '<span style="font-size: 13px; color: ' +
    MFG +
    '"><span style="color: ' +
    FG +
    '; font-weight: 500">0 de 15</span> desbloqueadas</span>' +
    '<div style="width: 240px; height: 5px; border-radius: 999px; background: ' +
    MUTED +
    '"></div></div>';

  const filters =
    '<div style="' +
    row("gap: 8px") +
    '">' +
    select("Origem", null, 160) +
    select("Raridade", null, 160) +
    select("Estado", null, 160) +
    '<div style="flex: 1"></div>' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '; align-self: center">Modo catálogo · o progresso começa a contar na Fase 2</span></div>';

  const grid =
    '<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px">' +
    CATALOG.map((a) => achievementCard(a, false)).join("") +
    achievementCard(CATALOG[0], true) +
    "</div>";

  return write(
    "Hall.dc.html",
    1440,
    H,
    screen(
      "dnd",
      "Hall dos Heróis",
      1440,
      H,
      pageHeader(
        "dnd",
        "Hall dos Heróis",
        "O catálogo inteiro fica à vista desde o começo. Nada some, nada é surpresa — salvo o que for Oculta.",
        progress,
      ) +
        '<div style="' +
        col("gap: 16px") +
        '">' +
        tabs +
        filters +
        grid +
        "</div>",
    ),
  );
}

/* ============================================================== ARTBOARD 5 */
function buildConfig() {
  const sw =
    '<span style="' +
    row(
      "width: 36px; height: 20px; flex: none; border-radius: 999px; background: " +
        PRIMARY +
        "; padding: 2px; justify-content: flex-end;",
    ) +
    '">' +
    '<span style="width: 16px; height: 16px; border-radius: 999px; background: ' +
    PRIMARY_FG +
    '; box-shadow: ' +
    SHADOW_XS +
    '"></span></span>';

  const previewCell = (label, note, serif) =>
    '<div style="' +
    col("gap: 6px; flex: 1; align-items: center; padding: 4px 0") +
    '">' +
    '<span style="font-family: ' +
    (serif ? SERIF : SANS) +
    "; font-size: 20px; font-weight: 600; color: " +
    FG +
    '">' +
    label +
    "</span>" +
    '<span style="font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: ' +
    MFG +
    '">' +
    note +
    "</span></div>";

  const preview =
    '<div style="' +
    col("gap: 10px") +
    '">' +
    '<div style="' +
    row(
      "border: 1px solid " +
        BORDER +
        "; border-radius: 10px; background: oklch(1 0 0 / 0.03); padding: 16px 20px;",
    ) +
    '">' +
    previewCell("Missão", "Interruptor ligado", true) +
    '<span style="width: 1px; align-self: stretch; background: ' +
    BORDER +
    '"></span>' +
    previewCell("Tarefa", "Interruptor desligado", false) +
    "</div>" +
    '<span style="font-size: 12px; line-height: 18px; color: ' +
    MFG +
    '">O interruptor troca só texto. Rotas, URLs, ícones, layout e dados são idênticos nos dois modos, e a página não recarrega.</span></div>';

  const switchRow =
    '<div style="' +
    row("justify-content: space-between; gap: 32px; align-items: flex-start") +
    '">' +
    '<div style="' +
    col("gap: 4px") +
    '">' +
    '<span style="font-size: 14px; font-weight: 500">Tema Dungeon Master</span>' +
    '<span style="font-size: 13px; line-height: 20px; color: ' +
    MFG +
    '">Vocabulário de RPG na interface. Desligue para nomes neutros.</span></div>' +
    sw +
    "</div>";

  const hint =
    '<div style="' +
    row("gap: 8px; color: " + MFG) +
    '">' +
    icon("search", 14) +
    '<span style="font-size: 12px">Também na paleta de comandos: ⌘K e depois "tema".</span></div>';

  const appearance =
    '<section style="' +
    card(col("gap: 18px; padding: 24px; max-width: 760px")) +
    '">' +
    '<div style="' +
    col("gap: 4px") +
    '">' +
    '<span style="font-size: 16px; font-weight: 600">Aparência</span>' +
    '<span style="font-size: 13px; color: ' +
    MFG +
    '">Como o produto fala com você.</span></div>' +
    '<div style="height: 1px; background: ' +
    BORDER +
    '"></div>' +
    switchRow +
    preview +
    hint +
    "</section>";

  return write(
    "Configuracoes.dc.html",
    1440,
    900,
    screen(
      "dnd",
      "Configurações",
      1440,
      900,
      pageHeader(
        "dnd",
        "Configurações",
        "Preferências deste Mestre da Guilda. Aplicadas na hora, sem recarregar a página.",
      ) + appearance,
    ),
  );
}

/* ========================================================= ARTBOARDS 7 e 8 */
function sketchCard(a, opts) {
  const rc = RARITY[a[2]];
  const unlocked = opts.unlocked;
  const heraldic = opts.heraldic;

  const border = heraldic
    ? "1px solid " + rc.replace(")", unlocked ? " / 55%)" : " / 28%)")
    : "1px solid " + BORDER;
  const glow =
    heraldic && unlocked
      ? "box-shadow: 0 0 0 1px " +
        rc.replace(")", " / 18%)") +
        ", 0 10px 30px -12px " +
        rc.replace(")", " / 40%)") +
        ";"
      : "box-shadow: " + SHADOW_SM + ";";

  const med = heraldic
    ? '<span style="' +
      row(
        "justify-content: center; width: 44px; height: 44px; flex: none; border-radius: 999px; border: 1px solid " +
          rc.replace(")", " / 40%)") +
          "; background: " +
          rc.replace(")", " / 12%)") +
          "; color: " +
          (unlocked ? rc : MFG) +
          "; " +
          (unlocked ? "" : "opacity: .55;"),
      ) +
      '">' +
      icon(a[0], 22) +
      "</span>"
    : medallion(a[0], 40, !unlocked);

  const name =
    '<h3 style="margin: 0; font-family: ' +
    SERIF +
    "; font-size: 17px; line-height: 23px; font-weight: 600; color: " +
    FG +
    "; " +
    (heraldic ? "font-variant: small-caps; letter-spacing: 0.03em;" : "") +
    '">' +
    a[1] +
    "</h3>";

  const rarity = heraldic
    ? '<span style="' +
      row(
        "gap: 6px; height: 20px; padding: 0 8px; border-radius: 999px; border: 1px solid " +
          rc.replace(")", " / 45%)") +
          "; background: " +
          rc.replace(")", " / 12%)") +
          "; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: " +
          rc +
          ";",
      ) +
      '">' +
      a[2] +
      "</span>"
    : rarityLabel(a[2]);

  const state =
    '<span style="' +
    row("gap: 5px; font-size: 11px; color: " + MFG) +
    '">' +
    (unlocked ? icon("check", 11) : icon("lock", 11)) +
    "<span>" +
    (unlocked ? "Desbloqueada" : "Bloqueada") +
    "</span></span>";

  return (
    '<article style="' +
    col(
      "gap: 12px; width: 292px; padding: 18px; border-radius: 14px; background: " +
        CARD +
        "; border: " +
        border +
        "; " +
        glow,
    ) +
    '">' +
    '<div style="' +
    row("justify-content: space-between; align-items: flex-start") +
    '">' +
    med +
    rarity +
    "</div>" +
    '<div style="' +
    col("gap: 6px") +
    '">' +
    name +
    '<p style="margin: 0; font-size: 12px; line-height: 18px; color: ' +
    MFG +
    '">' +
    a[3] +
    "</p></div>" +
    '<div style="' +
    row("justify-content: space-between; gap: 8px") +
    '">' +
    state +
    '<span style="font-size: 11px; color: ' +
    MFG +
    '">Do catálogo</span></div></article>'
  );
}

function buildDirection(file, label, heading, note, tradeoff, heraldic) {
  const epic = CATALOG[5];
  const rare = CATALOG[2];
  const body =
    '<div style="' +
    col("width: 720px; height: 480px; gap: 20px; padding: 36px 44px; background: " + BG + ";") +
    '">' +
    '<div style="' +
    col("gap: 5px") +
    '">' +
    '<span style="font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ' +
    MFG +
    '">' +
    label +
    "</span>" +
    '<h2 style="margin: 0; font-family: ' +
    SERIF +
    "; font-size: 22px; line-height: 28px; font-weight: 600; color: " +
    FG +
    '">' +
    heading +
    "</h2></div>" +
    '<div style="' +
    row("gap: 24px; align-items: stretch") +
    '">' +
    sketchCard(epic, { unlocked: true, heraldic: heraldic }) +
    sketchCard(rare, { unlocked: false, heraldic: heraldic }) +
    "</div>" +
    '<div style="' +
    col("gap: 4px; margin-top: auto") +
    '">' +
    '<p style="margin: 0; font-size: 12px; line-height: 18px; color: ' +
    MFG +
    '"><span style="color: ' +
    FG +
    '">A favor.</span> ' +
    note +
    "</p>" +
    '<p style="margin: 0; font-size: 12px; line-height: 18px; color: ' +
    MFG +
    '"><span style="color: ' +
    FG +
    '">Custo.</span> ' +
    tradeoff +
    "</p></div></div>";
  return write(file, 720, 480, body);
}

/* ------------------------------------------------------------------ build */
const files = [];
files.push(buildMain());
files.push(write("Missoes.dc.html", 1440, 900, tasksScreen("dnd")));
files.push(buildMissao());
files.push(buildHall());
files.push(buildConfig());
files.push(write("MissoesSemTema.dc.html", 1440, 900, tasksScreen("plain")));
files.push(
  buildDirection(
    "DirecaoSobria.dc.html",
    "Opção A — Sóbria",
    "Raridade como rótulo",
    "A carta continua uma carta de control plane: mesma borda, mesma densidade das outras listas. A raridade informa sem competir com o conteúdo, e a serif no nome já carrega o toque.",
    "Quinze cartas bloqueadas ficam muito parecidas entre si; a raridade só se lê depois que você procura por ela.",
    false,
  ),
);
files.push(
  buildDirection(
    "DirecaoHeraldica.dc.html",
    "Opção B — Heráldica",
    "Raridade como moldura",
    "A raridade se lê à distância e uma Lendária desbloqueada vira um evento visual. O medalhão dá ao ícone o peso de brasão que a metáfora pede.",
    "Cor e brilho em cada carta puxam mais atenção que o resto do produto, e a grade fica ruidosa com muitas raridades altas lado a lado.",
    true,
  ),
);

console.log("artboards: " + files.join(", "));
