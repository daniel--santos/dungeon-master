/**
 * A suíte de contrato rodando com o harness falso.
 *
 * É o único lugar onde os onze casos rodam em **toda** máquina da matriz de CI,
 * sem CLI instalada e sem rede. Os adapters reais rodam a mesma suíte em
 * `packages/runtime-sandcastle`, onde ela é pulada quando a CLI não existe.
 */

import { harnessContractSuite } from "./contract-suite.js";
import { fakeHarness } from "./fake-harness.js";

harnessContractSuite({
  name: "harness falso",
  createAdapter: () => fakeHarness(),
  caseTimeoutMs: 30_000,
  completionMs: 20_000,
  cancelAfterMs: 500,
  prompts: {
    echo: "@@fake:text OK",
    tool: "@@fake:tool Bash git --version\n@@fake:text OK",
    structured: '@@fake:block {"answer":"ok"}\n@@fake:result pronto ok',
    // Ignora sinal e sobe um neto: o cancelamento precisa escalar para
    // `SIGKILL` no POSIX e andar a árvore no Windows.
    slow: "@@fake:ignore-signals\n@@fake:spawn-child\n@@fake:sleep 600000",
  },
  // O falso não tem "modelo inexistente": a falha vem de uma diretiva que sai
  // com código diferente de zero, que é o mesmo caminho de código.
  failure: { prompt: "@@fake:stderr modelo inexistente\n@@fake:exit 3" },
});
