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
  "Três decisões de UX, respondidas pelo Mestre da Guilda:",
  "",
  "1. Rótulos de status de Run — aprovado. RUNNING, QUEUED e PREPARING ficam iguais nos dois temas (\"Em andamento\", \"Na fila\", \"Preparando\"). A exceção é WAITING_APPROVAL, que vira \"Aguardando o Selo\", do Selo da Guilda do glossário.",
  "",
  "2. Cancelamento — com diálogo. Não é o segundo toque: o botão abre um AlertDialog, que o artboard Main mostra aberto. Ele diz que a Missão volta para Pronta e que o worktree é preservado, e a Expedição só vira Retirada depois que a árvore de processos é confirmada encerrada.",
  "",
  "3. Retomar a Expedição — aprovado, com condição. O botão só aparece quando a Guilda declara resume e a sessão foi capturada; as duas coisas juntas, nunca uma só.",
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
