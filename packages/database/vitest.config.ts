import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Sobe um PostgreSQL embutido, aplica as migrações e semeia o usuário local.
    // Nada de Docker: os runners de Windows e macOS não têm Docker Linux.
    globalSetup: ["test/global-setup.ts"],
    // O banco embutido é único para toda a suíte; execução em série evita
    // que dois arquivos disputem as mesmas linhas.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
