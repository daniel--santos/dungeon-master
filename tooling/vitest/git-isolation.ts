// Adapted from Sandcastle — src/testSetup.ts@e99f832
// Copyright (c) 2026 Matt Pocock. Licensed under the MIT License.
// Changes: comentários traduzidos para o português; nenhuma mudança de
// comportamento. O arquivo não tinha import de `effect` para remover.

/**
 * Isolamento de gitconfig por worker do Vitest.
 *
 * O Vitest roda arquivos de teste em paralelo, em processos worker separados.
 * Vários testes chamam `git config --global` (para adicionar `safe.directory`,
 * por exemplo), e essa chamada escreve no arquivo apontado por
 * `GIT_CONFIG_GLOBAL`. Com todos os workers compartilhando um arquivo só, as
 * escritas concorrentes disputam o `.gitconfig.lock` e produzem falhas
 * intermitentes de "could not lock config file".
 *
 * Este arquivo roda dentro de cada worker (via `setupFiles` do Vitest), dando a
 * cada um o seu próprio gitconfig e acabando com a disputa entre workers.
 *
 * Uso, em qualquer pacote que toque em git:
 *
 * ```ts
 * export default defineConfig({
 *   test: {
 *     include: ["src/**\/*.test.ts"],
 *     setupFiles: ["@dungeon-master/tooling-vitest/git-isolation"],
 *   },
 * });
 * ```
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "test-gitconfig-worker-"));
const globalConfigPath = join(tmpDir, ".gitconfig");
writeFileSync(globalConfigPath, "[user]\n\temail = test@test.com\n\tname = Test\n");
process.env["GIT_CONFIG_GLOBAL"] = globalConfigPath;

process.on("exit", () => {
  try {
    rmSync(tmpDir, { recursive: true });
  } catch {
    // Limpeza best-effort.
  }
});
