/**
 * `@dungeon-master/runtime-sandcastle` — os adapters de host.
 *
 * Claude Code, Codex e Pi implementando `HarnessAdapter` de
 * `@dungeon-master/runtime`. O argv, o parser de NDJSON e a matriz de
 * capabilities de cada um moram aqui; timeout, cancelamento, worktree e
 * resultado estruturado moram no runtime, uma camada acima.
 *
 * O nome do pacote e a relação com o Sandcastle estão no ADR do `README.md`.
 */

export * from "./claude-code.js";
export * from "./cli-adapter.js";
export * from "./codex.js";
export * from "./docker.js";
export * from "./parse-utils.js";
export * from "./pi.js";
export * from "./resolve-cli.js";

import type { HarnessAdapter } from "@dungeon-master/runtime";

import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { pi } from "./pi.js";

/**
 * Os três adapters de host, prontos para o `HarnessRegistry`.
 *
 * Registrar um adapter não exige que a CLI exista: o preflight é quem descobre
 * isso, e um harness ausente vira `RunFailed` com mensagem de instalação, e não
 * um erro de boot do worker.
 */
export function hostAdapters(): readonly HarnessAdapter[] {
  return [claudeCode(), codex(), pi()];
}
