// Kit de estilo do canvas da Fase 2.
//
// Continuação direta do canvas da Fase 1: os tokens, os ícones, as primitivas
// e o shell são os mesmos de docs/design/fase1/build-artboards.mjs, lidos de
// apps/web/src/styles.css (bloco .dark) e dos componentes reais da web.
// O que é novo aqui está marcado com "Fase 2".

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const OUT = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ tokens */
export const BG = "oklch(0.129 0.042 264.695)";
export const FG = "oklch(0.984 0.003 247.858)";
export const CARD = "oklch(0.208 0.042 265.755)";
export const MUTED = "oklch(0.279 0.041 260.031)";
export const MFG = "oklch(0.704 0.04 256.788)";
export const PRIMARY = "oklch(0.929 0.013 255.508)";
export const PRIMARY_FG = "oklch(0.208 0.042 265.755)";
export const DESTR = "oklch(0.704 0.191 22.216)";
export const BORDER = "oklch(1 0 0 / 10%)";
export const INPUT = "oklch(1 0 0 / 15%)";
export const RING = "oklch(0.551 0.027 264.364)";

// Família de acentos derivada: mesma luminosidade e croma, só o matiz muda.
export const A_NEUTRAL = MFG;
export const A_BLUE = "oklch(0.72 0.13 250)";
export const A_VIOLET = "oklch(0.72 0.13 305)";
export const A_AMBER = "oklch(0.72 0.13 75)";
// Fase 2: a Vitória precisava de um matiz próprio, no mesmo eixo.
export const A_GREEN = "oklch(0.72 0.13 150)";

export const SANS =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const SERIF =
  "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
export const MONO = "ui-monospace, SFMono-Regular, 'Cascadia Code', Consolas, monospace";

export const SHADOW_SM = "0 1px 2px 0 rgb(0 0 0 / 0.28)";
export const SHADOW_XS = "0 1px 2px 0 rgb(0 0 0 / 0.22)";
export const SHADOW_LG = "0 24px 60px -20px rgb(0 0 0 / 0.65), 0 4px 14px -6px rgb(0 0 0 / 0.5)";

export const tint = (c, pct) => c.replace(")", " / " + pct + ")");

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
  minus: '<path d="M5 12h14"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  lock:
    '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  "shield-alert":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  "shield-check":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  "shield-half":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 22V2"/>',
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
  swords:
    '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  container:
    '<path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z"/><path d="M10 21.9V14L2.1 9.1"/><path d="m10 14 11.9-6.9"/><path d="M14 19.8v-8.1"/><path d="M18 17.5V9.4"/>',
  "rotate-ccw":
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  map:
    '<path d="M14.1 5.55a2 2 0 0 0 1.79 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.56 2.27a2 2 0 0 1-1.79 0l-4.21-2.1a2 2 0 0 0-1.79 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9l4.56-2.27a2 2 0 0 1 1.79 0z"/><path d="M15 5.76v15"/><path d="M9 3.24v15"/>',
  hourglass:
    '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.41L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.41L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  "help-circle":
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  "git-branch":
    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  die: '<path d="M12 2.5 3.5 7.25v9.5L12 21.5l8.5-4.75v-9.5z"/><path d="M12 8.5 7.5 15.5h9z"/>',
  "corner-down-left": '<path d="m9 10-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',

  /* ------------------------------------------------------------- Fase 2 */
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  "file-text":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  "square-pen":
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  activity:
    '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  quote:
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  "triangle-alert":
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  "circle-check-big": '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  "circle-x": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  "circle-dot": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  "circle-stop":
    '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  timer:
    '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  copy:
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  "folder-open":
    '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  "git-commit":
    '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  cpu:
    '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  sparkles:
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  eye:
    '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  "key-round":
    '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5"/>',
  "refresh-cw":
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  "external-link":
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  "sliders-horizontal":
    '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/>',
  "scroll-text":
    '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  "trash-2":
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
};

