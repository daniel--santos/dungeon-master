// Gera os artboards .dc.html do canvas de design da Fase 2.
// Rode com: node docs/design/fase2/build-artboards.mjs
//
// Os .dc.html gerados sao os arquivos de trabalho do canvas. O kit de estilo
// (kit.mjs) e a continuacao direta do canvas da Fase 1.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { OUT } from "./kit.mjs";
import { buildConcluida, buildFalha, buildMain } from "./cockpit.mjs";
import { buildEquipamentos, buildExpedicoes, buildNovaExpedicao } from "./listas.mjs";
import { buildBadgeAmbiente, buildEventoTimeline } from "./componentes.mjs";

const files = [];
files.push(buildMain());
files.push(buildConcluida());
files.push(buildFalha());
files.push(buildExpedicoes());
files.push(buildNovaExpedicao());
files.push(buildEquipamentos());
files.push(buildEventoTimeline());
files.push(buildBadgeAmbiente());

const LINHA2 = 1630;

const nota = [
  "Três decisões de UX desta fase, para você confirmar:",
  "",
  "1. Rótulos que faltam no glossário. RUNNING, QUEUED e PREPARING não têm chave em packages/glossary, e o canvas usa \"Em andamento\", \"Na fila\" e \"Preparando\" — iguais nos dois temas, como os status de Missão da Fase 1. A alternativa é criar run.status.running e as irmãs, com versão temática.",
  "",
  "2. Cancelar sem diálogo. O botão do cockpit confirma no segundo toque, em vez de abrir um AlertDialog, e a Expedição só vira Retirada depois que a árvore de processos é confirmada encerrada. Ganha velocidade quando o cancelamento é urgente; perde a barreira contra o clique errado.",
  "",
  "3. Retomar a Expedição na Exaustão. A tela oferece \"Retomar\" porque a sessão foi capturada e a Guilda declara resume. A Fase 2 não lista retomada como entrega. Se ela não couber, o botão sai e fica só \"Nova Expedição\".",
].join("\n");

const canvas = {
  pages: [
    { id: "page-1", name: "Fase 2" },
    { id: "page-2", name: "Componentes" },
  ],
  artboards: [
    { file: "Main.dc.html", page: "page-1", x: 0, y: 0, w: 1440, h: 1000 },
    { file: "ExpedicaoConcluida.dc.html", page: "page-1", x: 1560, y: 0, w: 1440, h: 1510 },
    { file: "ExpedicaoFalha.dc.html", page: "page-1", x: 3120, y: 0, w: 1440, h: 1450 },
    { file: "Expedicoes.dc.html", page: "page-1", x: 0, y: LINHA2, w: 1440, h: 900 },
    { file: "NovaExpedicao.dc.html", page: "page-1", x: 1560, y: LINHA2, w: 1440, h: 900 },
    { file: "Equipamentos.dc.html", page: "page-1", x: 3120, y: LINHA2, w: 1440, h: 1160 },
    { file: "EventoTimeline.dc.html", page: "page-2", x: 0, y: 0, w: 720, h: 480 },
    { file: "BadgeAmbiente.dc.html", page: "page-2", x: 840, y: 0, w: 880, h: 400 },
  ],
  annotations: [
    { id: "decisoes-ux", page: "page-1", x: -440, y: 0, w: 360, text: nota },
  ],
  launch: { view: "canvas", page: "page-1" },
};

writeFileSync(join(OUT, "canvas.json"), JSON.stringify(canvas, null, 2) + "\n", "utf8");

console.log("artboards: " + files.join(", "));
