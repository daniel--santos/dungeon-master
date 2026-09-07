import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Sobe um PostgreSQL embutido, aplica as migrações e semeia o usuário local.
    // Nada de Docker: os runners de Windows e macOS não têm Docker Linux.
    globalSetup: ["test/global-setup.ts"],
    // Os testes criam repositórios git de verdade e rodam `git worktree add`;
    // vários workers escrevendo no mesmo gitconfig global disputam o
    // `.gitconfig.lock`.
    setupFiles: ["@dungeon-master/tooling-vitest/git-isolation"],
    // O banco embutido é único para toda a suíte, e cada arquivo mexe nas
    // mesmas linhas de `run` e `workspace_lock`.
    fileParallelism: false,
    // Kill de árvore, `git worktree` e espera por estado no banco são lentos no
    // Windows.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
