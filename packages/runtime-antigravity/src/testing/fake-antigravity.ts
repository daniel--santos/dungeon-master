/**
 * O harness falso do Antigravity: o `parseLine` de verdade, sem a CLI.
 *
 * A diferença para o `fakeHarness` de `@dungeon-master/runtime` é o dialeto: lá
 * o roteiro sai num NDJSON inventado para o teste, aqui ele sai **no formato do
 * `agy` 1.1.27**, campo por campo, e é traduzido pelo mesmo
 * {@link parseAntigravityLine} que roda em produção. Sem isso, o CI provaria o
 * cancelamento e o timeout do runtime e nada do parser — que é justamente a
 * peça que quebra quando a CLI muda de versão.
 *
 * O prompt também viaja como em produção: uma linha
 * `{"event":"user","message":{…}}` no stdin, do jeito que
 * `--input-format stream-json` exige. Um erro no `encodeUserMessage` faz o
 * falso sair com código 2, em vez de deixar o teste verde.
 */

import { fileURLToPath } from "node:url";

import type { HarnessAdapter, HarnessContext, PreflightResult } from "@dungeon-master/runtime";
import { createHostAdapter, type HostCommand } from "@dungeon-master/runtime";

import {
  ANTIGRAVITY_CAPABILITIES,
  buildAntigravityArgs,
  parseAntigravityLine,
} from "../antigravity.js";

export const FAKE_AGY_SCRIPT = fileURLToPath(new URL("./fixtures/fake-agy.mjs", import.meta.url));

export interface FakeAntigravityOptions {
  /** Id do adapter. Padrão: `antigravity@host-falso`. */
  readonly id?: string;
  /** Versão devolvida pelo preflight. Padrão: `1.1.27-falso`. */
  readonly version?: string;
  /** Faz o preflight reprovar, para exercitar o caminho de CLI ausente. */
  readonly preflightProblem?: { readonly code: "NOT_INSTALLED"; readonly message: string };
}

/**
 * Um `HarnessAdapter` completo, sem CLI instalada e sem rede.
 *
 * O argv é montado pelo `buildAntigravityArgs` de produção e depois filtrado:
 * as flags do `agy` não significam nada para o script falso, e passá-las faria
 * o Node reclamar. O que sobrevive é o que o falso entende — e o `stdin`, que é
 * o que se quer provar.
 */
export function fakeAntigravity(options: FakeAntigravityOptions = {}): HarnessAdapter {
  const version = options.version ?? "1.1.27-falso";

  return createHostAdapter({
    id: options.id ?? "antigravity@host-falso",
    key: "ANTIGRAVITY",
    capabilities: ANTIGRAVITY_CAPABILITIES,
    environmentKeys: ["DM_FAKE_ANTIGRAVITY_EXTRA"],

    preflight: (_context: HarnessContext): Promise<PreflightResult> =>
      Promise.resolve(
        options.preflightProblem === undefined
          ? { installed: true, version, executablePath: FAKE_AGY_SCRIPT, problems: [] }
          : { installed: false, problems: [{ ...options.preflightProblem, fatal: true }] },
      ),

    buildCommand: (request): HostCommand => {
      const { stdin } = buildAntigravityArgs(request);
      // `process.execPath` e não `node`: o falso precisa rodar no mesmo Node do
      // worker, e um `node` do PATH pode ser outro.
      return {
        command: process.execPath,
        args: [FAKE_AGY_SCRIPT],
        ...(stdin === undefined ? {} : { stdin }),
      };
    },

    parseLine: parseAntigravityLine,

    describeExit: (exitCode, stderrTail) => ({
      message: `O agy falso saiu com código ${String(exitCode)}. ${stderrTail.trim()}`.trim(),
      retryable: false,
    }),
  });
}
