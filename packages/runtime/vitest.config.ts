import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // O `WorkspaceManager` roda `git worktree add` de verdade nos testes, e
    // vários workers escrevendo no mesmo gitconfig global disputam o
    // `.gitconfig.lock`.
    setupFiles: ["@dungeon-master/tooling-vitest/git-isolation"],
    // Kill de árvore, timeouts e `git worktree` são lentos no Windows.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
