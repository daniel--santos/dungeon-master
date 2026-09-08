import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // O snapshot de checkout roda `git` de verdade em repositórios temporários,
    // e vários workers escrevendo no mesmo gitconfig global disputam o
    // `.gitconfig.lock`.
    setupFiles: ["@dungeon-master/tooling-vitest/git-isolation"],
    // Kill de árvore e `git` são lentos no Windows.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
