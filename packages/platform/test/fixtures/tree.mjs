// Árvore de processos de verdade para `src/process-tree.test.ts`.
//
// Sem argumento: sobe um neto (`node tree.mjs child`), imprime os dois pids em
// uma linha JSON no stdout e fica de pé até alguém matá-lo. Com `child`: só
// fica de pé. O neto existe para provar que a terminação anda a árvore, e não
// só a raiz: matar apenas o pai deixaria o neto órfão e vivo.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const role = process.argv[2] ?? "parent";

if (role === "parent") {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "child"], {
    // O neto não herda os pipes do pai: se herdasse, seguraria o stdout do pai
    // aberto depois que o pai morresse e confundiria quem lê a saída.
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  process.stdout.write(`${JSON.stringify({ parent: process.pid, child: child.pid })}\n`);
}

// Handle sempre aberto: este processo só sai por kill.
setInterval(() => {}, 1_000);
