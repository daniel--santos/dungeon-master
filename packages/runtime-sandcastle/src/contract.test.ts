/**
 * A suíte de contrato com as três CLIs reais.
 *
 * Roda **só onde a CLI está instalada e autenticada**, e nunca no CI: cada caso
 * sobe um processo de verdade e fala com um provedor de modelo. No CI o que
 * cobre os mesmos onze casos é o harness falso, em
 * `packages/runtime/src/testing/fake-harness.test.ts`.
 *
 * Os prompts são mínimos de propósito ("responda apenas OK"): o objetivo é
 * exercitar a costura entre runtime, adapter e processo, não o modelo.
 */

import { harnessContractSuite } from "@dungeon-master/runtime/testing";
import type { HarnessAdapter } from "@dungeon-master/runtime";

import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { pi } from "./pi.js";

/**
 * Rodar a suíte real neste ambiente?
 *
 * `DM_HARNESS_CONTRACT=1` força a execução; `CI` a desliga. Sem CLI instalada,
 * o preflight reprova e a suíte some — que é o comportamento certo numa máquina
 * de quem só mexe na web.
 */
const forced = process.env["DM_HARNESS_CONTRACT"] === "1";
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "";

async function available(adapter: HarnessAdapter): Promise<boolean> {
  if (inCi && !forced) return false;
  try {
    const preflight = await adapter.preflight({ mode: "HOST" });
    return preflight.installed && !preflight.problems.some((problem) => problem.fatal);
  } catch {
    return false;
  }
}

const claudeAdapter = claudeCode();
const codexAdapter = codex();
const piAdapter = pi();

const [claudeOk, codexOk, piOk] = await Promise.all([
  available(claudeAdapter),
  available(codexAdapter),
  available(piAdapter),
]);

harnessContractSuite({
  name: "claude-code@host",
  enabled: claudeOk,
  createAdapter: () => claudeAdapter,
  // Alias barato; a suíte não mede qualidade de resposta.
  model: { id: "sonnet" },
  caseTimeoutMs: 180_000,
  completionMs: 150_000,
  cancelAfterMs: 3_000,
});

harnessContractSuite({
  name: "codex@host",
  enabled: codexOk,
  createAdapter: () => codexAdapter,
  caseTimeoutMs: 180_000,
  completionMs: 150_000,
  cancelAfterMs: 3_000,
});

harnessContractSuite({
  name: "pi@host",
  enabled: piOk,
  createAdapter: () => piAdapter,
  caseTimeoutMs: 180_000,
  completionMs: 150_000,
  cancelAfterMs: 3_000,
});