export function icon(name, size = 16, style = "", sw = 2) {
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
export const row = (extra = "") => "display: flex; align-items: center; " + extra;
export const col = (extra = "") => "display: flex; flex-direction: column; " + extra;

export const card = (extra = "") =>
  "background: " +
  CARD +
  "; border: 1px solid " +
  BORDER +
  "; border-radius: 14px; box-shadow: " +
  SHADOW_SM +
  "; " +
  extra;

export function btn(variant, size, extra = "") {
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
    // Fase 2: o Cancelar do cockpit e o descarte do worktree.
    destructive:
      "background: " +
      tint(DESTR, "14%") +
      "; color: " +
      DESTR +
      "; border: 1px solid " +
      tint(DESTR, "45%") +
      "; box-shadow: " +
      SHADOW_XS +
      ";",
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

export const inputStyle = (extra = "") =>
  "height: 36px; border-radius: 8px; border: 1px solid " +
  INPUT +
  "; background: oklch(1 0 0 / 0.045); padding: 0 12px; font-size: 14px; color: " +
  FG +
  "; display: flex; align-items: center; gap: 8px; " +
  extra;

export function select(label, value, width, disabled) {
  const filled = value !== null;
  return (
    '<div style="' +
    inputStyle(
      "width: " +
        (typeof width === "number" ? width + "px" : width) +
        "; justify-content: space-between; padding-right: 8px;" +
        (disabled ? " opacity: .45;" : ""),
    ) +
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

export function chip(text, iconName, color, extra = "") {
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

export function dotChip(text, color, dim, pulse) {
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
    "; flex: none" +
    (pulse ? "; animation: dcpulse 1.6s ease-in-out infinite" : "") +
    '"></span><span>' +
    text +
    "</span></span>"
  );
}

export function mono(text, color, extra = "") {
  return (
    '<code style="font-family: ' +
    MONO +
    "; font-size: 12px; background: oklch(1 0 0 / 0.07); border: 1px solid " +
    BORDER +
    "; border-radius: 6px; padding: 1px 5px; color: " +
    (color || FG) +
    "; " +
    extra +
    '">' +
    text +
    "</code>"
  );
}

/* --------------------------------------------------- Fase 2: badge ambiente */
// A regra da seção 14: "Campo aberto" nunca aparece sem "sem isolamento", e o
// texto canônico fica ao lado nos dois temas. Um só componente serve o cockpit,
// a lista e o diálogo, para os três não divergirem.
//
// size: "lg" (cabeçalho do cockpit) | "md" (diálogo, cartão) | "sm" (tabela)
export function envBadge(mode, theme, size) {
  const host = mode === "host";
  const c = host ? DESTR : A_BLUE;
  const name = host
    ? theme === "dnd"
      ? "Campo aberto"
      : "Host"
    : theme === "dnd"
      ? "Masmorra selada"
      : "Docker";
  const warning = host ? "sem isolamento" : null;
  const canonical = host ? "HOST · UNISOLATED" : "DOCKER · ISOLATED";
  const S = {
    lg: { name: 15, canon: 11, h: 34, pad: "0 12px", gap: 9, ic: 16 },
    md: { name: 14, canon: 10.5, h: 30, pad: "0 10px", gap: 8, ic: 14 },
    sm: { name: 12, canon: 10, h: 0, pad: "0", gap: 6, ic: 12 },
  }[size];

  const canonPill =
    '<span style="' +
    row(
      "height: " +
        (size === "sm" ? 17 : 20) +
        "px; padding: 0 6px; border-radius: 6px; border: 1px solid " +
        tint(c, "40%") +
        "; background: " +
        tint(c, "12%") +
        "; font-family: " +
        MONO +
        "; font-size: " +
        S.canon +
        "px; letter-spacing: 0.04em; color: " +
        c +
        "; flex: none;",
    ) +
    '">' +
    canonical +
    "</span>";

  const nameRun =
    '<span style="' +
    row("gap: 5px; white-space: nowrap") +
    '">' +
    '<span style="color: ' +
    c +
    '; display: flex; flex: none">' +
    icon(host ? "shield-alert" : "container", S.ic, "", 1.8) +
    "</span>" +
    '<span style="font-size: ' +
    S.name +
    'px; font-weight: 500; color: ' +
    FG +
    '">' +
    name +
    "</span>" +
    (warning
      ? '<span style="font-size: ' +
        S.name +
        "px; color: " +
        MFG +
        '">·</span><span style="font-size: ' +
        S.name +
        "px; color: " +
        c +
        '">' +
        warning +
        "</span>"
      : "") +
    "</span>";

  // Na tabela a regra continua valendo por linha, mas sem gritar: o aviso fica
  // na cor, e o texto canônico vira uma segunda linha em monoespaçada discreta.
  if (size === "sm") {
    return (
      '<span style="' +
      col("gap: 2px; align-items: flex-start") +
      '">' +
      nameRun +
      '<span style="font-family: ' +
      MONO +
      "; font-size: 10px; letter-spacing: 0.04em; color: " +
      MFG +
      '">' +
      canonical +
      "</span></span>"
    );
  }
  return (
    '<span style="' +
    row(
      "gap: " +
        S.gap +
        "px; height: " +
        S.h +
        "px; padding: " +
        S.pad +
        "; border-radius: 10px; border: 1px solid " +
        tint(c, "38%") +
        "; background: " +
        tint(c, "10%") +
        "; width: fit-content;",
    ) +
    '">' +
    nameRun +
    canonPill +
    "</span>"
  );
}

/* -------------------------------------------- Fase 2: status de Run e tipos */
export const RUN_STATUS = {
  RUNNING: { label: "Em andamento", color: A_BLUE, dim: false, pulse: true },
  QUEUED: { label: "Na fila", color: A_NEUTRAL, dim: true, pulse: false },
  PREPARING: { label: "Preparando", color: A_NEUTRAL, dim: true, pulse: true },
  SUCCEEDED: { label: "Vitória", color: A_GREEN, dim: false, pulse: false },
  FAILED: { label: "Derrota", color: DESTR, dim: false, pulse: false },
  CANCELLED: { label: "Retirada", color: A_NEUTRAL, dim: true, pulse: false },
  TIMED_OUT: { label: "Exaustão", color: A_AMBER, dim: false, pulse: false },
};

export const KINDS = {
  BUG: { icon: "bug", dnd: "Monstro", plain: "Bug" },
  FEATURE: { icon: "target", dnd: "Missão", plain: "Funcionalidade" },
  RESEARCH: { icon: "compass", dnd: "Exploração", plain: "Pesquisa" },
  CHORE: { icon: "wrench", dnd: "Manutenção", plain: "Manutenção" },
};

export const PRIORITY = {
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

export function sidebar(theme, active) {
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
    col("width: 248px; flex: none; background: " + CARD + "; border-right: 1px solid " + BORDER + ";") +
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
    "; font-size: 11px; color: " +
    MFG +
    '">Dungeon Master 0.4.0 · Fase 2</div>' +
    "</aside>"
  );
}

export function topbar(theme) {
  const placeholder =
    theme === "dnd" ? "Buscar Missões, Campanhas, Heróis…" : "Buscar tarefas, projetos, agentes…";
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

export function pageHeader(theme, title, subtitle, right) {
  const font = theme === "dnd" ? SERIF : SANS;
  const tracking = theme === "dnd" ? "0" : "-0.02em";
  return (
    '<div style="' +
    row("justify-content: space-between; align-items: flex-end; gap: 24px; flex: none") +
    '">' +
    '<div style="' +
    col("gap: 6px") +
    '">' +
    '<h1 style="margin: 0; font-family: ' +
    font +
    "; font-size: 30px; line-height: 36px; font-weight: 600; letter-spacing: " +
    tracking +
    "; color: " +
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

export function breadcrumb(parts) {
  const sep = icon("chevron-right", 12);
  return (
    '<div style="' +
    row("gap: 6px; font-size: 12px; color: " + MFG + "; flex: none") +
    '">' +
    parts
      .map(
        (p, i) =>
          (i > 0 ? sep : "") +
          '<span style="' +
          (i === parts.length - 1
            ? "color: " + FG + "; max-width: 620px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
            : "") +
          '">' +
          p +
          "</span>",
      )
      .join("") +
    "</div>"
  );
}

/* ----------------------------------------------------------------- file IO */
export const PULSE_CSS =
  "    @keyframes dcpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.28; } }\n";

export function write(name, w, h, body, extraCss = "") {
  const html =
    "<!doctype html>\n" +
    '<html>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n' +
    '<x-dc>\n<helmet>\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">\n' +
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
    PULSE_CSS +
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

export function frame(w, h, inner) {
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

export function screen(theme, active, w, h, content) {
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

/* --------------------------------------------------- Fase 2: dados de apoio */
// Valores de exemplo. Nomes de Heróis, Equipamentos e versões de CLI são
// amostras plausíveis, não fatos verificados.
export const MISSAO = "Worker não encerra a árvore de processos no Windows";
export const CAMPANHA = "Dungeon Master";
