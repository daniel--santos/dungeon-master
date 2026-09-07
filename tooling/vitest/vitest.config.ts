import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Pelo nome do pacote, e não por caminho relativo: é assim que os outros
    // pacotes vão apontar, e usar aqui prova que o `exports` resolve.
    setupFiles: ["@dungeon-master/tooling-vitest/git-isolation"],
  },
});
