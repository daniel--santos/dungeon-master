// Alvo do teste de CTRL_BREAK no Windows (`src/process-tree.test.ts`).
//
// Trata `SIGBREAK` como os processos longos do projeto tratam (CLAUDE.md, seção
// 8), escreve um marcador provando que o handler rodou e sai com código 0. Se o
// evento não chegasse e o processo fosse morto por `TerminateProcess`, não
// haveria marcador e o código de saída seria 1.

import { writeFileSync } from "node:fs";

const markerPath = process.argv[2];
if (markerPath === undefined) {
  process.stderr.write("uso: ctrl-break-target.mjs <caminho-do-marcador>\n");
  process.exit(2);
}

const keepAlive = setInterval(() => {}, 1_000);

process.on("SIGBREAK", () => {
  clearInterval(keepAlive);
  writeFileSync(markerPath, "SIGBREAK\n");
  process.exit(0);
});

// Só depois do handler registrado: o orquestrador espera esta linha antes de
// mandar o evento.
process.stdout.write("ready\n");
