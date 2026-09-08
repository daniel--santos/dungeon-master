/**
 * Os onze casos do contrato rodando sobre o dialeto real do Antigravity, sem a
 * CLI.
 *
 * O harness falso emite o NDJSON do `agy` 1.1.27 e é traduzido pelo
 * `parseAntigravityLine` de produção, então esta suíte cobre no CI a mesma
 * costura que `contract.test.ts` cobre aqui com a CLI de verdade: sessão,
 * ferramentas, resultado, falha, cancelamento com árvore confirmada e os dois
 * relógios.
 */

import { harnessContractSuite } from "@dungeon-master/runtime/testing";

import { fakeAntigravity } from "./testing/fake-antigravity.js";

harnessContractSuite({
  name: "antigravity falso",
  createAdapter: () => fakeAntigravity(),
  caseTimeoutMs: 30_000,
  completionMs: 20_000,
  cancelAfterMs: 500,
  prompts: {
    echo: "@@fake:text OK",
    tool: "@@fake:tool run_command git --version\n@@fake:text OK",
    structured: '@@fake:block {"answer":"ok"}\n@@fake:result pronto ok',
    // Ignora sinal e sobe um neto: o cancelamento precisa escalar para
    // `SIGKILL` no POSIX e andar a árvore no Windows.
    slow: "@@fake:ignore-signals\n@@fake:spawn-child\n@@fake:sleep 600000",
  },
  // A CLI real falha com `status: ERROR` e código 1; o falso reproduz os dois.
  failure: { prompt: "@@fake:error invalid model selection (--model modelo-inexistente)" },
});
